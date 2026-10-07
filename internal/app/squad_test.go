package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"squadtaskmap/internal/features/squad"
	"squadtaskmap/internal/gamedata"
	"squadtaskmap/internal/httpapi"
	"squadtaskmap/internal/storage"
)

// squadRig runs the app's real routes with a scratch data folder.
type squadRig struct {
	t     *testing.T
	app   *App
	files storage.Files
	api   *httptest.Server
}

func newSquadRig(t *testing.T) *squadRig {
	t.Helper()
	files := storage.FilesIn(t.TempDir())
	notNeeded := func() (gamedata.GameData, error) { return gamedata.GameData{}, errors.New("not needed in this test") }
	app := newApp("2.6.1", "", files, notNeeded)
	t.Cleanup(app.squad.Stop)
	api := httptest.NewServer(httpapi.NewServer(app, nil))
	t.Cleanup(api.Close)
	return &squadRig{t: t, app: app, files: files, api: api}
}

// send makes a JSON request and decodes the JSON answer.
func (rig *squadRig) send(method, path, body string) (int, map[string]any) {
	rig.t.Helper()
	request, _ := http.NewRequest(method, rig.api.URL+path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		rig.t.Fatal(err)
	}
	defer response.Body.Close()
	var answer map[string]any
	json.NewDecoder(response.Body).Decode(&answer)
	return response.StatusCode, answer
}

const shareWithTasks = `{"draw":{"customs":[{"c":"#ff4d4d","w":2,"pts":[[1,2],[3,4]]}]},` +
	`"tasks":{"657315ddab5a49b71f098853":{"ticks":{"a1":true,"b2":3},"pct":40}}}`

func freeLoopbackAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().String()
}

func TestNeverJoinedStartsNothing(t *testing.T) {
	rig := newSquadRig(t)
	rig.app.startSquad()

	status, view := rig.send("GET", "/api/squad", "")
	if status != http.StatusOK {
		t.Fatalf("GET /api/squad: %d", status)
	}
	squadStatus := view["status"].(map[string]any)
	if squadStatus["state"] != squad.StateOff || view["transport"] != "tsnet" {
		t.Errorf("never joined: %v", view)
	}
	if rig.app.squad.View().Settings.Joined {
		t.Error("a new copy says joined")
	}
	if _, err := os.Stat(rig.files.SquadNetwork); !os.IsNotExist(err) {
		t.Errorf("the tsnet state folder exists without a join (err %v)", err)
	}
	saved := storage.ReadSettings(rig.files.Settings).SquadOrEmpty()
	if !squad.IsValidPlayerID(saved.PlayerID) {
		t.Errorf("no player id saved: %+v", saved)
	}
}

func TestTheServerDropsTasksWhenSharingIsOffEvenIfThePageSendsThem(t *testing.T) {
	listen := freeLoopbackAddress(t)
	t.Setenv("STM_SQUAD_DEV_LISTEN", listen)
	rig := newSquadRig(t)

	status, answer := rig.send("PUT", "/api/squad/share", shareWithTasks)
	if status != http.StatusOK || answer["tasksShared"] != false || answer["rev"] != 1.0 {
		t.Fatalf("PUT /api/squad/share: %d %v", status, answer)
	}
	status, _ = rig.send("POST", "/api/squad/join", `{"authKey":"tskey-auth-dev"}`)
	if status != http.StatusOK {
		t.Fatalf("join: %d", status)
	}

	friendView := fetchPeerShare(t, listen)
	if friendView["tasks"] != nil {
		t.Errorf("a friend gets tasks %v; sharing is off", friendView["tasks"])
	}
	if _, hasDrawings := friendView["draw"].(map[string]any)["customs"]; !hasDrawings {
		t.Errorf("a friend gets no drawings: %v", friendView)
	}

	rig.send("PUT", "/api/squad/profile", `{"shareTasks":true}`)
	rig.send("PUT", "/api/squad/share", shareWithTasks)
	if tasks, _ := fetchPeerShare(t, listen)["tasks"].(map[string]any); len(tasks) != 1 {
		t.Errorf("with sharing on a friend gets tasks %v", tasks)
	}
}

// fetchPeerShare asks the peer API (the separate listener) for the share, as a friend would.
func fetchPeerShare(t *testing.T, listen string) map[string]any {
	t.Helper()
	response, err := http.Get("http://" + listen + "/squad/v1/share")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var share map[string]any
	json.NewDecoder(response.Body).Decode(&share)
	return share
}

func TestTheShareRouteRefusesWhatItCantTake(t *testing.T) {
	rig := newSquadRig(t)
	tooBig := `{"draw":{"customs":[{"c":"#ff4d4d","w":2,"pts":[` + strings.Repeat("[1,2],", squad.MaxShareBytes/6) + `[1,2]]}]}}`
	cases := []struct {
		name        string
		contentType string
		body        string
		wantStatus  int
	}{
		{"a share over 2 MB is refused", "application/json", tooBig, http.StatusRequestEntityTooLarge},
		{"a body that isn't the share's shape is refused", "application/json", `{"draw":[1,2]}`, http.StatusBadRequest},
		{"a bad stroke is refused with the reason", "application/json", `{"draw":{"customs":[{"c":"red","w":2,"pts":[[1,2]]}]}}`, http.StatusBadRequest},
		{"a body not sent as JSON is refused", "text/plain", shareWithTasks, http.StatusUnsupportedMediaType},
		{"an empty share (nothing drawn) is fine", "application/json", `{"draw":{},"tasks":null}`, http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request, _ := http.NewRequest("PUT", rig.api.URL+"/api/squad/share", strings.NewReader(tc.body))
			request.Header.Set("Content-Type", tc.contentType)
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			io.Copy(io.Discard, response.Body)
			response.Body.Close()
			if response.StatusCode != tc.wantStatus {
				t.Errorf("status %d, want %d", response.StatusCode, tc.wantStatus)
			}
		})
	}
}

func TestJoiningAndLeavingThroughTheRoutes(t *testing.T) {
	listen := freeLoopbackAddress(t)
	t.Setenv("STM_SQUAD_DEV_LISTEN", listen)
	rig := newSquadRig(t)

	steps := []struct {
		name       string
		method     string
		path       string
		body       string
		wantStatus int
		wantJoined bool
	}{
		{"something that isn't an invite code is refused", "POST", "/api/squad/join", `{"authKey":"hello"}`, http.StatusBadRequest, false},
		{"an invite code joins", "POST", "/api/squad/join", `{"authKey":"tskey-auth-abc123"}`, http.StatusOK, true},
		{"joining again is refused", "POST", "/api/squad/join", `{"authKey":"tskey-auth-abc123"}`, http.StatusConflict, true},
		{"a bad colour is refused", "PUT", "/api/squad/profile", `{"color":"red"}`, http.StatusBadRequest, true},
		{"a 33-character name is refused", "PUT", "/api/squad/profile", `{"name":"` + strings.Repeat("x", 33) + `"}`, http.StatusBadRequest, true},
		{"a name and colour are saved", "PUT", "/api/squad/profile", `{"name":" Mike ","color":"#FF922B"}`, http.StatusOK, true},
		{"leaving works", "POST", "/api/squad/leave", "", http.StatusOK, false},
	}
	for _, step := range steps {
		status, _ := rig.send(step.method, step.path, step.body)
		if status != step.wantStatus {
			t.Errorf("%s: status %d, want %d", step.name, status, step.wantStatus)
		}
		if joined := rig.app.squad.View().Settings.Joined; joined != step.wantJoined {
			t.Errorf("%s: joined %v, want %v", step.name, joined, step.wantJoined)
		}
	}

	saved := storage.ReadSettings(rig.files.Settings).SquadOrEmpty()
	if saved.Name != "Mike" || saved.Color != "#ff922b" || saved.Joined {
		t.Errorf("saved squad settings %+v", saved)
	}
	settingsText, _ := os.ReadFile(rig.files.Settings)
	if bytes.Contains(settingsText, []byte("tskey-")) {
		t.Error("the invite code was saved in the settings file")
	}
	if listener, err := net.Listen("tcp", listen); err != nil {
		t.Errorf("the peer API still listens after leaving: %v", err)
	} else {
		listener.Close()
	}
}

func TestThePeerAPIIsNotOnThePagesServer(t *testing.T) {
	rig := newSquadRig(t)
	rig.send("PUT", "/api/squad/share", shareWithTasks)
	for _, path := range []string{"/squad/v1/share", "/squad/v1/stream"} {
		response, err := http.Get(rig.api.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusNotFound {
			t.Errorf("the page's server answers %s with %d, want 404", path, response.StatusCode)
		}
	}
}

func TestAJoinedCopyReconnectsAtLaunch(t *testing.T) {
	listen := freeLoopbackAddress(t)
	t.Setenv("STM_SQUAD_DEV_LISTEN", listen)
	dir := t.TempDir()
	settings := storage.Settings{Squad: &storage.SquadSettings{PlayerID: "0123456789abcdef", Name: "Mike", Color: "#4dabf7", Joined: true}}
	storage.WriteSettings(filepath.Join(dir, "squad-task-map-settings.json"), settings)
	notNeeded := func() (gamedata.GameData, error) { return gamedata.GameData{}, errors.New("not needed") }
	app := newApp("2.6.1", "", storage.FilesIn(dir), notNeeded)
	t.Cleanup(app.squad.Stop)

	app.startSquad() // returns at once; the peer API comes up in the background
	app.SetSquadShare(squad.ShareParts{Draw: map[string][]squad.Stroke{}})
	waitUntilListening(t, listen)
	share := fetchPeerShare(t, listen)
	if share["player"].(map[string]any)["name"] != "Mike" {
		t.Errorf("after a restart the peer API serves %v", share)
	}
}

func waitUntilListening(t *testing.T, address string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		connection, err := net.Dial("tcp", address)
		if err == nil {
			connection.Close()
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("nothing listens on %s", address)
}

func TestTheStateFolderNameMatchesTheOneLeaveMayDelete(t *testing.T) {
	files := storage.FilesIn(t.TempDir())
	if filepath.Base(files.SquadNetwork) != squad.StateFolderName {
		t.Errorf("storage names the tsnet folder %q, but Leave only deletes %q", filepath.Base(files.SquadNetwork), squad.StateFolderName)
	}
}
