package squad

// throttle runs a function at most once per interval: at once when it hasn't run for a whole
// interval, otherwise once when the interval is over (so the last change is never lost). It holds
// a timer only while a run is waiting; idle, it costs nothing.
// Used for the page's "squad" event and the cache file, so a friend sending shares in a loop
// can't flood either (QA finding, ticket 05).

import (
	"sync"
	"time"
)

type throttle struct {
	interval time.Duration
	run      func()

	mutex   sync.Mutex
	lastRun time.Time
	waiting *time.Timer // non-nil while a run is waiting for the interval to end
}

func newThrottle(interval time.Duration, run func()) *throttle {
	return &throttle{interval: interval, run: run}
}

// trigger asks for a run: right away, or at the end of the interval if one ran recently. Several
// triggers while a run is waiting make that one run. The run always happens on the timer's own
// goroutine, never inside trigger, so callers may hold their locks.
func (gate *throttle) trigger() {
	gate.mutex.Lock()
	defer gate.mutex.Unlock()
	if gate.waiting != nil {
		return
	}
	wait := max(0, gate.interval-time.Since(gate.lastRun))
	// Timer: started here, fires once after wait (0 = at once); flush runs it early.
	gate.waiting = time.AfterFunc(wait, gate.runWaiting)
}

func (gate *throttle) runWaiting() {
	gate.mutex.Lock()
	gate.waiting = nil
	gate.lastRun = time.Now()
	gate.mutex.Unlock()
	gate.run()
}

// flush runs a waiting run now (before the app closes or the squad is left).
func (gate *throttle) flush() {
	gate.mutex.Lock()
	if gate.waiting == nil || !gate.waiting.Stop() {
		gate.mutex.Unlock()
		return
	}
	gate.waiting = nil
	gate.lastRun = time.Now()
	gate.mutex.Unlock()
	gate.run()
}
