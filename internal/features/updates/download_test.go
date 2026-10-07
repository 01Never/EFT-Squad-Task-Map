package updates

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func downloadTarget(t *testing.T) string {
	return filepath.Join(t.TempDir(), "SquadTaskMap.download.exe")
}

func TestTheExeIsDownloadedAndVerifiedAgainstTheManifest(t *testing.T) {
	_, privateKey := testKeys(t)
	github := newFakeGitHub(t)
	exe := fakeExe(300_000)
	manifest := github.publish(privateKey, "2.6.0", exe)
	destination := downloadTarget(t)

	var reports []int64
	err := github.testSource().DownloadExe(context.Background(), manifest, destination, func(done, total int64) {
		if total != manifest.File.Size {
			t.Errorf("total = %d, want the manifest's %d", total, manifest.File.Size)
		}
		reports = append(reports, done)
	})
	if err != nil {
		t.Fatalf("DownloadExe: %v", err)
	}
	saved, _ := os.ReadFile(destination)
	if string(saved) != string(exe) {
		t.Fatal("the saved file differs from the exe")
	}
	if len(reports) < 2 || reports[len(reports)-1] != manifest.File.Size {
		t.Fatalf("progress reports %v must grow and end at the full size", reports)
	}
	for index := 1; index < len(reports); index++ {
		if reports[index] <= reports[index-1] {
			t.Fatalf("progress went backwards: %v", reports)
		}
	}
}

func TestADownloadThatDoesNotMatchTheManifestIsRefusedAndDeleted(t *testing.T) {
	_, privateKey := testKeys(t)
	exe := fakeExe(10_000)

	tests := []struct {
		name     string
		served   func() []byte
		wantCode string
	}{
		{"one byte changed (bad hash)", func() []byte {
			changed := append([]byte{}, exe...)
			changed[5000] ^= 0xFF
			return changed
		}, CodeBadHash},
		{"a few bytes short (wrong size)", func() []byte { return exe[:len(exe)-3] }, CodeBadSize},
		{"a few bytes extra, within the 10% slack (wrong size)", func() []byte { return append(append([]byte{}, exe...), 1, 2, 3) }, CodeBadSize},
		{"far bigger than announced (cut off by the cap)", func() []byte { return append(append([]byte{}, exe...), make([]byte, len(exe))...) }, CodeBadSize},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			github := newFakeGitHub(t)
			manifest := github.publish(privateKey, "2.6.0", exe) // the manifest describes the real exe
			github.exe = test.served()                           // ...but this is what gets served
			destination := downloadTarget(t)

			err := github.testSource().DownloadExe(context.Background(), manifest, destination, nil)
			if errorCode(err) != test.wantCode {
				t.Fatalf("error = %v, want code %s", err, test.wantCode)
			}
			if _, statErr := os.Stat(destination); !os.IsNotExist(statErr) {
				t.Fatal("a refused download must not be left on disk")
			}
		})
	}
}

func TestAnOversizedDownloadIsCutOffAtTheCap(t *testing.T) {
	_, privateKey := testKeys(t)
	exe := fakeExe(10_000)
	github := newFakeGitHub(t)
	manifest := github.publish(privateKey, "2.6.0", exe)
	delivered := make(chan int, 1)
	github.exeHandler = func(writer http.ResponseWriter, _ *http.Request) {
		// No Content-Length: the app can only stop it by counting.
		total := 0
		chunk := make([]byte, 4096)
		for total < 64_000_000 { // far more than loopback socket buffers can hold
			count, err := writer.Write(chunk)
			total += count
			if err != nil {
				break
			}
		}
		delivered <- total
	}

	err := github.testSource().DownloadExe(context.Background(), manifest, downloadTarget(t), nil)
	if errorCode(err) != CodeBadSize {
		t.Fatalf("error = %v, want code %s", err, CodeBadSize)
	}
	if sent := <-delivered; sent >= 64_000_000 {
		t.Fatalf("the app kept reading all %d bytes instead of stopping at the cap", sent)
	}
}

func TestADownloadRedirectedToAnotherHostIsRefused(t *testing.T) {
	_, privateKey := testKeys(t)
	github := newFakeGitHub(t)
	manifest := github.publish(privateKey, "2.6.0", fakeExe(1000))
	otherHost := strings.Replace(github.server.URL, "127.0.0.1", "localhost", 1)
	github.exeHandler = func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, otherHost+"/elsewhere.exe", http.StatusFound)
	}

	err := github.testSource().DownloadExe(context.Background(), manifest, downloadTarget(t), nil)
	if errorCode(err) != CodeRedirectRefused {
		t.Fatalf("error = %v, want code %s", err, CodeRedirectRefused)
	}
}

func TestADownloadThatGitHubRefusesIsReported(t *testing.T) {
	_, privateKey := testKeys(t)
	github := newFakeGitHub(t)
	manifest := github.publish(privateKey, "2.6.0", fakeExe(1000))
	github.exeHandler = func(writer http.ResponseWriter, _ *http.Request) { writer.WriteHeader(http.StatusNotFound) }

	err := github.testSource().DownloadExe(context.Background(), manifest, downloadTarget(t), nil)
	if errorCode(err) != CodeDownloadFailed {
		t.Fatalf("error = %v, want code %s", err, CodeDownloadFailed)
	}
}

func TestACancelledDownloadStopsAndDeletesThePartialFile(t *testing.T) {
	_, privateKey := testKeys(t)
	github := newFakeGitHub(t)
	exe := fakeExe(500_000)
	manifest := github.publish(privateKey, "2.6.0", exe)
	github.exeHandler = func(writer http.ResponseWriter, request *http.Request) {
		// Send the first half, then wait for the app to give up.
		writer.Write(exe[:len(exe)/2])
		writer.(http.Flusher).Flush()
		<-request.Context().Done()
	}
	destination := downloadTarget(t)
	ctx, cancel := context.WithCancel(context.Background())
	halfway := make(chan struct{})
	var reachedHalfway sync.Once

	finished := make(chan error, 1)
	go func() {
		finished <- github.testSource().DownloadExe(ctx, manifest, destination, func(done, _ int64) {
			if done >= manifest.File.Size/2 {
				reachedHalfway.Do(func() { close(halfway) })
			}
		})
	}()

	<-halfway
	cancel()
	select {
	case err := <-finished:
		if errorCode(err) != CodeCancelled {
			t.Fatalf("error = %v, want code %s", err, CodeCancelled)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancel did not stop the download")
	}
	if _, statErr := os.Stat(destination); !os.IsNotExist(statErr) {
		t.Fatal("the partial file must be deleted after a cancel")
	}
}

func TestAFileOnDiskIsVerifiedAgainstTheManifestAgain(t *testing.T) {
	exe := fakeExe(2000)
	sum := sha256.Sum256(exe)
	expected := FileInfo{Name: ExeFileName, Size: int64(len(exe)), SHA256: hex.EncodeToString(sum[:])}
	path := filepath.Join(t.TempDir(), "SquadTaskMap.download.exe")

	if err := VerifyFile(path, expected); errorCode(err) != CodeNothingToApply {
		t.Fatalf("a missing file: %v", err)
	}
	os.WriteFile(path, exe, 0o644)
	if err := VerifyFile(path, expected); err != nil {
		t.Fatalf("the right file: %v", err)
	}
	os.WriteFile(path, append([]byte{}, exe[:1999]...), 0o644)
	if err := VerifyFile(path, expected); errorCode(err) != CodeBadSize {
		t.Fatalf("a shorter file: %v", err)
	}
	tampered := append([]byte{}, exe...)
	tampered[0] ^= 1
	os.WriteFile(path, tampered, 0o644)
	if err := VerifyFile(path, expected); errorCode(err) != CodeBadHash {
		t.Fatalf("a changed file: %v", err)
	}
}
