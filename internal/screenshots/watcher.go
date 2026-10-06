// Package screenshots watches Tarkov's screenshots folder with the operating system's file
// notifications (no polling) and hands each new picture to the features that want it: GPS (in-raid
// shots carry your position in the name) and the task scan.
//
// It only deletes files when a feature asks, and only plain file names inside the folder. The two
// features allowed to ask are raid (that raid's GPS shots, at raid end) and taskscan (the shots
// you confirmed in a scan).
package screenshots

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// The game writes a picture in pieces. A file is handed on once it has been quiet for this long and
// its size didn't change between two checks.
const settleDelay = 400 * time.Millisecond

// When the folder doesn't exist yet (it appears after your first screenshot), look again this often.
const missingFolderRetry = 60 * time.Second

// Status is shown in Settings.
type Status struct {
	OK      bool    `json:"ok"`
	Message string  `json:"message"`
	Dir     *string `json:"dir"`
}

// File is a settled picture.
type File struct {
	Name     string
	Exists   bool      // false when the file was removed
	Modified time.Time // when the game wrote it
	Size     int64
}

// Watcher watches one screenshots folder.
type Watcher struct {
	mutex     sync.Mutex
	dir       string
	notifier  *fsnotify.Watcher
	timers    map[string]*time.Timer
	lastSizes map[string]int64
	status    Status
	stop      chan struct{}
	isImage   func(name string) bool
	onSettled func(File)
}

// NewWatcher makes a watcher. isImage picks the files of interest; onSettled receives each one
// once it's fully written (or removed), from a timer goroutine.
func NewWatcher(isImage func(string) bool, onSettled func(File)) *Watcher {
	return &Watcher{isImage: isImage, onSettled: onSettled, timers: map[string]*time.Timer{}, lastSizes: map[string]int64{}, status: Status{Message: "Not started"}}
}

// Start watches a folder (stopping any previous watch).
//
// Goroutines: one reading the OS notifications until Stop; or, while the folder is missing, one
// checking once a minute whether it appeared. Both end when Stop (or the next Start) closes stop.
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
	stop := make(chan struct{})
	watcher.stop = stop
	dirPointer := optional(dir)

	if dir == "" || !isDir(dir) {
		message := "Screenshots folder unknown — set it in Settings"
		if dir != "" {
			message = "Screenshots folder not found yet (it appears after your first screenshot)"
			go watcher.retryWhenFolderAppears(dir, stop)
		}
		watcher.status = Status{OK: false, Message: message, Dir: dirPointer}
		return
	}
	notifier, err := fsnotify.NewWatcher()
	if err == nil {
		err = notifier.Add(dir)
	}
	if err != nil {
		if notifier != nil {
			notifier.Close()
		}
		watcher.status = Status{OK: false, Message: "Couldn't watch the screenshots folder: " + err.Error(), Dir: dirPointer}
		return
	}
	watcher.notifier = notifier
	watcher.status = Status{OK: true, Message: "Watching", Dir: dirPointer}
	go watcher.readNotifications(notifier, stop)
}

// Stop ends the watch and cancels files still settling.
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
	if watcher.notifier != nil {
		watcher.notifier.Close()
		watcher.notifier = nil
	}
	for name, timer := range watcher.timers {
		timer.Stop()
		delete(watcher.timers, name)
	}
}

// Status reports whether the folder is being watched.
func (watcher *Watcher) Status() Status {
	watcher.mutex.Lock()
	defer watcher.mutex.Unlock()
	return watcher.status
}

// Dir is the watched folder.
func (watcher *Watcher) Dir() string {
	watcher.mutex.Lock()
	defer watcher.mutex.Unlock()
	return watcher.dir
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

func (watcher *Watcher) readNotifications(notifier *fsnotify.Watcher, stop chan struct{}) {
	for {
		select {
		case <-stop:
			return
		case event, open := <-notifier.Events:
			if !open {
				return
			}
			name := filepath.Base(event.Name)
			if watcher.isImage(name) {
				watcher.scheduleSettle(name)
			}
		case _, open := <-notifier.Errors:
			if !open {
				return
			}
		}
	}
}

// scheduleSettle (re)starts the quiet-period timer for a file.
func (watcher *Watcher) scheduleSettle(name string) {
	watcher.mutex.Lock()
	defer watcher.mutex.Unlock()
	if timer, waiting := watcher.timers[name]; waiting {
		timer.Stop()
	}
	watcher.timers[name] = time.AfterFunc(settleDelay, func() { watcher.settle(name) })
}

// settle runs when a file has been quiet for settleDelay. If its size still changed since the last
// check, it waits one more period; otherwise it's handed on.
func (watcher *Watcher) settle(name string) {
	watcher.mutex.Lock()
	delete(watcher.timers, name)
	full := filepath.Join(watcher.dir, name)
	info, err := os.Stat(full)
	if err != nil {
		delete(watcher.lastSizes, name)
		watcher.mutex.Unlock()
		watcher.onSettled(File{Name: name, Exists: false})
		return
	}
	previousSize, checkedBefore := watcher.lastSizes[name]
	if !checkedBefore || previousSize != info.Size() {
		watcher.lastSizes[name] = info.Size()
		watcher.timers[name] = time.AfterFunc(settleDelay, func() { watcher.settle(name) })
		watcher.mutex.Unlock()
		return
	}
	delete(watcher.lastSizes, name)
	watcher.mutex.Unlock()
	watcher.onSettled(File{Name: name, Exists: true, Modified: info.ModTime(), Size: info.Size()})
}

// ReadFile reads a picture from the folder (a plain file name only).
func (watcher *Watcher) ReadFile(name string) ([]byte, error) {
	full, err := watcher.pathOf(name)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(full)
}

// DeleteFile deletes one picture from the folder. Only raid (its GPS shots) and taskscan (confirmed
// scan shots) call this; it refuses anything that isn't a plain file name inside the folder.
func (watcher *Watcher) DeleteFile(name string) error {
	full, err := watcher.pathOf(name)
	if err != nil {
		return err
	}
	return os.Remove(full)
}

func (watcher *Watcher) pathOf(name string) (string, error) {
	watcher.mutex.Lock()
	dir := watcher.dir
	watcher.mutex.Unlock()
	if dir == "" {
		return "", errors.New("no screenshots folder")
	}
	if !isPlainPictureName(name, watcher.isImage) {
		return "", fmt.Errorf("not a picture file name: %q", name)
	}
	return filepath.Join(dir, name), nil
}

// isPlainPictureName accepts only a picture's own file name: no folder parts, and nothing Windows
// would read differently. Windows drops trailing dots and spaces, so "..." or ". ." would name the
// screenshots folder itself; such names are refused, and so is anything that isn't a picture.
func isPlainPictureName(name string, isImage func(string) bool) bool {
	if name == "" || name != filepath.Base(name) || strings.ContainsAny(name, `/\:`) {
		return false
	}
	if strings.HasSuffix(name, ".") || strings.HasSuffix(name, " ") || strings.Trim(name, ". ") == "" {
		return false
	}
	return isImage(name)
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
