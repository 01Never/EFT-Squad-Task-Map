package gamedata

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"squadtaskmap/internal/storage"
)

// How fresh the data must be, and how often that's checked.
const (
	refreshWhenOlderThan = 24 * time.Hour
	freshnessCheckEvery  = time.Hour
	downloadTimeout      = 60 * time.Second
)

// A download is only accepted with at least this many tasks (and at least half the previous count)
// and at least this many maps; otherwise the old data is kept. Protects against half-broken files.
const (
	minimumTasks = 200
	minimumMaps  = 5
)

// Status describes the data the page is using; shown in Settings and the top bar.
type Status struct {
	Origin     string   `json:"origin"` // "live" (downloaded now), "cache" (saved copy) or "built-in"
	Mode       string   `json:"mode"`
	Generated  *string  `json:"generated"`
	FetchedAt  *float64 `json:"fetchedAt"` // ms since 1970 of the download, or null
	Error      *string  `json:"error"`     // the last download error, or null
	Refreshing bool     `json:"refreshing"`
	Tasks      int      `json:"tasks"`
}

// Store holds the current game data and keeps it up to date.
type Store struct {
	mutex      sync.Mutex
	current    GameData
	itemIDs    map[string]bool // every item id an icon may be asked for (ItemIDs)
	taskIDs    map[string]bool
	origin     string
	fetchedAt  *float64
	lastError  *string
	refreshing bool
	mode       string
	cachedJSON []byte

	files     storage.Files
	builtIn   func() (GameData, error)
	baseURL   string // json.tarkov.dev, or the mock server (STM_JSON_BASE)
	userAgent string
	onChange  func()
}

// NewStore makes a store. builtIn returns the snapshot bundled in the exe; onChange is called
// whenever the data or its status changes (the app tells the page).
func NewStore(files storage.Files, builtIn func() (GameData, error), userAgent string, onChange func()) *Store {
	baseURL := os.Getenv("STM_JSON_BASE")
	if baseURL == "" {
		baseURL = "https://json.tarkov.dev"
	}
	return &Store{files: files, builtIn: builtIn, baseURL: strings.TrimRight(baseURL, "/"), userAgent: userAgent, onChange: onChange}
}

// Start loads the data for a game mode and keeps it fresh: once an hour it checks the age, and
// downloads again when it's more than a day old (one small download a day, nothing else).
//
// Goroutine: started here, runs for the life of the app, wakes once an hour; it never exits.
func (store *Store) Start(mode string) {
	store.SetMode(mode, false)
	go func() {
		ticker := time.NewTicker(freshnessCheckEvery)
		defer ticker.Stop()
		for range ticker.C {
			if store.isStale() {
				store.Refresh()
			}
		}
	}()
}

func (store *Store) isStale() bool {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	return !store.refreshing && (store.fetchedAt == nil || nowMillis()-*store.fetchedAt > float64(refreshWhenOlderThan.Milliseconds()))
}

// SetMode switches to another game mode's data: its saved copy if there is one, else the
// built-in snapshot; then downloads fresh data in the background if needed.
func (store *Store) SetMode(mode string, notify bool) {
	if mode != "regular" && mode != "pve" && mode != "pvp-season" {
		mode = "regular"
	}
	store.mutex.Lock()
	store.mode = mode
	if cached, fetchedAt, ok := store.loadCache(mode); ok {
		store.setCurrentLocked(cached)
		store.origin = "cache"
		store.fetchedAt = &fetchedAt
	} else {
		builtIn, err := store.builtIn()
		if err != nil {
			builtIn = GameData{Format: "stm-v2", Tasks: []Task{}, Maps: []MapInfo{}}
		}
		builtIn.Mode = mode
		store.setCurrentLocked(builtIn)
		store.origin = "built-in"
		store.fetchedAt = nil
	}
	store.lastError = nil
	needsDownload := store.fetchedAt == nil || nowMillis()-*store.fetchedAt > float64(refreshWhenOlderThan.Milliseconds())
	store.mutex.Unlock()
	if notify {
		store.onChange()
	}
	if needsDownload {
		go store.Refresh() // finishes on its own (each request has a timeout)
	}
}

func (store *Store) setCurrentLocked(data GameData) {
	store.current = data
	store.cachedJSON = nil
	store.itemIDs = ItemIDs(data)
	store.taskIDs = make(map[string]bool, len(data.Tasks))
	for _, task := range data.Tasks {
		store.taskIDs[task.ID] = true
	}
}

type cacheFile struct {
	FetchedAt float64  `json:"fetchedAt"`
	Data      GameData `json:"data"`
}

func (store *Store) loadCache(mode string) (GameData, float64, bool) {
	data, err := os.ReadFile(store.files.GameDataCache(mode))
	if err != nil {
		return GameData{}, 0, false
	}
	var cache cacheFile
	if json.Unmarshal(data, &cache) != nil || cache.Data.Format != "stm-v2" || len(cache.Data.Tasks) <= 100 {
		return GameData{}, 0, false
	}
	return cache.Data, cache.FetchedAt, true
}

// RefreshResult is what "Update game data now" reports.
type RefreshResult struct {
	OK    bool    `json:"ok"`
	Tasks *int    `json:"tasks,omitempty"`
	Error *string `json:"error,omitempty"`
}

// Refresh downloads the current mode's files from json.tarkov.dev, converts them, checks they look
// complete, saves them next to the exe and swaps them in.
func (store *Store) Refresh() RefreshResult {
	store.mutex.Lock()
	if store.refreshing {
		store.mutex.Unlock()
		message := "Already updating"
		return RefreshResult{OK: false, Error: &message}
	}
	store.refreshing = true
	mode := store.mode
	previousCount := len(store.current.Tasks)
	store.mutex.Unlock()

	converted, err := store.download(mode, previousCount)

	store.mutex.Lock()
	store.refreshing = false
	if err != nil {
		message := err.Error()
		store.lastError = &message
		store.cachedJSON = nil
		store.mutex.Unlock()
		store.onChange()
		return RefreshResult{OK: false, Error: &message}
	}
	now := nowMillis()
	if saveErr := saveCache(store.files.GameDataCache(mode), cacheFile{FetchedAt: now, Data: converted}); saveErr != nil {
		message := saveErr.Error()
		store.lastError = &message
	}
	if mode == store.mode {
		store.setCurrentLocked(converted)
		store.origin = "live"
		store.fetchedAt = &now
		store.lastError = nil
	}
	store.mutex.Unlock()
	store.onChange()
	count := len(converted.Tasks)
	return RefreshResult{OK: true, Tasks: &count}
}

func (store *Store) download(mode string, previousCount int) (GameData, error) {
	type result struct {
		data json.RawMessage
		err  error
	}
	files := []string{"tasks", "tasks_en", "maps", "maps_en", "traders", "traders_en", "items_en"}
	results := make([]result, len(files))
	var wait sync.WaitGroup
	for i, name := range files {
		wait.Add(1)
		// Goroutine: one per file, ends when its download finishes or times out.
		go func(i int, name string) {
			defer wait.Done()
			data, err := store.getJSON(mode + "/" + name)
			results[i] = result{data, err}
		}(i, name)
	}
	wait.Wait()
	// tasks and maps are required; the translations are optional (names then show as keys).
	for _, required := range []int{0, 2} {
		if results[required].err != nil {
			return GameData{}, results[required].err
		}
	}
	optional := func(i int) json.RawMessage {
		if results[i].err != nil {
			return nil
		}
		return results[i].data
	}
	generated := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	converted, err := FromRaw(RawDocs{
		Tasks: results[0].data, TasksEn: optional(1), Maps: results[2].data, MapsEn: optional(3),
		Traders: optional(4), TradersEn: optional(5), ItemsEn: optional(6),
	}, mode, &generated)
	if err != nil {
		return GameData{}, err
	}
	needed := int(math.Max(minimumTasks, float64(previousCount)*0.5))
	if len(converted.Tasks) < needed || len(converted.Maps) < minimumMaps {
		return GameData{}, fmt.Errorf("Download looked incomplete (%d tasks, %d maps); kept the old data", len(converted.Tasks), len(converted.Maps))
	}
	return converted, nil
}

func (store *Store) getJSON(path string) (json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(context.Background(), downloadTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, store.baseURL+"/"+path, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", store.userAgent)
	request.Header.Set("Accept", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("json.tarkov.dev/%s: %w", path, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("json.tarkov.dev/%s: HTTP %d", path, response.StatusCode)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, fmt.Errorf("json.tarkov.dev/%s: %w", path, err)
	}
	if !json.Valid(body) {
		return nil, fmt.Errorf("json.tarkov.dev/%s: not JSON", path)
	}
	return body, nil
}

func saveCache(path string, cache cacheFile) error {
	data, err := json.Marshal(cache)
	if err != nil {
		return err
	}
	return storage.WriteFileAtomic(path, data)
}

// ---------------------------------------------------------------- reading the current data

// Status reports where the data came from and how fresh it is.
func (store *Store) Status() Status {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	return store.statusLocked()
}

func (store *Store) statusLocked() Status {
	return Status{
		Origin: store.origin, Mode: store.mode, Generated: store.current.Generated, FetchedAt: store.fetchedAt,
		Error: store.lastError, Refreshing: store.refreshing, Tasks: len(store.current.Tasks),
	}
}

// JSON is the data as sent to the page (with its status), encoded once per change.
func (store *Store) JSON() []byte {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	if store.cachedJSON == nil {
		withStatus := struct {
			GameData
			Status Status `json:"status"`
		}{store.current, store.statusLocked()}
		store.cachedJSON, _ = json.Marshal(withStatus)
	}
	return store.cachedJSON
}

// Current returns the current data (read-only by convention).
func (store *Store) Current() GameData {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	return store.current
}

// ItemKnown reports whether an item id is in the current data (see ItemIDs): the icon cache
// fetches no other id. Rebuilt whenever the data changes.
func (store *Store) ItemKnown(id string) bool {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	return store.itemIDs[id]
}

// TaskExists reports whether a task id is in the data (daily and weekly tasks aren't).
func (store *Store) TaskExists(id string) bool {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	return store.taskIDs[id]
}

// MapFromScene finds the map for the game log's "scene preset path".
func (store *Store) MapFromScene(scene string) *string {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	for _, info := range store.current.Maps {
		if equalsText(info.Scene, scene) || altHas(info.Alt, func(alt MapAltNames) bool { return equalsText(alt.Scene, scene) }) {
			key := info.Key
			return &key
		}
	}
	if key, known := SceneToMap[scene]; known {
		return &key
	}
	return nil
}

// MapFromNameID finds the map for the game log's "Location: <nameId>".
func (store *Store) MapFromNameID(nameID string) *string {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	for _, info := range store.current.Maps {
		if equalsText(info.NameID, nameID) || altHas(info.Alt, func(alt MapAltNames) bool { return equalsText(alt.NameID, nameID) }) {
			key := info.Key
			return &key
		}
	}
	if key, known := NameIDToMap[strings.ToLower(nameID)]; known {
		return &key
	}
	return nil
}

// Mode is the current game mode.
func (store *Store) Mode() string {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	return store.mode
}

func equalsText(value *string, want string) bool { return value != nil && *value == want }

func altHas(alts []MapAltNames, matches func(MapAltNames) bool) bool {
	for _, alt := range alts {
		if matches(alt) {
			return true
		}
	}
	return false
}

func nowMillis() float64 { return float64(time.Now().UnixMilli()) }
