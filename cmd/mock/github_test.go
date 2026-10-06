// Tests for the fake GitHub Releases. They talk to it with the app's own update code
// (internal/features/updates), so they also show that the mock and the app agree.

package main

import (
	"context"
	"crypto/ed25519"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"squadtaskmap/internal/features/updates"
)

const testdataFolder = "../../testdata"

// githubRig is the mock served over HTTP, with the app's update client pointed at it.
type githubRig struct {
	t         *testing.T
	mock      *mockServer
	server    *httptest.Server
	source    updates.Source
	publicKey ed25519.PublicKey
}

func newGitHubRig(t *testing.T) *githubRig {
	t.Helper()
	mock := newTestMock(t)
	signingKey, err := loadSigningKey(testdataFolder)
	if err != nil {
		t.Fatal(err)
	}
	mock.signingKey = signingKey
	server := httptest.NewServer(mock)
	t.Cleanup(server.Close)

	publicText, err := os.ReadFile(filepath.Join(testdataFolder, "updates", "mock-public-key.txt"))
	if err != nil {
		t.Fatal(err)
	}
	publicKey, err := updates.ParsePublicKey(string(publicText))
	if err != nil {
		t.Fatal(err)
	}
	base := server.URL + "/github/01Never/EFT-Squad-Task-Map"
	return &githubRig{t: t, mock: mock, server: server, source: updates.NewSource(base, "test"), publicKey: publicKey}
}

func (rig *githubRig) set(body string) {
	rig.t.Helper()
	recorder := send(rig.mock, http.MethodPost, githubControlPath, body, nil)
	if recorder.Code != http.StatusOK {
		rig.t.Fatalf("/github-set %s answered %d %s", body, recorder.Code, recorder.Body.String())
	}
}

func (rig *githubRig) logLines() []string {
	rig.mock.mutex.Lock()
	defer rig.mock.mutex.Unlock()
	return append([]string{}, rig.mock.requestLog...)
}

func codeOf(err error) string {
	if updateError, isUpdateError := err.(*updates.Error); isUpdateError {
		return updateError.Code
	}
	if err == nil {
		return ""
	}
	return "other: " + err.Error()
}

func TestTheMocksTestKeyPairMatches(t *testing.T) {
	privateKey, err := loadSigningKey(testdataFolder)
	if err != nil {
		t.Fatal(err)
	}
	publicText, _ := os.ReadFile(filepath.Join(testdataFolder, "updates", "mock-public-key.txt"))
	publicKey, err := updates.ParsePublicKey(string(publicText))
	if err != nil || !publicKey.Equal(privateKey.Public()) {
		t.Fatalf("mock-public-key.txt must be the public half of mock-private-key.txt (%v)", err)
	}
	if realKey, _ := updates.ParsePublicKey(updates.EmbeddedPublicKey); realKey != nil && realKey.Equal(publicKey) {
		t.Fatal("the app must never trust the mock's test key")
	}
}

func TestTheFakeGitHubLogsNothingUntilTheAppAsksForAnUpdate(t *testing.T) {
	rig := newGitHubRig(t)
	rig.set(`{"version":"9.9.9"}`)
	send(rig.mock, http.MethodGet, "/regular/tasks", "", nil) // other traffic is not update traffic

	for _, line := range rig.logLines() {
		if strings.HasPrefix(line, "github ") {
			t.Fatalf("update request in the log before any check: %s", line)
		}
	}

	if _, err := rig.source.FetchManifest(context.Background(), rig.publicKey); err != nil {
		t.Fatal(err)
	}
	var githubLines []string
	for _, line := range rig.logLines() {
		if strings.HasPrefix(line, "github ") {
			githubLines = append(githubLines, line)
		}
	}
	want := []string{
		"github /github/01Never/EFT-Squad-Task-Map/releases/latest/download/latest.json",
		"github /github/01Never/EFT-Squad-Task-Map/releases/download/v9.9.9/latest.json",
		"github /github-objects/9.9.9/latest.json",
	}
	if strings.Join(githubLines, "\n") != strings.Join(want, "\n") {
		t.Fatalf("log:\n%s\nwant:\n%s", strings.Join(githubLines, "\n"), strings.Join(want, "\n"))
	}
}

func TestTheFakeGitHubServesAPublishedReleaseThatTheAppAccepts(t *testing.T) {
	rig := newGitHubRig(t)
	rig.set(`{"version":"2.6.0","notes":"• Hello","exeSize":50000}`)

	manifest, err := rig.source.FetchManifest(context.Background(), rig.publicKey)
	if err != nil {
		t.Fatalf("FetchManifest: %v", err)
	}
	if manifest.Version != "2.6.0" || manifest.Notes != "• Hello" || manifest.File.Size != 50000 {
		t.Fatalf("manifest = %+v", manifest)
	}
	destination := filepath.Join(t.TempDir(), "SquadTaskMap.download.exe")
	if err := rig.source.DownloadExe(context.Background(), manifest, destination, nil); err != nil {
		t.Fatalf("DownloadExe: %v", err)
	}
}

func TestTheFakeGitHubCanHaveNoReleaseYet(t *testing.T) {
	rig := newGitHubRig(t)
	rig.set(`{"release":"none"}`)

	_, err := rig.source.FetchManifest(context.Background(), rig.publicKey)

	if codeOf(err) != updates.CodeNoRelease {
		t.Fatalf("error = %v", err)
	}
}

func TestEachFaultIsRefusedByTheApp(t *testing.T) {
	tests := []struct {
		name         string
		fault        string
		wantAtCheck  string // the error code when checking, or ""
		wantAtDownld string // the error code when downloading, or ""
	}{
		{"a manifest signed by someone else", faultBadSignature, updates.CodeBadSignature, ""},
		{"an exe that doesn't match the hash", faultBadHash, "", updates.CodeBadHash},
		{"an exe shorter than announced", faultWrongSize, "", updates.CodeBadSize},
		{"an exe longer than announced", faultOversize, "", updates.CodeBadSize},
		{"a redirect to another host name", faultOffAllowlist, updates.CodeRedirectRefused, ""},
		{"a manifest over 64 KB", faultHugeManifest, updates.CodeManifestTooLarge, ""},
		{"GitHub down", faultServerError, updates.CodeGitHubUnreachable, ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			rig := newGitHubRig(t)
			rig.set(`{"version":"2.6.0","exeSize":20000,"fault":"` + test.fault + `"}`)

			manifest, err := rig.source.FetchManifest(context.Background(), rig.publicKey)
			if codeOf(err) != test.wantAtCheck {
				t.Fatalf("check: error = %v, want code %q", err, test.wantAtCheck)
			}
			if test.wantAtCheck != "" {
				return
			}
			destination := filepath.Join(t.TempDir(), "SquadTaskMap.download.exe")
			err = rig.source.DownloadExe(context.Background(), manifest, destination, nil)
			if codeOf(err) != test.wantAtDownld {
				t.Fatalf("download: error = %v, want code %q", err, test.wantAtDownld)
			}
		})
	}
}

func TestADownloadRedirectedOffTheAllowlistIsRefused(t *testing.T) {
	rig := newGitHubRig(t)
	rig.set(`{"version":"2.6.0","exeSize":20000}`)
	manifest, err := rig.source.FetchManifest(context.Background(), rig.publicKey)
	if err != nil {
		t.Fatal(err)
	}
	rig.set(`{"fault":"off-allowlist-redirect"}`)

	err = rig.source.DownloadExe(context.Background(), manifest, filepath.Join(t.TempDir(), "x.exe"), nil)

	if codeOf(err) != updates.CodeRedirectRefused {
		t.Fatalf("error = %v", err)
	}
}

func TestAnOlderReleaseIsServedAndTheAppRefusesToInstallIt(t *testing.T) {
	rig := newGitHubRig(t)
	rig.set(`{"version":"2.4.0"}`)

	manifest, err := rig.source.FetchManifest(context.Background(), rig.publicKey)
	if err != nil {
		t.Fatal(err)
	}
	_, err = updates.DecideResult("2.5.0", manifest)

	if codeOf(err) != updates.CodeOlderVersion {
		t.Fatalf("error = %v", err)
	}
}

func TestResetRestoresTheDefaultRelease(t *testing.T) {
	rig := newGitHubRig(t)
	rig.set(`{"release":"none","fault":"bad-hash","version":"1.0.0"}`)
	rig.set(`{"reset":true}`)

	manifest, err := rig.source.FetchManifest(context.Background(), rig.publicKey)
	if err != nil || manifest.Version != defaultReleaseVersion {
		t.Fatalf("manifest %+v, error %v", manifest, err)
	}
}

func TestTheSlowDownloadReportsProgressAndCanBeCancelled(t *testing.T) {
	rig := newGitHubRig(t)
	rig.set(`{"version":"2.6.0","exeSize":200000,"fault":"slow-download"}`)
	manifest, err := rig.source.FetchManifest(context.Background(), rig.publicKey)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	destination := filepath.Join(t.TempDir(), "SquadTaskMap.download.exe")

	err = rig.source.DownloadExe(ctx, manifest, destination, func(done, total int64) {
		if done > 0 {
			cancel() // give up after the first chunk
		}
	})

	if codeOf(err) != updates.CodeCancelled {
		t.Fatalf("error = %v, want a cancelled download", err)
	}
}
