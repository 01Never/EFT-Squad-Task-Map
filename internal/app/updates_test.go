package app

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"squadtaskmap/internal/features/updates"
	"squadtaskmap/internal/gamedata"
	"squadtaskmap/internal/httpapi"
	"squadtaskmap/internal/storage"
)

// updateRoutesRig runs the app's real routes against a fake GitHub that signs its manifest
// with a key made for the test.
type updateRoutesRig struct {
	t        *testing.T
	api      *httptest.Server
	requests atomic.Int32 // requests that reached the fake GitHub
}

func newUpdateRoutesRig(t *testing.T) *updateRoutesRig {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	rig := &updateRoutesRig{t: t}

	exe := []byte("a fake exe for 2.6.0")
	sum := sha256.Sum256(exe)
	manifest := updates.SignManifest(updates.Manifest{
		Version: "2.6.0", Released: "2026-10-20", Notes: "• Updates",
		File: updates.FileInfo{Name: updates.ExeFileName, Size: int64(len(exe)), SHA256: hex.EncodeToString(sum[:])},
	}, privateKey)
	manifestJSON, _ := json.Marshal(manifest)

	github := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		rig.requests.Add(1)
		if request.URL.Path == "/repo/releases/latest/download/latest.json" {
			writer.Write(manifestJSON)
			return
		}
		writer.Write(exe)
	}))
	t.Cleanup(github.Close)

	t.Setenv("STM_UPDATES_BASE", github.URL+"/repo")
	t.Setenv("STM_UPDATES_PUBLIC_KEY", base64.StdEncoding.EncodeToString(publicKey))

	files := storage.FilesIn(t.TempDir())
	notNeeded := func() (gamedata.GameData, error) { return gamedata.GameData{}, errors.New("not needed in this test") }
	app := newApp("2.5.0", "", files, notNeeded)
	rig.api = httptest.NewServer(httpapi.NewServer(app, nil))
	t.Cleanup(rig.api.Close)
	return rig
}

// post sends an empty-bodied POST and decodes the JSON answer.
func (rig *updateRoutesRig) post(path, body string) (int, map[string]any) {
	rig.t.Helper()
	response, err := http.Post(rig.api.URL+path, "application/json", bytes.NewBufferString(body))
	if err != nil {
		rig.t.Fatal(err)
	}
	defer response.Body.Close()
	var answer map[string]any
	if err := json.NewDecoder(response.Body).Decode(&answer); err != nil {
		rig.t.Fatalf("%s answered something that isn't JSON: %v", path, err)
	}
	return response.StatusCode, answer
}

func (rig *updateRoutesRig) updatesStatusFromAPIStatus() map[string]any {
	rig.t.Helper()
	response, err := http.Get(rig.api.URL + "/api/status")
	if err != nil {
		rig.t.Fatal(err)
	}
	defer response.Body.Close()
	var status map[string]any
	json.NewDecoder(response.Body).Decode(&status)
	updatesStatus, _ := status["updates"].(map[string]any)
	return updatesStatus
}

func TestTheKeyOverrideOnlyCountsWithABaseOnThisPC(t *testing.T) {
	tests := []struct {
		name       string
		override   string
		base       string
		wantKey    string
		wantLogged bool
	}{
		{"no override", "", "https://github.com/01Never/EFT-Squad-Task-Map", "built-in", false},
		{"127.0.0.1 with a port", "test-key", "http://127.0.0.1:7820/github/x/y", "test-key", false},
		{"localhost", "test-key", "http://localhost:7820/x", "test-key", false},
		{"IPv6 loopback", "test-key", "http://[::1]:7820/x", "test-key", false},
		{"another repo on github.com is ignored", "test-key", "https://github.com/other/repo", "built-in", true},
		{"the real repo is ignored", "test-key", "https://github.com/01Never/EFT-Squad-Task-Map", "built-in", true},
		{"a look-alike host is ignored", "test-key", "http://127.0.0.1.evil.example.com/x", "built-in", true},
		{"a loopback name in the path is ignored", "test-key", "https://evil.example.com/127.0.0.1", "built-in", true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var logged bytes.Buffer
			log.SetOutput(&logged)
			t.Cleanup(func() { log.SetOutput(os.Stderr) })

			got := chooseUpdatePublicKey("built-in", test.override, test.base)

			if got != test.wantKey {
				t.Fatalf("key = %q, want %q", got, test.wantKey)
			}
			if wasLogged := strings.Contains(logged.String(), "STM_UPDATES_PUBLIC_KEY ignored"); wasLogged != test.wantLogged {
				t.Fatalf("logged = %v (%q), want %v", wasLogged, logged.String(), test.wantLogged)
			}
		})
	}
}

func TestOpeningTheAppAndReadingItsStatusNeverContactsGitHub(t *testing.T) {
	rig := newUpdateRoutesRig(t)

	status := rig.updatesStatusFromAPIStatus()

	if status["currentVersion"] != "2.5.0" || status["phase"] != "idle" || status["lastChecked"] != nil {
		t.Fatalf("/api/status updates = %v", status)
	}
	if rig.requests.Load() != 0 {
		t.Fatalf("%d requests reached GitHub before anyone clicked Check for updates", rig.requests.Load())
	}
}

func TestTheCheckRouteReportsTheNewVersionAndTheStatusKeepsIt(t *testing.T) {
	rig := newUpdateRoutesRig(t)

	code, answer := rig.post("/api/updates/check", "")

	if code != http.StatusOK || answer["ok"] != true {
		t.Fatalf("check answered %d %v", code, answer)
	}
	status := answer["status"].(map[string]any)
	available := status["available"].(map[string]any)
	if status["result"] != "available" || available["version"] != "2.6.0" || available["notes"] != "• Updates" {
		t.Fatalf("status = %v", status)
	}
	if rig.updatesStatusFromAPIStatus()["result"] != "available" {
		t.Fatal("/api/status must show the result of the last check")
	}
	if rig.requests.Load() == 0 {
		t.Fatal("the check should have asked GitHub")
	}
}

func TestUnderGoRunDownloadAndRestartIsRefusedWithTheDocumentedMessage(t *testing.T) {
	rig := newUpdateRoutesRig(t) // `go test` runs from a temporary build folder, like `go run`
	rig.post("/api/updates/check", "")

	code, answer := rig.post("/api/updates/download", `{"version":"2.6.0"}`)

	if code != http.StatusBadRequest || answer["ok"] != false || answer["code"] != "dev-build" {
		t.Fatalf("answered %d %v", code, answer)
	}
	if answer["error"] != "Updates only apply to the built exe." {
		t.Fatalf("message = %v", answer["error"])
	}
	status := answer["status"].(map[string]any)
	if status["canApply"] != false {
		t.Fatalf("canApply = %v", status["canApply"])
	}
}

func TestRoutesRefuseStepsThatDontFitTheCurrentState(t *testing.T) {
	rig := newUpdateRoutesRig(t)

	tests := []struct {
		name     string
		path     string
		wantCode int
		wantText string
	}{
		{"installing before any download", "/api/updates/apply", http.StatusConflict, "nothing-to-apply"},
		{"downloading before any check", "/api/updates/download", http.StatusConflict, "nothing-to-apply"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			code, answer := rig.post(test.path, "")
			if code != test.wantCode || answer["code"] != test.wantText {
				t.Fatalf("answered %d %v", code, answer)
			}
		})
	}
	// Cancel and "seen" are always fine.
	for _, path := range []string{"/api/updates/cancel", "/api/updates/seen"} {
		if code, answer := rig.post(path, ""); code != http.StatusOK || answer["ok"] != true {
			t.Fatalf("%s answered %d %v", path, code, answer)
		}
	}
}
