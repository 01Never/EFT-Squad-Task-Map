package gamelog

import (
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"
	"unicode/utf8"
)

// How the watcher stays light while Tarkov runs (same approach as TarkovMonitor): every 5 seconds
// it compares file sizes and reads only the new bytes. Every 6th check (30 s) it looks for a new
// session folder. When the folder doesn't exist yet, it checks again once a minute.
const (
	pollInterval       = 5 * time.Second
	folderRescanEvery  = 6 // polls
	missingFolderRetry = 60 * time.Second
	maxBytesPerRead    = 4 * 1024 * 1024
	maxIncompleteEntry = 1_000_000 // an "incomplete entry" this long is junk; drop it
)

// Tarkov writes several logs per session; these two hold everything the app needs. Real names:
// "2026.10.04_22-11-56_1.1.5.1.47510 application_000.log", "… push-notifications_000.log".
var logFileName = regexp.MustCompile(`(?i)(notifications|application)[^\\/]*\.log$`)

// Status is shown in Settings ("✓ watching <folder>" or what's wrong).
type Status struct {
	OK      bool    `json:"ok"`
	Message string  `json:"message"`
	Dir     *string `json:"dir"`
	Folder  *string `json:"folder"`
}

type fileState struct {
	offset  int64
	rest    string // an entry still being written, kept for the next read
	partial []byte // the start of a UTF-8 character cut off at the end of the last read
}

// Watcher follows the newest session folder in Tarkov's Logs folder.
type Watcher struct {
	mutex   sync.Mutex
	dir     string
	folder  string
	files   map[string]*fileState
	polls   int
	status  Status
	stop    chan struct{}
	onEvent func(Event)
}

// NewWatcher makes a watcher; onEvent receives every event, in order, from the polling goroutine.
func NewWatcher(onEvent func(Event)) *Watcher {
	return &Watcher{onEvent: onEvent, files: map[string]*fileState{}, status: Status{Message: "Not started"}}
}

// Start watches a Logs folder (stopping any previous watch). It starts at the END of the existing
// files: nothing that happened before the app started is replayed (no catch-up).
//
// Goroutine: one per Start, polling every 5 s (or retrying a missing folder every 60 s). It ends
// when Stop or the next Start closes its stop channel.
func (watcher *Watcher) Start(dir string) {
	watcher.mutex.Lock()
	defer watcher.mutex.Unlock()
	watcher.startLocked(dir)
}

// startLocked switches to a folder; the caller holds the lock for the whole switch, so a retry and a
// Settings change can never interleave.
func (watcher *Watcher) startLocked(dir string) {
	watcher.stopLocked()
	watcher.dir = dir
	watcher.files = map[string]*fileState{}
	watcher.folder = ""
	stop := make(chan struct{})
	watcher.stop = stop
	dirPointer := optional(dir)

	if dir == "" || !isDir(dir) {
		message := "Couldn't find Tarkov's Logs folder — set it in Settings"
		if dir != "" {
			message = "Logs folder not found"
		}
		watcher.status = Status{OK: false, Message: message, Dir: dirPointer}
		if dir != "" {
			go watcher.retryWhenFolderAppears(dir, stop)
		}
		return
	}
	watcher.scanFolderLocked(true)
	watcher.status = Status{OK: true, Message: "Watching", Dir: dirPointer, Folder: optional(watcher.folder)}
	go watcher.pollUntilStopped(stop)
}

// Stop ends the watch.
func (watcher *Watcher) Stop() {
	watcher.mutex.Lock()
	defer watcher.mutex.Unlock()
	watcher.stopLocked()
}

func (watcher *Watcher) stopLocked() {
	if watcher.stop != nil {
		close(watcher.stop)
		watcher.stop = nil
	}
	watcher.files = map[string]*fileState{}
	watcher.folder = ""
}

// Status reports what the watcher is doing.
func (watcher *Watcher) Status() Status {
	watcher.mutex.Lock()
	defer watcher.mutex.Unlock()
	return watcher.status
}

func (watcher *Watcher) retryWhenFolderAppears(dir string, stop chan struct{}) {
	ticker := time.NewTicker(missingFolderRetry)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			if isDir(dir) {
				watcher.restartIfStillCurrent(stop, dir)
				return
			}
		}
	}
}

// restartIfStillCurrent starts watching the folder that appeared, unless the watch was changed (or
// stopped) meanwhile, e.g. a new folder in Settings: that one wins.
func (watcher *Watcher) restartIfStillCurrent(stop chan struct{}, dir string) {
	watcher.mutex.Lock()
	defer watcher.mutex.Unlock()
	if watcher.stop == stop {
		watcher.startLocked(dir)
	}
}

func (watcher *Watcher) pollUntilStopped(stop chan struct{}) {
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			watcher.Poll()
		}
	}
}

// Poll does one check: new session folder (every 6th time), then new bytes in each log file.
// Exposed for tests, which call it directly instead of waiting 5 seconds.
func (watcher *Watcher) Poll() {
	watcher.mutex.Lock()
	watcher.polls++
	if watcher.polls%folderRescanEvery == 0 {
		watcher.scanFolderLocked(false)
	}
	var events []Event
	if watcher.folder != "" {
		base := filepath.Join(watcher.dir, watcher.folder)
		for _, name := range sortedNames(watcher.files) {
			events = append(events, watcher.readNewBytesLocked(filepath.Join(base, name), watcher.files[name])...)
		}
	}
	watcher.mutex.Unlock()
	for _, event := range events {
		watcher.onEvent(event)
	}
}

// scanFolderLocked switches to the newest session folder. At start-up the existing files are read
// from their end; a session folder that appears while the app runs (the game was restarted) is
// read from its start.
func (watcher *Watcher) scanFolderLocked(atStartup bool) {
	newest := newestSessionFolder(watcher.dir)
	if newest != watcher.folder {
		watcher.folder = newest
		watcher.files = map[string]*fileState{}
		watcher.status.Folder = optional(newest)
		watcher.addFilesLocked(atStartup)
		return
	}
	watcher.addFilesLocked(false) // rotated files (…_001.log) appearing in the same session
}

func (watcher *Watcher) addFilesLocked(startAtEnd bool) {
	if watcher.folder == "" {
		return
	}
	base := filepath.Join(watcher.dir, watcher.folder)
	entries, err := os.ReadDir(base)
	if err != nil {
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		if !logFileName.MatchString(name) || watcher.files[name] != nil {
			continue
		}
		state := &fileState{}
		if startAtEnd {
			if info, err := os.Stat(filepath.Join(base, name)); err == nil {
				state.offset = info.Size()
			}
		}
		watcher.files[name] = state
	}
}

func (watcher *Watcher) readNewBytesLocked(path string, state *fileState) []Event {
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}
	size := info.Size()
	if size < state.offset { // the file was replaced or truncated: start over
		*state = fileState{}
	}
	if size == state.offset {
		return nil
	}
	length := size - state.offset
	if length > maxBytesPerRead {
		length = maxBytesPerRead
	}
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	buffer := make([]byte, length)
	read, err := file.ReadAt(buffer, state.offset)
	file.Close()
	if err != nil && err != io.EOF {
		return nil
	}
	state.offset += int64(read)
	return watcher.Feed(state, decodeUTF8Stream(state, buffer[:read]))
}

// decodeUTF8Stream turns bytes into text, holding back a UTF-8 character that was cut in half at
// the end of this read until the next read completes it.
func decodeUTF8Stream(state *fileState, chunk []byte) string {
	data := append(state.partial, chunk...)
	state.partial = nil
	cut := len(data)
	for back := 1; back <= 3 && back <= len(data); back++ {
		start := len(data) - back
		if utf8.RuneStart(data[start]) {
			if !utf8.FullRune(data[start:]) {
				cut = start
			}
			break
		}
	}
	state.partial = append([]byte(nil), data[cut:]...)
	return string(data[:cut])
}

// Feed parses new text for one file (keeping an incomplete last entry for next time) and returns
// the events in it. Exposed for tests.
func (watcher *Watcher) Feed(state *fileState, text string) []Event {
	entries, rest := SplitEntries(state.rest + text)
	if len(rest) > maxIncompleteEntry {
		rest = ""
	}
	state.rest = rest
	var events []Event
	for _, entry := range entries {
		events = append(events, EventsFrom(entry)...)
	}
	return events
}

// newestSessionFolder: session folders are named log_YYYY.MM.DD_HH-MM-SS_<version>, so the newest
// sorts last.
func newestSessionFolder(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	var folders []string
	for _, entry := range entries {
		if entry.IsDir() {
			folders = append(folders, entry.Name())
		}
	}
	if len(folders) == 0 {
		return ""
	}
	sort.Strings(folders)
	return folders[len(folders)-1]
}

func sortedNames(files map[string]*fileState) []string {
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func optional(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
