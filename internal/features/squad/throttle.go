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

	// runs counts scheduled runs that haven't finished, so flush can wait for one whose timer has
	// already fired. runOne makes runs take turns, so two never write at the same time.
	runs   sync.WaitGroup
	runOne sync.Mutex
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
	gate.runs.Add(1)
	// Timer: started here, fires once after wait (0 = at once); flush runs it early.
	gate.waiting = time.AfterFunc(wait, gate.runWaiting)
}

func (gate *throttle) runWaiting() {
	defer gate.runs.Done()
	gate.mutex.Lock()
	gate.waiting = nil
	gate.lastRun = time.Now()
	gate.mutex.Unlock()
	gate.runNow()
}

// runNow runs the function, one run at a time.
func (gate *throttle) runNow() {
	gate.runOne.Lock()
	defer gate.runOne.Unlock()
	gate.run()
}

// flush runs a waiting run now (before the app closes or the squad is left), and returns only
// once every run asked for so far has finished. A run whose timer has already fired is waited for
// rather than skipped, so the last change always reaches the file before the app closes.
func (gate *throttle) flush() {
	gate.mutex.Lock()
	stoppedWaitingRun := gate.waiting != nil && gate.waiting.Stop()
	if stoppedWaitingRun {
		gate.waiting = nil
		gate.lastRun = time.Now()
	}
	gate.mutex.Unlock()
	if stoppedWaitingRun {
		gate.runNow()
		gate.runs.Done() // the stopped timer will never call runWaiting
	}
	gate.runs.Wait()
}
