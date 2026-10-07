package icons

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"squadtaskmap/internal/storage"
)

// ErrUnavailable means there is no icon for this id: not downloaded, and a download failed
// recently (or the id isn't an item id).
var ErrUnavailable = errors.New("icon unavailable")

// Icons are fetched at most this many at a time (a Bring list can ask for a hundred at once).
const maxParallelDownloads = 6

// One download gives up after this long.
const downloadTimeout = 15 * time.Second

// Cache is the icon folder plus the downloading. Safe for concurrent use.
type Cache struct {
	dir        string
	assetsBase string
	client     *http.Client
	userAgent  string
	now        func() time.Time // replaced in tests

	slots chan struct{} // a download holds one while it runs

	mutex    sync.Mutex
	inFlight map[string]*download // item id → the download running for it
	failedAt map[string]time.Time // item id → when its last download failed
}

// download is one running fetch; everyone who asked for the same id waits on done.
type download struct {
	done chan struct{}
	err  error
}

// NewCache serves and fills the folder dir. assetsBase is "https://assets.tarkov.dev" (or the
// STM_ASSETS_BASE override, read by NewCacheFromEnvironment).
func NewCache(dir, assetsBase, userAgent string) *Cache {
	cache := &Cache{
		dir:        dir,
		assetsBase: assetsBase,
		now:        time.Now,
		slots:      make(chan struct{}, maxParallelDownloads),
		inFlight:   map[string]*download{},
		failedAt:   map[string]time.Time{},
	}
	cache.client = &http.Client{
		Timeout: downloadTimeout,
		// A redirect is followed only within the same host; anything else is an error.
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 3 || request.URL.Host != via[0].URL.Host || request.URL.Scheme != via[0].URL.Scheme {
				return fmt.Errorf("icon download redirected away from %s", via[0].URL.Host)
			}
			return nil
		},
	}
	cache.userAgent = userAgent
	return cache
}

// Path returns the file holding the item's icon, downloading it first if it isn't in the folder.
// ErrUnavailable means "no icon": the caller answers 404 and the page keeps its fallback.
func (cache *Cache) Path(ctx context.Context, itemID string) (string, error) {
	if !IsItemID(itemID) {
		return "", ErrUnavailable
	}
	file := filepath.Join(cache.dir, itemID+".webp")
	if storage.FileExists(file) {
		return file, nil
	}

	cache.mutex.Lock()
	if failedAt, failed := cache.failedAt[itemID]; failed && !MayTryAgain(failedAt, cache.now()) {
		cache.mutex.Unlock()
		return "", ErrUnavailable
	}
	running, isRunning := cache.inFlight[itemID]
	if !isRunning {
		running = &download{done: make(chan struct{})}
		cache.inFlight[itemID] = running
		go cache.fetch(itemID, file, running)
	}
	cache.mutex.Unlock()

	select {
	case <-running.done:
	case <-ctx.Done():
		return "", ctx.Err()
	}
	if running.err != nil {
		return "", ErrUnavailable
	}
	return file, nil
}

// fetch downloads one icon and stores it. It runs on its own goroutine with its own time limit,
// so one page request going away doesn't cancel the download others are waiting for.
func (cache *Cache) fetch(itemID, file string, running *download) {
	cache.slots <- struct{}{}
	err := cache.download(itemID, file)
	<-cache.slots

	cache.mutex.Lock()
	if err != nil {
		cache.failedAt[itemID] = cache.now()
	} else {
		delete(cache.failedAt, itemID)
	}
	delete(cache.inFlight, itemID)
	cache.mutex.Unlock()
	running.err = err
	close(running.done)
}

func (cache *Cache) download(itemID, file string) error {
	address := IconURL(cache.assetsBase, itemID)
	ctx, cancel := context.WithTimeout(context.Background(), downloadTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", cache.userAgent)
	response, err := cache.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("icon %s: HTTP %d", itemID, response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, MaxIconBytes+1))
	if err != nil {
		return err
	}
	if len(data) > MaxIconBytes {
		return fmt.Errorf("icon %s is bigger than %d bytes", itemID, MaxIconBytes)
	}
	if !IsWebP(data) {
		return fmt.Errorf("icon %s isn't a WebP picture", itemID)
	}
	if err := os.MkdirAll(cache.dir, 0o755); err != nil {
		return err
	}
	return storage.WriteFileAtomic(file, data)
}

// NewCacheFromEnvironment is NewCache with STM_ASSETS_BASE applied.
func NewCacheFromEnvironment(dir, userAgent string) *Cache {
	base := os.Getenv("STM_ASSETS_BASE")
	if base == "" {
		base = DefaultAssetsBase
	}
	return NewCache(dir, base, userAgent)
}
