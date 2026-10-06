package gps

import (
	"sync"
	"time"
)

// TrailLength is how many earlier positions are kept on the map.
const TrailLength = 5

// Position is your last position, as sent to the page.
type Position struct {
	Map *string `json:"map"` // the raid's map, or null when the log didn't say (shown on the open map)
	X   float64 `json:"x"`
	Y   float64 `json:"y"`
	Z   float64 `json:"z"`
	Yaw float64 `json:"yaw"`
	T   float64 `json:"t"` // when the screenshot arrived, ms since 1970
}

// TrailPoint is an earlier position.
type TrailPoint struct {
	X float64 `json:"x"`
	Z float64 `json:"z"`
	T float64 `json:"t"`
}

// NextTrail is the trail after a new position: the previous position joins the trail when it was
// on the same map (the last TrailLength kept); on another map the trail starts over.
func NextTrail(previous *Position, trail []TrailPoint, newMap *string) []TrailPoint {
	if previous == nil || !sameMap(previous.Map, newMap) {
		return []TrailPoint{}
	}
	next := append(append([]TrailPoint{}, trail...), TrailPoint{X: previous.X, Z: previous.Z, T: previous.T})
	if len(next) > TrailLength {
		next = next[len(next)-TrailLength:]
	}
	return next
}

func sameMap(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// Tracker keeps your last position and trail.
type Tracker struct {
	mutex    sync.Mutex
	position *Position
	trail    []TrailPoint
}

// Update records a new position on a map (nil map = unknown) and returns it with the trail.
func (tracker *Tracker) Update(fix Fix, mapKey *string) (Position, []TrailPoint) {
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	tracker.trail = NextTrail(tracker.position, tracker.trail, mapKey)
	tracker.position = &Position{Map: mapKey, X: fix.X, Y: fix.Y, Z: fix.Z, Yaw: fix.Yaw, T: float64(time.Now().UnixMilli())}
	return *tracker.position, append([]TrailPoint{}, tracker.trail...)
}

// ClearTrail drops the trail (a new raid started); the last position stays.
func (tracker *Tracker) ClearTrail() {
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	tracker.trail = []TrailPoint{}
}

// Clear forgets the position and trail (the raid ended).
func (tracker *Tracker) Clear() {
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	tracker.position = nil
	tracker.trail = []TrailPoint{}
}

// Current is the last position (nil when none) and the trail, for /api/status.
func (tracker *Tracker) Current() (*Position, []TrailPoint) {
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	trail := append([]TrailPoint{}, tracker.trail...)
	if tracker.position == nil {
		return nil, trail
	}
	position := *tracker.position
	return &position, trail
}
