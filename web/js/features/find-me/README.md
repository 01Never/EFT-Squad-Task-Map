# Find me

**What it does (player's view):** your position from the last in-raid screenshot is the first
thing you see on the map: a disc in its own colour inside a ring, with a heading arrow and a
"You" label. A new position (or a click on 📍 Find me) pulses with big rings for about
20 seconds. When you've panned away, a chip on the map edge points toward you with the distance;
clicking it brings you back into view. Find me and the chip never change your zoom.

**Where the data comes from:** Tarkov writes your position and facing into each screenshot's file
name. The server parses it (`server/gpsname.ts`), works out the map from the game log, and sends a
`gps` event (live only, not saved) with the position and the last 5 positions (the trail).

**The rules** (`rules.js`):
- The pulse runs for `PULSE_DURATION_MS` = 20 s after a new position or a Find me click, then
  stops completely. Owner decision for ticket 01: one very obvious pulse, no continuous radar and
  no "stale" pulse.
- 3 rings, each `PULSE_RING_CYCLE_MS` = 1.5 s, started a third of a cycle apart.
  `pulseRingTimings()` gives each ring a negative delay of "time already elapsed", so a map
  re-render (or re-opening the map) carries the pulse on instead of restarting the 20 s.
- You're "on screen" when the marker's centre is at least `ON_SCREEN_MARGIN_PIXELS` = 12 px inside
  the map area. Otherwise the chip shows.
- The chip sits on the line from the middle of the map area toward you, as far out as it fits
  (`chipPositionToward()`).
- Distance is straight-line on the map (x/z), ignoring height; game units are metres.
  Rounded to 5 m under 100 m, 10 m above, km from 1000 m (`formatDistance()`).

**Flow:**
`screenshot file → server/screens.ts → gpsname.ts → main.ts gps() → event "gps" → live.js →
onNewPosition() (starts the pulse) → renderPlayer() → map.js apply() → placeFindMeOverlays()`

**Light while Tarkov runs:** the marker, label and trail are plain SVG, drawn once per update.
The pulse rings and the chip are HTML over the map (`#findme-fx`, `#findme-chip`), moved with CSS
`transform` and animated with `transform`/`opacity` only, so the browser runs the pulse on the
compositor without repainting the map. A trace of 3 s of pulse showed 0 Paint and 0 Layout on the
main thread. Each ring removes itself when its animation ends; after 20 s nothing animates.
With "reduce motion" turned on in Windows, the pulse is one still ring for the same 20 s.

**Saved data / settings:** none. The pulse start time lives in `app.findMePulseStartedAt`
(memory only). The player colour is the CSS variable `--player` in `web/index.html`.

**Files:**
- `rules.js`: pulse timing, on-screen test, chip placement, distance.
- `map-layer.js`: draws the marker, label, floor badge, trail and position bar; the pulse rings;
  the off-screen chip; the Find me button.
- `rules.test.js`: tests for `rules.js`.
- Styles: the `features/find-me` block in `web/index.html` (moves to `find-me.css` in ticket 04b).

**Tests:** `rules.test.js` covers the pulse timing (fresh, re-drawn halfway, finished), the
on-screen margin, chip placement on each edge, distance and its rounding. Checked in a browser
against the mock server: pulse starts on a new position and is gone after 20 s; chip appears when
panned away and clicking it centres at the same zoom; Find me and the bar's Show centre at the same
zoom and pulse; phone width.
**Needs an in-game check:** that the marker is easy to find at a glance, half-screen or on a second
monitor, and that the arrow points the way you face.
