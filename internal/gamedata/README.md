# Game data (`internal/gamedata`)

**What it does (player's view):** every task, objective, zone, extract and transit the map shows.
Settings → Game data says where it came from: downloaded today, a saved copy, or built-in.

**Where the data comes from:** json.tarkov.dev's flat files for the chosen game mode
(`{mode}/tasks`, `tasks_en`, `maps`, `maps_en`, `traders`, `traders_en`, `items_en`). Names in the
base files are translation keys (`"<id> name"`); the `_en` files hold the English text. Checked
against the real files on 2026-10-05 (ticket 04 step 0): the converter's assumptions hold, nothing
is left untranslated, and the payload is about 1.8 MB.

**The rules:**
- On start: use the saved copy (`squad-task-map-gamedata-<mode>.json`) when it exists, else the
  snapshot built into the exe (`assets/game-data.json`).
- Once an hour, check the age; download again when it's over a day old (`refreshWhenOlderThan`).
- A download is accepted only with at least `minimumTasks` = 200 tasks (and at least half the
  previous count) and `minimumMaps` = 5 maps; otherwise the old data stays and Settings shows the
  error. This protects against a half-broken download.
- Conversion (`convert.go`, `snapshot.go`) is a 1:1 port of v2's `server/convert.ts`. Its output is
  JSON-equal to the v2 output for the snapshot, the mock files and the real files
  (`convert_test.go` against `testdata/golden/`).
- JavaScript details the port keeps on purpose: tasks and maps come out in the files' key order;
  outlines are rounded like JavaScript's `toFixed(2)`; "is this set?" follows JavaScript truthiness
  (`jsvalues.go`).
- The game log names maps by scene path or nameId; `MapFromScene` / `MapFromNameID` match those
  against the data, with fallback tables (`SceneToMap`, `NameIDToMap`).

**Flow:** `Start(mode)` → saved copy or built-in → `Refresh()` in the background when stale →
`FromRaw()` → validation → saved next to the exe → `onChange` → the app broadcasts the `data` event
→ the page reloads `/api/data`.

**Saved data / settings:** owns `squad-task-map-gamedata-<mode>.json`; reads the `gameMode` setting
(through the app).

**Files:** `types.go` (the page's format), `convert.go` (json.tarkov.dev → page),
`snapshot.go` (built-in snapshot → page, log map-name tables), `jsvalues.go` (JavaScript-style value
rules and in-order JSON reading), `store.go` (cache, refresh, lookups).

**Tests:** `convert_test.go`: JSON-equal to the v2 goldens for three inputs; JavaScript `toFixed`
rounding. The hourly refresh and the fallbacks are checked end to end against `cmd/mock`.
