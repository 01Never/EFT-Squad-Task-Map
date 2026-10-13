package app

// Ticket 17 through the app: the sharing switches' defaults and route, and a GPS screenshot's
// position in my share, checked where a friend reads it (the peer API).

import (
	"encoding/json"
	"net/http"
	"os"
	"sort"
	"strings"
	"testing"

	"squadtaskmap/internal/features/gamelog"
	"squadtaskmap/internal/features/gps"
	"squadtaskmap/internal/screenshots"
)

// gpsScreenshotName is a real in-raid screenshot name (testdata/screenshots/names.txt): x -67.89,
// y 7.79, z -153.62.
const gpsScreenshotName = "2026-09-23[18-47]_-67.89, 7.79, -153.62_-0.02779, -0.75464, 0.03203, -0.65477_13.51 (5).png"

func TestANewPlayerSharesTasksAndPositionAndTheFileSaysSo(t *testing.T) {
	rig := newSquadRig(t)
	_, view := rig.send("GET", "/api/squad", "")
	settings := view["settings"].(map[string]any)
	if settings["shareTasks"] != true || settings["sharePosition"] != true {
		t.Errorf("settings %v; both are on by default (ticket 17)", settings)
	}
	text, _ := os.ReadFile(rig.files.Settings)
	for _, want := range []string{`"shareTasks": true`, `"sharePosition": true`} {
		if !strings.Contains(string(text), want) {
			t.Errorf("the settings file doesn't write %s out:\n%s", want, text)
		}
	}
}

func TestTheProfileRouteSwitchesPositionSharing(t *testing.T) {
	rig := newSquadRig(t)
	steps := []struct {
		name              string
		body              string
		wantSharePosition bool
		wantInFile        string
	}{
		{"switched off", `{"sharePosition":false}`, false, `"sharePosition": false`},
		{"something that isn't true or false changes nothing", `{"sharePosition":"no"}`, false, `"sharePosition": false`},
		{"another field leaves it as it is", `{"name":"Mike"}`, false, `"sharePosition": false`},
		{"switched on again", `{"sharePosition":true}`, true, `"sharePosition": true`},
	}
	for _, step := range steps {
		status, answer := rig.send("PUT", "/api/squad/profile", step.body)
		if status != http.StatusOK {
			t.Fatalf("%s: status %d", step.name, status)
		}
		settings := answer["squad"].(map[string]any)["settings"].(map[string]any)
		if settings["sharePosition"] != step.wantSharePosition || settings["shareTasks"] != true {
			t.Errorf("%s: settings %v", step.name, settings)
		}
		if text, _ := os.ReadFile(rig.files.Settings); !strings.Contains(string(text), step.wantInFile) {
			t.Errorf("%s: the settings file lacks %s:\n%s", step.name, step.wantInFile, text)
		}
	}
}

func TestAGPSScreenshotPutsMyPositionInMyShareUntilTheRaidEnds(t *testing.T) {
	rig, listen := newSquadRigWithDevListener(t)
	if status, _ := rig.send("POST", "/api/squad/join", `{"authKey":"tskey-auth-dev"}`); status != http.StatusOK {
		t.Fatalf("join: %d", status)
	}
	rig.send("PUT", "/api/squad/share", shareWithTasks)

	takeScreenshot := func() {
		rig.app.onScreenshot(screenshots.File{Name: gpsScreenshotName, Exists: true})
	}
	logSays := func(kind, scene string) {
		rig.app.onLogEvent(gamelog.Event{Kind: kind, Scene: scene})
	}
	const customs, woods = "maps/customs_preset.bundle", "maps/woods_preset.bundle"
	const pageSendsAPosition = `{"draw":{},"tasks":null,"pos":{"map":"factory","x":1,"y":2,"z":3,"yaw":0,"t":5}}`

	steps := []struct {
		name    string
		action  func()
		wantMap string // "" = friends get no position
	}{
		{"a screenshot before the log named a map isn't shared", takeScreenshot, ""},
		{"a screenshot in a raid on Customs is shared", func() {
			logSays(gamelog.KindMapLoading, customs)
			logSays(gamelog.KindRaidStart, "")
			takeScreenshot()
		}, "customs"},
		{"the log naming the same map keeps it", func() { logSays(gamelog.KindMapLoading, customs) }, "customs"},
		{"a raid loading on another map clears it", func() { logSays(gamelog.KindMapLoading, woods) }, ""},
		{"a screenshot in the raid on Woods is shared", func() {
			logSays(gamelog.KindRaidStart, "")
			takeScreenshot()
		}, "woods"},
		{"a position sent by the page is ignored", func() {
			rig.send("PUT", "/api/squad/share", pageSendsAPosition)
		}, "woods"},
		{"the raid ends: cleared", func() { logSays(gamelog.KindRaidLeft, "") }, ""},
	}
	for _, step := range steps {
		step.action()
		position, _ := fetchPeerShare(t, listen)["pos"].(map[string]any)
		gotMap, _ := position["map"].(string)
		if gotMap != step.wantMap {
			t.Errorf("%s: friends get a position on %q, want %q (%v)", step.name, gotMap, step.wantMap, position)
		}
	}
}

func TestMySharedPositionHasTheGPSEventsFields(t *testing.T) {
	customs := "customs"
	fix, _ := gps.ParseFileName(gpsScreenshotName)
	tracker := &gps.Tracker{}
	position, _ := tracker.Update(fix, &customs)

	shared, ok := sharedPositionFrom(position)
	if !ok {
		t.Fatal("a position on Customs isn't shared")
	}
	if shared.Map != "customs" || shared.X != -67.89 || shared.Y != 7.79 || shared.Z != -153.62 {
		t.Errorf("shared %+v", shared)
	}
	if shared.Yaw != position.Yaw || shared.T != int64(position.T) || shared.T <= 0 {
		t.Errorf("heading %v time %d; the GPS event has %v and %v", shared.Yaw, shared.T, position.Yaw, position.T)
	}
	fields := jsonFieldNames(t, shared)
	if got := strings.Join(fields, ","); got != "map,t,x,y,yaw,z" {
		t.Errorf("fields %s, want the gps event's map, x, y, z, yaw, t", got)
	}
}

func TestAPositionOnAMapTheLogDidntNameIsntShared(t *testing.T) {
	fix, _ := gps.ParseFileName(gpsScreenshotName)
	tracker := &gps.Tracker{}
	position, _ := tracker.Update(fix, nil)
	if shared, ok := sharedPositionFrom(position); ok {
		t.Errorf("shared %+v; a friend couldn't place it", shared)
	}
}

// jsonFieldNames lists the names a value is written with, sorted.
func jsonFieldNames(t *testing.T, value any) []string {
	t.Helper()
	var fields map[string]any
	if err := json.Unmarshal(mustMarshal(t, value), &fields); err != nil {
		t.Fatal(err)
	}
	var names []string
	for name := range fields {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func mustMarshal(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
