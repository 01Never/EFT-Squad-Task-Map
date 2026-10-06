# Features: start here

One row per feature. Open the feature's Go package and page folder to see everything about it.
Each has a README with the rules, the flow and the tests. How the parts connect is in
`internal/app/app.go`.

The page code of features built before the roadmap (task list, parts, readiness, scan review,
drawing…) still lives in the v2 layout (`web/js/*.js`, `web/js/logic/`); ticket 04b moves it into
`web/js/features/` and fills in their page columns.

| Feature | Ticket | Go package | Page folder | Saved data it owns | Events | Settings |
|---|---|---|---|---|---|---|
| Game log: tasks accepted/finished/failed, raid lines, game mode, screenshot key | v2, 04 | `internal/features/gamelog` | `web/js/live.js` | none | sends `task` (deliver), `mode`, `keybind` | `logsPath`, `gameMode` |
| Raid: loading map, start, end; deletes that raid's GPS shots | v2, 04 | `internal/features/raid` | `web/js/live.js` | none (page resets `have`, `used`, extract marks) | sends `raidMap`, `raidStart`, `raidEnd` (deliver) | `gameMode` |
| Position from screenshot names, trail | v2, 04 | `internal/features/gps` | `web/js/features/find-me/` | none | sends `gps` | `screenshotsPath` |
| Find me: player marker, pulse, off-screen chip, Find me button, auto-center (◎ Follow) | 01, 02 | (uses `gps`) | `web/js/features/find-me/` | none (pulse start in memory) | receives `gps` | `followPosition` (switch map), `autoCenter` |
| Closest extract: ring + dashed line to the closest of your (marked / shown) extracts, "Closest: …" in the position bar | 03 | (uses `gps`) | `web/js/features/extracts/` | reads `prefs[map].extMarked`, `prefs[map].ext` | receives `gps`, `raidEnd` | none |
| Scan tasks: capture, AI read, review, replace the list | v2, 04 | `internal/features/taskscan` | `web/js/scan.js` | `tasks` (replaced on confirm) | sends `capture` | OpenAI key/model |
| AI Categorize | v2, 04 | `internal/features/aicategorize` | `web/js/ai.js` | `cats`, `tasks[].partCats` (on apply) | none (job polled while it runs) | OpenAI key/model/effort |
| Check for updates: manual button, signed manifest from GitHub Releases, download, swap exe, restart | 04c | `internal/features/updates` (+ `cmd/release`) | `web/js/features/updates/` (part 2) | `squad-task-map-data.before-<version>.json` (newest 3), `squad-task-map-update-notice.json` | sends `updates` | none |
| Game data: json.tarkov.dev, cache, built-in snapshot | v2, 04 | `internal/gamedata` | `web/js/live.js` (`reloadData`) | `squad-task-map-gamedata-<mode>.json` | sends `data` | `gameMode` |
