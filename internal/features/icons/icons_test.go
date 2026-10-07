package icons

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	marker2000 = "5991b51486f77447b112d44f"
	otherItem  = "6575a6ca8778e96ded05a802"
)

// A 1x1 WebP: the smallest valid icon.
var tinyWebP = []byte("RIFF\x1a\x00\x00\x00WEBPVP8L\x0d\x00\x00\x00/\x00\x00\x00\x10\x07\x10\x11\x11\x88\x88\xfe\x07\x00")

func TestOnlyTwentyFourLowerCaseHexDigitsAreAnItemId(t *testing.T) {
	cases := map[string]bool{
		marker2000:                    true,
		"5991B51486F77447B112D44F":    false,
		"5991b51486f77447b112d44":     false,
		"5991b51486f77447b112d44f0":   false,
		"../../etc/passwd":            false,
		"5991b51486f77447b112d44g":    false,
		"":                            false,
		marker2000 + "/../other":      false,
		"5991b51486f77447b112d44f.js": false,
	}
	for text, want := range cases {
		if got := IsItemID(text); got != want {
			t.Errorf("IsItemID(%q) = %v, want %v", text, got, want)
		}
	}
}

func TestARequestPathNamesOneWebpFile(t *testing.T) {
	if id, ok := ItemIDFromFileName(marker2000 + ".webp"); !ok || id != marker2000 {
		t.Errorf("got %q %v", id, ok)
	}
	for _, name := range []string{marker2000 + ".png", marker2000, "x" + marker2000 + ".webp", marker2000 + ".webp/x", ".webp"} {
		if _, ok := ItemIDFromFileName(name); ok {
			t.Errorf("%q was accepted", name)
		}
	}
}

func TestAFailedDownloadIsRememberedForTenMinutes(t *testing.T) {
	failed := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	if MayTryAgain(failed, failed.Add(9*time.Minute)) {
		t.Error("retried after 9 minutes")
	}
	if !MayTryAgain(failed, failed.Add(10*time.Minute)) {
		t.Error("not retried after 10 minutes")
	}
}

// fakeAssets serves icons and counts the requests per path.
type fakeAssets struct {
	server   *httptest.Server
	requests atomic.Int32
	handler  func(writer http.ResponseWriter, request *http.Request)
}

func newFakeAssets(t *testing.T, handler func(http.ResponseWriter, *http.Request)) *fakeAssets {
	t.Helper()
	assets := &fakeAssets{handler: handler}
	assets.server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assets.requests.Add(1)
		assets.handler(writer, request)
	}))
	t.Cleanup(assets.server.Close)
	return assets
}

func serveTinyIcon(writer http.ResponseWriter, _ *http.Request) { writer.Write(tinyWebP) }

func TestTheFirstRequestDownloadsAndLaterOnesComeFromDisk(t *testing.T) {
	assets := newFakeAssets(t, func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/"+marker2000+"-icon.webp" {
			t.Errorf("asked for %s", request.URL.Path)
		}
		serveTinyIcon(writer, request)
	})
	dir := filepath.Join(t.TempDir(), "squad-task-map-icons")
	cache := NewCache(dir, assets.server.URL, "test")

	path, err := cache.Path(context.Background(), marker2000)
	if err != nil {
		t.Fatal(err)
	}
	if path != filepath.Join(dir, marker2000+".webp") {
		t.Errorf("path %s", path)
	}
	if data, _ := os.ReadFile(path); string(data) != string(tinyWebP) {
		t.Error("the stored file isn't the icon")
	}
	// A new cache (a restart) with the same folder needs no network.
	assets.server.Close()
	restarted := NewCache(dir, assets.server.URL, "test")
	if _, err := restarted.Path(context.Background(), marker2000); err != nil {
		t.Errorf("not served from the folder: %v", err)
	}
	if assets.requests.Load() != 1 {
		t.Errorf("%d requests, want 1", assets.requests.Load())
	}
}

func TestRequestsForOneIdAtTheSameTimeDownloadItOnce(t *testing.T) {
	release := make(chan struct{})
	assets := newFakeAssets(t, func(writer http.ResponseWriter, request *http.Request) {
		<-release
		serveTinyIcon(writer, request)
	})
	cache := NewCache(t.TempDir(), assets.server.URL, "test")

	var waiting sync.WaitGroup
	for range 10 {
		waiting.Add(1)
		go func() {
			defer waiting.Done()
			if _, err := cache.Path(context.Background(), otherItem); err != nil {
				t.Error(err)
			}
		}()
	}
	time.Sleep(100 * time.Millisecond)
	close(release)
	waiting.Wait()
	if assets.requests.Load() != 1 {
		t.Errorf("%d downloads, want 1", assets.requests.Load())
	}
}

func TestAFailedDownloadIsNotRetriedUntilTheWaitIsOver(t *testing.T) {
	assets := newFakeAssets(t, func(writer http.ResponseWriter, _ *http.Request) { http.NotFound(writer, nil) })
	cache := NewCache(t.TempDir(), assets.server.URL, "test")
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	cache.now = func() time.Time { return now }

	for range 3 {
		if _, err := cache.Path(context.Background(), marker2000); err != ErrUnavailable {
			t.Fatalf("got %v, want ErrUnavailable", err)
		}
	}
	if assets.requests.Load() != 1 {
		t.Errorf("%d requests while waiting, want 1", assets.requests.Load())
	}
	now = now.Add(RetryFailedAfter)
	cache.Path(context.Background(), marker2000)
	if assets.requests.Load() != 2 {
		t.Errorf("%d requests after the wait, want 2", assets.requests.Load())
	}
}

func TestBadAnswersAreNeverStored(t *testing.T) {
	cases := map[string]func(http.ResponseWriter, *http.Request){
		"too big": func(writer http.ResponseWriter, _ *http.Request) {
			writer.Write(append([]byte("RIFF\x00\x00\x00\x00WEBP"), make([]byte, MaxIconBytes)...))
		},
		"not a WebP": func(writer http.ResponseWriter, _ *http.Request) { writer.Write([]byte("<html>captive portal</html>")) },
		"redirect to another host": func(writer http.ResponseWriter, request *http.Request) {
			http.Redirect(writer, request, "http://example.invalid/x.webp", http.StatusFound)
		},
	}
	for name, handler := range cases {
		t.Run(name, func(t *testing.T) {
			assets := newFakeAssets(t, handler)
			dir := t.TempDir()
			cache := NewCache(dir, assets.server.URL, "test")
			if _, err := cache.Path(context.Background(), marker2000); err != ErrUnavailable {
				t.Fatalf("got %v, want ErrUnavailable", err)
			}
			if entries, _ := os.ReadDir(dir); len(entries) != 0 {
				t.Errorf("%d files stored", len(entries))
			}
		})
	}
}

func TestANotAnIdRequestNeverReachesTheNetwork(t *testing.T) {
	assets := newFakeAssets(t, serveTinyIcon)
	cache := NewCache(t.TempDir(), assets.server.URL, "test")
	for _, id := range []string{"../secret", "ABC", marker2000 + "x"} {
		if _, err := cache.Path(context.Background(), id); err != ErrUnavailable {
			t.Errorf("%q: got %v", id, err)
		}
	}
	if assets.requests.Load() != 0 {
		t.Error("the network was used")
	}
}
