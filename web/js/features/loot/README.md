# Loot spots (ticket 08)

**What it does (player's view):** a "Loot" section in the task list (closed until you open it)
with a chip per container type (Safe, Weapon box, PC block…) and one for loose loot, each with how
many there are on this map. "★ High value" turns on a sensible set in one click; "None" turns
everything off. The chosen spots show on the map as small neutral tiles with a sign ("$" safe,
"W" weapon box, "PC" PC block, "L" loose loot…), or the item's icon for a loose spot with one
item. Spots that crowd together share a round bubble with a count: tap it to zoom in until they
split. Tap a spot for what it is, its floor and (loose loot) what can spawn there. Loot never
selects a task, and never changes readiness ("!"), the Bring list or the pins.

**Where the data comes from:** json.tarkov.dev's `{mode}/maps` file, the same download as the
tasks (no new data source). The server converts it (`internal/gamedata/loot.go`) and serves one
map at a time at `GET /api/loot/<map>`; the page asks only when it needs it (the section is open
or a chip is on), once per map and game data.

| In `{mode}/maps` (checked on the real files of 2026-10-05) | What the page gets |
|---|---|
| `data.maps.<id>.lootContainers[{lootContainer, position}]` + `data.lootContainers.<id>.{normalizedName, name}` (English name in `maps_en`) | `containers[{t, x, y, z}]`, `t` = normalizedName; names in `lootTypes` |
| `data.maps.<id>.lootLoose[{items[], position}]` (names in `items_en`) | `loose[{i[], x, y, z}]`; names in `items` |
| `data.maps.<id>.locks[{lockType, key, needsPower, position, outline?, top?, bottom?}]` | `locks[…]` (below), for ticket 09 |

The real data (regular mode): 17 maps; 7,098 containers of 27 types; 5,196 loose spots naming 347
distinct items (tarkov.dev already keeps only notable ones: keys, valuables, intel, electronics,
stims, posters); 283 locks (238 doors, 45 trunks), 10 of them with an outline, none needing power.
**Not in the downloaded files:** item categories and prices (they're in `{mode}/items`, which the
app doesn't download and which couldn't be inspected for this ticket), so loose loot is one chip,
not split into Documents / Electronics / Valuables / Keys, and there's no price threshold.

### `/api/loot/<map>` (also what ticket 09 builds on)
```jsonc
{
  "map": "customs",
  "available": true,            // false while the data is the built-in snapshot (no loot in it)
  "containers": [{ "t": "safe", "x": -13.88, "y": 1.97, "z": 95.3 }],
  "loose": [{ "i": ["<item id>", …], "x": 0, "y": 0, "z": 0 }],
  "locks": [
    { "key": "<key item id>", "type": "door", "power": false, "x": 0, "y": 0, "z": 0 },
    // only when the data has the door's area (outline as [x, z] points, heights in metres):
    { "key": "…", "type": "door", "power": false, "x": 0, "y": 0, "z": 0,
      "ol": [[-18.88, -48.82], …], "top": 1.95, "bottom": 0.95 }
  ],
  "lootTypes": { "safe": "Safe", "pc-block": "PC block", … },   // every container type
  "items": { "<item id>": "Dorm room 314 marked key", … }        // the loose items and keys this map uses
}
```
- Coordinates are game coordinates (`y` is height), rounded to centimetres; project them with
  `makeProj` like task zones, and get the floor with `floorBadge(config, x, y, z)`.
- `type` is `"door"` or `"trunk"`; `power` = the lock needs the power switched on.
- `ol`, `top`, `bottom` are left out (not `null`) when the data has no area for that lock.
- Unknown map key (or not `[a-z0-9-]`) → 404. A known map without loot → empty lists.

**The rules:** (`rules.js`, numbers and why)
- Choices are saved per map in `prefs[map].loot` as `{ chipId: true }`. Absent = nothing shown:
  loot stays off until you turn it on, and files from before 08 load unchanged. A damaged value
  keeps only the chips that are `true` (`cleanLootChoices`, run by `fillMissingFields`).
- Chip ids: the container type (`normalizedName`; several container ids share one, e.g. 4 kinds
  of weapon box) or `loose`. Chips list the high-value types first, then the rest by name, then
  loose loot; only types this map has.
- "High value" (owner's default for the open question): safes (`safe`, `bank-safe`), weapon boxes,
  PC blocks, tech supply crates, medcases, jackets, filing cabinets (`drawer` in tarkov.dev's data)
  and loose loot. The button is pressed only when exactly that set is on; pressing it then turns
  everything off.
- Floors: like task markers, every spot shows on every floor, with a floor badge from
  `floorBadge()`; picking a floor only changes the map art.
- Night Factory and Ground Zero 21+ share their map's key; the plain map's spots are used, and a
  door outline only the variant has is copied onto the same door (same key, within 0.5 m).

**Performance (ticket 08 must-have; measured, see below):**
- Only spots in the view plus a margin of a quarter view on each side are drawn
  (`VIEW_MARGIN_FRACTION`), so a short pan needs no redraw.
- Spots in the same 34-pixel square of a grid fixed to the map share a bubble
  (`groupNearbySpots`, `GROUP_CELL_PIXELS`). Panning never regroups; zooming in splits bubbles.
- The layer is redrawn 150 ms after the view stops moving (one redraw per gesture, a one-off
  timer started by a view change, never a repeating one). With every chip off nothing runs.
- Markers are small cached pictures (`marker-images.js`), not SVG text: the map re-lays out every
  marker each frame, and text was most of that cost.

Measured on Streets, headless Chromium (software rendering, 1600×900, every task active), 2
rounds of a 120-step pan and a 40-notch zoom in/out. Frame interval in ms (mean / p95) and layout
per frame:

| | pan | zoom | layout per frame | markers drawn |
|---|---|---|---|---|
| 2.7.0 before ticket 08 (4 runs each) | 17.4–18.3 / 16.8–33.3 | 16.7–17.8 / 16.7–33.3 | 1.2–2.4 ms | 0 loot |
| ticket 08, loot off | 16.7–17.3 / 16.7–16.8 | 16.8 / 16.8 | 1.6–2.6 ms | 0 loot |
| every chip on, SVG text signs (first try, not shipped) | 18.0–19.3 / 33.3 | 19.6–24.6 / 33.4–50 | 3.1–10.9 ms | 245–290 |
| every chip on, picture markers (shipped) | 17.6–18.2 / 16.8–33.3 | 16.8–18.6 / 16.7–16.8 | 1.5–2.6 ms | 226–245 for 2,224 spots |

Idle with every chip on: 0 ms of script, no DOM changes and no timers over 8–10 s; the browser
suite also checks 0 Paint and 0 Layout in a 3 s Chrome trace. The redraw after a zoom notch
takes about 40–70 ms of main-thread time in total, split into tasks under 50 ms.

**Flow:** open the section or turn a chip on → `loot-data.js` `lootOfMap()` → `GET /api/loot/<map>`
→ `app.lootByMap[map]` → `map-layer.js` `renderLoot()` (spots the chips show → map positions and
floors, once) → `drawLootNearView()` (near the view → bubbles → pictures) → pan/zoom →
`map/view.js` `applyView()` → `redrawLootWhenViewSettles()` → redraw. A tap → `map/input.js` →
`onLootTapped()` → popup (`#lootpop`, top right) or zoom in on a bubble. New game data (`data`
event) → the next render asks for the map's spots again.

**Saved data / settings:** `prefs[map].loot` (absent until you change a chip). The section's open
state and the "icons are missing" flag are in memory only (`app.lootSectionOpen`,
`app.lootIconsMissing`).

**Files:** `rules.js`: chips, the preset, saved choices, spots shown, names, view margin, grouping;
`loot-data.js`: loading `/api/loot/<map>`; `map-layer.js`: drawing, redraw after the view settles,
taps, the popup; `marker-images.js`: the tile, bubble and floor-badge pictures; `panel.js`: the
Loot section and its buttons; `loot.css`. Server: `internal/gamedata/loot.go`, the route in
`internal/httpapi/routes.go`.

**Tests:** `rules.test.js` (saved choices, chips and counts, High value, spots, names, margin,
grouping; real Customs and Streets loot from `testdata/golden/loot-real.json.gz`);
`app/saved-data.test.js` (no loot in old files, damaged choices); `internal/gamedata/loot_test.go`
(the trimmed real sample case by case, counts per type against the source for Customs,
Interchange and Streets, the golden file, the per-map answer, the store);
`internal/httpapi/loot_test.go` (map-key validation); `tests/browser/loot.e2e.mjs` (section,
counts, High value, popup, bubble zoom, saved per map, reload, None, nothing changes on the task
side, idle trace). **Needs the owner in-game:** Customs and Interchange with High value on: are
the spots you know (dorms safes, PC blocks, …) where you expect? On Windows with a real GPU,
does panning Streets with every chip on feel as smooth as without?
