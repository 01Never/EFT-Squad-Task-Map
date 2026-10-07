# Find me

**What it does (player's view):** your position from the last in-raid screenshot is the first
thing you see on the map: a small disc in its own colour, with a heading arrow and a
"You" label. A new position (or a click on 📍 Find me) pulses with rings for about
6 seconds. When you've panned away, a chip on the map edge points toward you with the distance;
clicking it brings you back into view. Find me and the chip never change your zoom.

**Auto-center (ticket 02):** with "Center the map on me" on (◎ Follow on the toolbar, or
Settings), every new position pans the map so you're in the middle, at whatever zoom you had,
like a minimap. With it off (the default), a new position only moves the map when it would be
off-screen, and only with "Follow my position" on, as in v2; the zoom never changes there either.
When "Follow my position" switches maps, the new map opens at its default zoom, centred on you.

**Where the data comes from:** Tarkov writes your position and facing into each screenshot's file
name. The server parses it (`internal/features/gps`), works out the map from the game log (`internal/features/raid`), and sends a
`gps` event (live only, not saved) with the position and the last 5 positions (the trail).

**The rules** (`rules.js`):
- The pulse runs for `PULSE_DURATION_MS` = 6 s after a new position or a Find me click, then
  stops completely. Owner decision for ticket 01: one very obvious pulse, no continuous radar and
  no "stale" pulse.
- 3 rings, each `PULSE_RING_CYCLE_MS` = 1.5 s, started a third of a cycle apart.
  `pulseRingTimings()` gives each ring a negative delay of "time already elapsed", so a map
  re-render (or re-opening the map) carries the pulse on instead of restarting the 6 s.
- You're "on screen" when the marker's centre is at least `ON_SCREEN_MARGIN_PIXELS` = 12 px inside
  the map area. Otherwise the chip shows.
- The chip sits on the line from the middle of the map area toward you, as far out as it fits
  (`chipPositionToward()`).
- Distance is straight-line on the map (x/z), ignoring height; game units are metres.
  Rounded to 5 m under 100 m, 10 m above, km from 1000 m (`formatDistance()`).
- A new position: `viewChangeForNewPosition()` says "centre" when auto-center is on, or when
  Follow is on and you're not well in view; "well in view" ignores the outer
  `BRING_INTO_VIEW_EDGE_FRACTION` = 10% of the view (`isWellInsideArea()`). Otherwise "leave".
- The centring waits while a finger or mouse button is down on the map (`afterUserLetsGo()` in
  `map/view.js`), then runs once you let go.

**Flow:**
`screenshot file → internal/screenshots → app.onScreenshot → gps.ParseFileName → gps.Tracker.Update → event "gps" → app/live-events.js onPositionReceived() →
onNewPosition() (starts the pulse) → renderPlayer() → moveViewForNewPosition() → map/view.js applyView() →
placeFindMeOverlays()`

**Light while Tarkov runs:** the marker, label and trail are plain SVG, drawn once per update.
The pulse rings and the chip are HTML over the map (`#findme-fx`, `#findme-chip`), moved with CSS
`transform` and animated with `transform`/`opacity` only, so the browser runs the pulse on the
compositor without repainting the map. A trace of 3 s of pulse showed 0 Paint and 0 Layout on the
main thread. Each ring removes itself when its animation ends; after 6 s nothing animates.
With "reduce motion" turned on in Windows, the pulse is one still ring for the same 6 s.

**Saved data / settings:** `autoCenter` (off by default) and `followPosition` in
`squad-task-map-settings.json`, read from `/api/status` and changed with `PUT /api/settings`
(the ◎ Follow toggle and Settings both use it). The pulse start time lives in `app.findMePulseStartedAt`
(memory only). The player colour is the CSS variable `--player` in `web/css/base.css`.

**Files:**
- `rules.js`: pulse timing, on-screen test, chip placement, distance, what a new position does to the view.
- `map-layer.js`: draws the marker, label, floor badge, trail and position bar; the pulse rings;
  the off-screen chip; the Find me button and the ◎ Follow toggle; moving the view for a new position.
- `rules.test.js`: tests for `rules.js`.
- `find-me.css`: the position bar, the pulse rings and the chip.

**Tests:** `rules.test.js` covers the pulse timing (fresh, re-drawn halfway, finished), the
on-screen margin, chip placement on each edge, distance and its rounding. Checked in a browser
against the mock server: pulse starts on a new position and is gone after 6 s; chip appears when
panned away and clicking it centres at the same zoom; Find me and the bar's Show centre at the same
zoom and pulse; phone width.
**Needs an in-game check:** that the marker is easy to find at a glance, half-screen or on a second
monitor, and that the arrow points the way you face.
