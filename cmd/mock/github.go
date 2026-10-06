// The mock's fake GitHub Releases, for testing "Check for updates" (ticket 04c) offline. It
// answers the addresses the app uses, with the same redirects GitHub sends, and can misbehave on
// request (bad signature, bad hash, wrong size, off-allowlist redirect...). Manifests are signed
// with the TEST key in testdata/updates/: never the owner's real key.

package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"squadtaskmap/internal/features/updates"
)

// The fake GitHub lives under these paths of the mock. Point the app at it with
// STM_UPDATES_BASE=http://127.0.0.1:7820/github/01Never/EFT-Squad-Task-Map
const (
	githubPrefix = "/github/"
	// downloadHostPrefix stands in for GitHub's download host (objects.githubusercontent.com):
	// release asset addresses redirect here, as they do on the real GitHub.
	downloadHostPrefix = "/github-objects/"
	githubControlPath  = "/github-set"
)

// Faults that POST /github-set can switch on (field "fault").
const (
	faultBadSignature     = "bad-signature"          // the manifest is signed by someone else
	faultBadHash          = "bad-hash"               // the exe differs from the hash in the manifest
	faultWrongSize        = "wrong-size"             // the exe is shorter than the manifest says
	faultOversize         = "oversize"               // the exe is twice as long as the manifest says
	faultOffAllowlist     = "off-allowlist-redirect" // redirects to another host name
	faultHugeManifest     = "huge-manifest"          // a validly signed manifest over 64 KB
	faultServerError      = "server-error"           // 503 for latest.json
	faultSlowDownload     = "slow-download"          // the exe arrives slowly, to see progress and cancel
	slowChunkBytes        = 16 * 1024
	slowChunkDelay        = 100 * time.Millisecond
	defaultReleaseVersion = "9.9.9"
	defaultExeSizeBytes   = 200 * 1024
)

// githubState is what the fake GitHub currently serves.
type githubState struct {
	published bool   // false: "no release yet" (404)
	version   string // the latest release's version
	notes     string
	exeSize   int    // bytes of the fake exe (ignored when exeFile is set)
	exeFile   string // MOCK_UPDATE_EXE: serve this real file as the exe
	fault     string
}

func defaultGitHubState() githubState {
	return githubState{
		published: true,
		version:   defaultReleaseVersion,
		notes:     "• Mock release notes\n• Second line",
		exeSize:   defaultExeSizeBytes,
		exeFile:   os.Getenv("MOCK_UPDATE_EXE"),
	}
}

// loadSigningKey reads the test key pair's private half from testdata/updates/.
func loadSigningKey(testdataFolder string) (ed25519.PrivateKey, error) {
	path := filepath.Join(testdataFolder, "updates", "mock-private-key.txt")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading the mock's test signing key: %w", err)
	}
	return updates.ParsePrivateKey(string(data))
}

// strangerKey signs the "bad-signature" manifests: a fixed key nobody trusts.
func strangerKey() ed25519.PrivateKey {
	seed := sha256.Sum256([]byte("the mock's untrusted signer"))
	return ed25519.NewKeyFromSeed(seed[:])
}

// ---------------------------------------------------------------- serving

// handleGitHub answers every address under /github/ and /github-objects/.
func (mock *mockServer) handleGitHub(writer http.ResponseWriter, request *http.Request, path string) {
	mock.addToLog("github " + path)
	state := mock.githubSnapshot()

	switch {
	case strings.HasPrefix(path, downloadHostPrefix):
		mock.serveDownloadHost(writer, request, state, path)
	case strings.HasSuffix(path, "/releases/latest/download/"+updates.ManifestFileName):
		mock.serveLatestAddress(writer, request, state)
	case strings.Contains(path, "/releases/download/v"):
		mock.serveReleaseAsset(writer, request, state, path)
	default:
		writeText(writer, http.StatusNotFound, "nf")
	}
}

// serveLatestAddress is .../releases/latest/download/latest.json: 404 with no release, else a
// redirect to the release's own address (as GitHub does).
func (mock *mockServer) serveLatestAddress(writer http.ResponseWriter, request *http.Request, state githubState) {
	if state.fault == faultServerError {
		writeText(writer, http.StatusServiceUnavailable, "down")
		return
	}
	if !state.published {
		writeText(writer, http.StatusNotFound, "nf")
		return
	}
	repoPath := strings.TrimSuffix(request.URL.Path, "/releases/latest/download/"+updates.ManifestFileName)
	redirectTo(writer, request, state, repoPath+"/releases/download/v"+state.version+"/"+updates.ManifestFileName)
}

// serveReleaseAsset is .../releases/download/v<version>/<file>: a redirect to the download host.
func (mock *mockServer) serveReleaseAsset(writer http.ResponseWriter, request *http.Request, state githubState, path string) {
	versionAndFile := strings.SplitN(path, "/releases/download/v", 2)[1] // "9.9.9/SquadTaskMap.exe"
	redirectTo(writer, request, state, downloadHostPrefix+versionAndFile)
}

// redirectTo sends a 302. With the off-allowlist fault, the final hop to the download host goes
// to a different host name (localhost instead of 127.0.0.1, or the reverse), which the app's
// allowlist must refuse.
func redirectTo(writer http.ResponseWriter, request *http.Request, state githubState, target string) {
	if state.fault == faultOffAllowlist && strings.HasPrefix(target, downloadHostPrefix) {
		target = "http://" + otherNameForThisHost(request.Host) + target
	}
	http.Redirect(writer, request, target, http.StatusFound)
}

func otherNameForThisHost(host string) string {
	if strings.HasPrefix(host, "127.0.0.1") {
		return strings.Replace(host, "127.0.0.1", "localhost", 1)
	}
	return "127.0.0.1" + host[strings.LastIndex(host, ":"):]
}

// serveDownloadHost is the "download host": the manifest and the exe themselves.
func (mock *mockServer) serveDownloadHost(writer http.ResponseWriter, request *http.Request, state githubState, path string) {
	switch {
	case strings.HasSuffix(path, "/"+updates.ManifestFileName):
		mock.serveManifest(writer, state)
	case strings.HasSuffix(path, "/"+updates.ExeFileName):
		mock.serveExe(writer, request, state)
	default:
		writeText(writer, http.StatusNotFound, "nf")
	}
}

func (mock *mockServer) serveManifest(writer http.ResponseWriter, state githubState) {
	exe, err := state.honestExe()
	if err != nil {
		writeServerError(writer, err)
		return
	}
	sum := sha256.Sum256(exe)
	manifest := updates.Manifest{
		Version:  state.version,
		Released: time.Now().UTC().Format("2006-01-02"),
		Notes:    state.notes,
		File: updates.FileInfo{
			Name: updates.ExeFileName, Size: int64(len(exe)), SHA256: hex.EncodeToString(sum[:]),
		},
	}
	if state.fault == faultHugeManifest {
		manifest.Notes = strings.Repeat("padding ", updates.MaxManifestBytes/8+10)
	}
	key := mock.signingKey
	if state.fault == faultBadSignature {
		key = strangerKey()
	}
	data, err := json.MarshalIndent(updates.SignManifest(manifest, key), "", "  ")
	if err != nil {
		writeServerError(writer, err)
		return
	}
	writer.Header().Set("Content-Type", "application/json")
	writer.Write(data)
}

func (mock *mockServer) serveExe(writer http.ResponseWriter, request *http.Request, state githubState) {
	exe, err := state.honestExe()
	if err != nil {
		writeServerError(writer, err)
		return
	}
	exe = state.exeAfterFault(exe)
	writer.Header().Set("Content-Type", "application/octet-stream")
	if state.fault != faultSlowDownload {
		writer.Header().Set("Content-Length", fmt.Sprint(len(exe)))
		writer.Write(exe)
		return
	}
	sendSlowly(writer, request, exe)
}

// sendSlowly writes the exe in small pieces with a pause between them, until it is all sent or
// the app hangs up (a cancelled download).
func sendSlowly(writer http.ResponseWriter, request *http.Request, exe []byte) {
	flusher, canFlush := writer.(http.Flusher)
	reader := bytes.NewReader(exe)
	chunk := make([]byte, slowChunkBytes)
	for {
		count, err := reader.Read(chunk)
		if count > 0 {
			writer.Write(chunk[:count])
			if canFlush {
				flusher.Flush()
			}
		}
		if err == io.EOF {
			return
		}
		select {
		case <-request.Context().Done():
			return
		case <-time.After(slowChunkDelay):
		}
	}
}

// honestExe is the exe the manifest describes: a fake one of exeSize bytes, or the real file.
func (state githubState) honestExe() ([]byte, error) {
	if state.exeFile != "" {
		return os.ReadFile(state.exeFile)
	}
	exe := make([]byte, state.exeSize)
	header := []byte("MZ mock exe v" + state.version + "\n")
	copy(exe, header)
	for index := len(header); index < len(exe); index++ {
		exe[index] = byte(index*7 + 3)
	}
	return exe, nil
}

// exeAfterFault is what is actually served: the honest exe, damaged as the fault says.
func (state githubState) exeAfterFault(honest []byte) []byte {
	damaged := append([]byte{}, honest...)
	switch state.fault {
	case faultBadHash:
		damaged[len(damaged)/2] ^= 0xFF
	case faultWrongSize:
		damaged = damaged[:len(damaged)-10]
	case faultOversize:
		damaged = append(damaged, honest...)
	}
	return damaged
}

// ---------------------------------------------------------------- controls

func (mock *mockServer) githubSnapshot() githubState {
	mock.mutex.Lock()
	defer mock.mutex.Unlock()
	return mock.github
}

// handleGitHubSet answers POST /github-set. The JSON body may hold any of:
//
//	"release": "none" | "published"   (none: latest.json answers 404)
//	"version": "2.6.0"                (set an older one to try "older version")
//	"notes": "...", "exeSize": 200000
//	"fault":  "" | bad-signature | bad-hash | wrong-size | oversize | off-allowlist-redirect |
//	          huge-manifest | server-error | slow-download
//
// Fields that aren't sent keep their value. {"reset": true} restores the defaults.
func (mock *mockServer) handleGitHubSet(writer http.ResponseWriter, request *http.Request) {
	var change struct {
		Reset   bool    `json:"reset"`
		Release *string `json:"release"`
		Version *string `json:"version"`
		Notes   *string `json:"notes"`
		ExeSize *int    `json:"exeSize"`
		Fault   *string `json:"fault"`
	}
	if err := json.NewDecoder(request.Body).Decode(&change); err != nil {
		writeServerError(writer, fmt.Errorf("the /github-set body: %w", err))
		return
	}
	mock.mutex.Lock()
	state := mock.github
	if change.Reset {
		state = defaultGitHubState()
	}
	if change.Release != nil {
		state.published = *change.Release != "none"
	}
	if change.Version != nil {
		state.version = *change.Version
	}
	if change.Notes != nil {
		state.notes = *change.Notes
	}
	if change.ExeSize != nil && *change.ExeSize > 0 {
		state.exeSize = *change.ExeSize
	}
	if change.Fault != nil {
		state.fault = *change.Fault
	}
	mock.github = state
	mock.mutex.Unlock()
	writeOK(writer)
}
