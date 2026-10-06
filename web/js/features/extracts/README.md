# Extracts (closest extract)

**What it does (player's view):** after each GPS screenshot, the closest of *your* extracts is
highlighted: a ring in the player colour on the extract, a dashed line from you to it with the
distance ("~180 m"), and "Closest: Crash Site · ~180 m" in the position bar. Clicking that name
centres the map on the extract without changing the zoom.

"Your" extracts are the ones you marked on the map (click an extract: it turns solid). Marks are
per map and clear at raid end. Ticket 06 will mark them automatically from a screenshot of the
in-game extract list.

**Where the data comes from:** extract and transit positions come from the game data
(`/api/data` → `maps[].extracts`, `maps[].transits`); marks from `prefs[map].extMarked`; which kinds
are shown from `prefs[map].ext` (the PMC / Scav / Shared / Transit chips); your position from the
`gps` event (see `features/find-me`).

**The rules** (`rules.js`; owner's decisions for ticket 03):
- If any extract on this map is marked, only marked ones count (`extractsThatCount()`, basis
  `"marked"`). A transit counts only this way, when you've marked it.
- With nothing marked, every extract whose kind the chips show counts (PMC / Scav / Shared;
  transits never), and the bar says "Closest shown" (basis `"shown"`).
- Closest = shortest straight-line distance on the map (x/z), ignoring height (`closestExtract()`).
  Game units are metres. There's no walking-path data, so it's "as the crow flies", shown with a
  "~" (`approximateDistanceText()`: 5 m steps under 100 m, 10 m steps above, km from 1000 m).
- No runner-ups (owner's decision): only the closest one is shown.
- A mark's stored value is any truthy value (`true` today), so ticket 06 can store
  `{ auto: true, note }` without breaking old data.

**Flow:**
- New position: `event "gps" → live.js → renderPlayer() → renderClosestExtract()`
- Mark / unmark (click on the map), chip change, Clear marked: `map.js renderExtracts() →
  renderClosestExtract()`
- Raid end: `event "raidEnd" → live.js clears the position and the marks → renderAll() →
  renderExtracts() → renderClosestExtract()` (nothing to show).

**Light while Tarkov runs:** the ring, line and label are plain SVG in their own layer
(`M.gClosest`, between extracts and task markers), drawn once per update. Nothing animates. The
line uses a non-scaling stroke, so it keeps its width while you zoom.

**Saved data / settings:** reads `prefs[map].extMarked` and `prefs[map].ext`; owns nothing new.

**Files:**
- `rules.js`: which extracts count, which is closest, the distance text.
- `map-layer.js`: the ring, the dashed line and its label, and the "Closest: …" part of the
  position bar.
- `rules.test.js`: tests for `rules.js`.

**Tests:** `rules.test.js` covers marked vs shown, transits only when marked, old-format marks, the
closest pick and the distance text. Checked in a browser against the mock server: three positions
on Customs pick the extract worked out by hand from `/api/data`; marking and unmarking switch the
result at once; an unmarked transit next to you isn't picked, a marked one is; clicking the name
keeps the zoom; raid end clears the highlight.
**Needs an in-game check:** that the highlighted extract is the one you'd head to (within reason for
a straight line).
