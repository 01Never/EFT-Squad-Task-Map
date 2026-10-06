// Package raid follows the current raid from the game log: which map is loading, when the raid
// starts and ends, and which game mode the game is in. At raid end it deletes the GPS screenshots
// taken during that raid (and only those) and tells the page to reset bag counts and extract marks.
package raid

import (
	"sync"
	"time"
)

// Status is the raid part of /api/status.
type Status struct {
	Active      bool    `json:"active"`
	Map         *string `json:"map"`         // the raid's map, or the one loading
	SessionMode *string `json:"sessionMode"` // the game's mode, once the log has said
}

// Tracker holds the raid state. The app calls one method per log event; each returns what changed
// so the app can tell the page.
type Tracker struct {
	mutex       sync.Mutex
	isActive    bool
	mapKey      *string // the raid's map, set at raid start
	pendingMap  *string // the map being loaded, before the raid starts
	startedAt   time.Time
	sessionMode string
	gpsShots    []string // GPS screenshots seen being created since the last raid end
}

// SetSessionMode records the game's mode ("Session mode: …" in the log).
func (tracker *Tracker) SetSessionMode(mode string) {
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	tracker.sessionMode = mode
}

// SessionMode is the game's mode ("" until the log says).
func (tracker *Tracker) SessionMode() string {
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	return tracker.sessionMode
}

// MapLoading: the game is loading a map ("scene preset path"); nil when the map isn't known.
func (tracker *Tracker) MapLoading(mapKey *string) {
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	tracker.pendingMap = mapKey
}

// MapLoaded: the raid was created on a map ("Location: <nameId>"). Only used when the scene path
// didn't already name the map.
func (tracker *Tracker) MapLoaded(mapKey *string) {
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	if tracker.pendingMap == nil {
		tracker.pendingMap = mapKey
	}
}

// MatchingAborted: matchmaking was cancelled, so no raid on that map.
func (tracker *Tracker) MatchingAborted() {
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	tracker.pendingMap = nil
}

// Start: you're in the raid ("GameStarted"). Returns the raid's map.
func (tracker *Tracker) Start() *string {
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	tracker.isActive = true
	tracker.mapKey = tracker.pendingMap
	tracker.startedAt = time.Now()
	return tracker.mapKey
}

// NoteGPSShot remembers a GPS screenshot taken now, so raid end can delete it.
func (tracker *Tracker) NoteGPSShot(name string) {
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	for _, known := range tracker.gpsShots {
		if known == name {
			return
		}
	}
	tracker.gpsShots = append(tracker.gpsShots, name)
}

// CurrentMap is the map for a new GPS position: the raid's map, else the one loading (nil = unknown).
func (tracker *Tracker) CurrentMap() *string {
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	if tracker.mapKey != nil {
		return tracker.mapKey
	}
	return tracker.pendingMap
}

// ShouldEndOnMenuReturn applies EndsOnMenuReturn to the current raid.
func (tracker *Tracker) ShouldEndOnMenuReturn() bool {
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	return EndsOnMenuReturn(tracker.isActive, len(tracker.gpsShots))
}

// End finishes the raid: it deletes the raid's GPS screenshots through deleteShot (which only ever
// gets names this tracker saw being created, and only GPS-named ones) and returns the map the raid
// was on and how many files were deleted.
func (tracker *Tracker) End(isGPSName func(string) bool, deleteShot func(string) error) (mapKey *string, deleted int) {
	tracker.mutex.Lock()
	shots := tracker.gpsShots
	mapKey = tracker.mapKey
	tracker.gpsShots = nil
	tracker.isActive = false
	tracker.mapKey = nil
	tracker.pendingMap = nil
	tracker.mutex.Unlock()
	for _, name := range shots {
		if !isGPSName(name) {
			continue
		}
		if deleteShot(name) == nil {
			deleted++
		}
	}
	return mapKey, deleted
}

// Status is the raid part of /api/status.
func (tracker *Tracker) Status() Status {
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	shownMap := tracker.mapKey
	if shownMap == nil {
		shownMap = tracker.pendingMap
	}
	var sessionMode *string
	if tracker.sessionMode != "" {
		mode := tracker.sessionMode
		sessionMode = &mode
	}
	return Status{Active: tracker.isActive, Map: shownMap, SessionMode: sessionMode}
}
