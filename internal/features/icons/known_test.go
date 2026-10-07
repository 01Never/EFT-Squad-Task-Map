package icons

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// newOpenCache is a cache that knows every id (for the tests of the download itself).
func newOpenCache(dir, assetsBase, userAgent string) *Cache {
	cache := NewCache(dir, assetsBase, userAgent)
	cache.Known = func(string) bool { return true }
	return cache
}

// knownSet is a swappable set of ids, like the game data's.
type knownSet struct {
	mutex sync.Mutex
	ids   map[string]bool
}

func (set *knownSet) replace(ids ...string) {
	set.mutex.Lock()
	defer set.mutex.Unlock()
	set.ids = map[string]bool{}
	for _, id := range ids {
		set.ids[id] = true
	}
}

func (set *knownSet) known(id string) bool {
	set.mutex.Lock()
	defer set.mutex.Unlock()
	return set.ids[id]
}

func TestAnUnknownIdIsRefusedAtOnceWithNoDownload(t *testing.T) {
	assets := newFakeAssets(t, serveTinyIcon)
	cache := NewCache(t.TempDir(), assets.server.URL, "test") // Known not set: nothing is known
	if _, err := cache.Path(context.Background(), marker2000); err != ErrUnavailable {
		t.Fatalf("got %v", err)
	}
	if assets.requests.Load() != 0 || len(cache.failedAt) != 0 {
		t.Errorf("%d requests, %d failures remembered; want none", assets.requests.Load(), len(cache.failedAt))
	}
}

func TestAKnownIdIsFetchedAndAChangeOfGameDataUpdatesWhatIsKnown(t *testing.T) {
	assets := newFakeAssets(t, serveTinyIcon)
	cache := NewCache(t.TempDir(), assets.server.URL, "test")
	set := &knownSet{}
	cache.Known = set.known

	set.replace(marker2000)
	if _, err := cache.Path(context.Background(), marker2000); err != nil {
		t.Fatalf("known id: %v", err)
	}
	if _, err := cache.Path(context.Background(), otherItem); err != ErrUnavailable {
		t.Errorf("unknown id: %v", err)
	}
	set.replace(otherItem) // new game data
	if _, err := cache.Path(context.Background(), otherItem); err != nil {
		t.Errorf("id known after the change: %v", err)
	}
	if assets.requests.Load() != 2 {
		t.Errorf("%d downloads, want 2", assets.requests.Load())
	}
}

func TestAKeptIconIsServedEvenWhenItsIdIsNoLongerKnown(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, marker2000+".webp"), tinyWebP, 0o644)
	cache := NewCache(dir, "http://127.0.0.1:1", "test")
	if _, err := cache.Path(context.Background(), marker2000); err != nil {
		t.Errorf("kept icon: %v", err)
	}
}

func TestAFloodOfMadeUpIdsCausesNoDownloadsAndNoFiles(t *testing.T) {
	assets := newFakeAssets(t, serveTinyIcon)
	dir := t.TempDir()
	cache := NewCache(dir, assets.server.URL, "test")
	cache.Known = (&knownSet{ids: map[string]bool{marker2000: true}}).known
	for range 3000 {
		raw := make([]byte, 12)
		rand.Read(raw)
		if _, err := cache.Path(context.Background(), hex.EncodeToString(raw)); err != ErrUnavailable {
			t.Fatalf("got %v", err)
		}
	}
	if assets.requests.Load() != 0 {
		t.Errorf("%d upstream requests, want 0", assets.requests.Load())
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Errorf("%d files stored", len(entries))
	}
	if len(cache.failedAt) != 0 {
		t.Errorf("%d failures remembered", len(cache.failedAt))
	}
}
