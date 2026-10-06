// Test helpers shared by the updates tests: a signing key pair made on the fly (the private key
// exists only in test memory), and a fake GitHub that answers like the real one does.
package updates

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// testKeys makes a fresh key pair for one test.
func testKeys(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return publicKey, privateKey
}

func publicKeyText(publicKey ed25519.PublicKey) string {
	return base64.StdEncoding.EncodeToString(publicKey)
}

// fakeExe is a made-up exe of the given size.
func fakeExe(size int) []byte {
	data := make([]byte, size)
	for index := range data {
		data[index] = byte(index*7 + 3)
	}
	return data
}

// signedManifest builds a signed manifest for an exe.
func signedManifest(privateKey ed25519.PrivateKey, version string, exe []byte) Manifest {
	sum := sha256.Sum256(exe)
	manifest := Manifest{
		Version:  version,
		Released: "2026-10-20",
		Notes:    "• Check for updates\n• Fewer <bugs> & more fixes",
		File:     FileInfo{Name: ExeFileName, Size: int64(len(exe)), SHA256: hex.EncodeToString(sum[:])},
	}
	return SignManifest(manifest, privateKey)
}

// fakeGitHub answers the three kinds of address the app uses, with GitHub's redirects:
//
//	/repo/releases/latest/download/latest.json      -> 302 -> /repo/releases/download/v<ver>/latest.json -> 302 -> /objects/<ver>/latest.json
//	/repo/releases/download/v<ver>/SquadTaskMap.exe -> 302 -> /objects/<ver>/SquadTaskMap.exe
//
// Tests change the fields to make it misbehave.
type fakeGitHub struct {
	server *httptest.Server

	mutex    sync.Mutex
	requests []string // "GET /path", in order

	version      string // the latest release; "" means no release yet (404)
	manifestJSON []byte // what latest.json contains
	exe          []byte // what the exe asset contains
	// manifestRedirectTo, if set, is where the latest.json address redirects instead.
	manifestRedirectTo string
	// exeHandler, if set, serves the exe asset itself (slow or broken downloads).
	exeHandler http.HandlerFunc
	// status, if non-zero, is answered for latest.json instead of the manifest.
	status int
}

func newFakeGitHub(t *testing.T) *fakeGitHub {
	t.Helper()
	github := &fakeGitHub{}
	github.server = httptest.NewServer(http.HandlerFunc(github.serve))
	t.Cleanup(github.server.Close)
	return github
}

// base is what STM_UPDATES_BASE would be.
func (github *fakeGitHub) base() string { return github.server.URL + "/repo" }

// publish makes version the latest release with this exe, signed by privateKey.
func (github *fakeGitHub) publish(privateKey ed25519.PrivateKey, version string, exe []byte) Manifest {
	manifest := signedManifest(privateKey, version, exe)
	data, _ := json.Marshal(manifest)
	github.mutex.Lock()
	defer github.mutex.Unlock()
	github.version, github.manifestJSON, github.exe = version, data, exe
	return manifest
}

// requestCount is how many requests reached the fake.
func (github *fakeGitHub) requestCount() int {
	github.mutex.Lock()
	defer github.mutex.Unlock()
	return len(github.requests)
}

func (github *fakeGitHub) serve(writer http.ResponseWriter, request *http.Request) {
	github.mutex.Lock()
	github.requests = append(github.requests, request.Method+" "+request.URL.Path)
	version, manifestJSON, exe := github.version, github.manifestJSON, github.exe
	redirectTo, exeHandler, status := github.manifestRedirectTo, github.exeHandler, github.status
	github.mutex.Unlock()

	path := request.URL.Path
	switch {
	case path == "/repo/releases/latest/download/latest.json":
		if status != 0 {
			writer.WriteHeader(status)
			return
		}
		if version == "" {
			http.NotFound(writer, request)
			return
		}
		if redirectTo != "" {
			http.Redirect(writer, request, redirectTo, http.StatusFound)
			return
		}
		http.Redirect(writer, request, fmt.Sprintf("/repo/releases/download/v%s/latest.json", version), http.StatusFound)
	case strings.HasPrefix(path, "/repo/releases/download/") && strings.HasSuffix(path, "/latest.json"):
		http.Redirect(writer, request, "/objects/"+version+"/latest.json", http.StatusFound)
	case strings.HasPrefix(path, "/repo/releases/download/") && strings.HasSuffix(path, "/SquadTaskMap.exe"):
		http.Redirect(writer, request, "/objects/"+version+"/SquadTaskMap.exe", http.StatusFound)
	case strings.HasSuffix(path, "/latest.json"):
		writer.Write(manifestJSON)
	case strings.HasSuffix(path, "/SquadTaskMap.exe"):
		if exeHandler != nil {
			exeHandler(writer, request)
			return
		}
		writer.Write(exe)
	default:
		http.NotFound(writer, request)
	}
}

// testSource is a Source that talks to the fake.
func (github *fakeGitHub) testSource() Source { return NewSource(github.base(), "test") }
