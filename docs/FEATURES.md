# Features: start here

One row per feature. Open the feature's Go package and page folder to see everything about it.
Each page folder (and each Go feature package) has a README with the rules, the flow and the
tests. How the server parts connect is in `internal/app/app.go`; how the page's parts connect is
in `web/js/main.js`, `web/js/app/live-events.js` (live events), `web/js/map/map-page.js` (the map
page and its layers) and `web/js/panel/panel.js` (the panel's sections and its click router).

| Feature | Ticket | Go package | Page folder | Saved data it owns | Events | Settings |
|---|---|---|---|---|---|---|
| Tasks: your list, parts, categories, ticks, pins, markers, popup, selection | v2 | (none) | `web/js/features/tasks/` | `tasks`, `ticks`, `cats`, `collapsed`, `pinnedOnly` | receives `task` (via `app/live-events.js`) | none |
| Readiness: what each objective needs, "!" and fading, the Bring list | v2 | (none) | `web/js/features/readiness/` | `have`, `used`, `panelTab` | none (reset by `raidEnd`) | none |
| Sub-tasks: your notes under a task, pins on the map | v2 | (none) | `web/js/features/sub-tasks/` | `subs` | none | none |
| Drawing on the map | v1, v2 | (none) | `web/js/features/drawing/` | `draw`, `dcolor`, `dwidth`, `prefs[map].drawOn` | none | none |
| Extracts: chips, marking, place names chip; closest extract (ring, line, "Closest: …") | v2, 03 | (uses `gps`) | `web/js/features/extracts/` | `prefs[map].ext`, `prefs[map].extMarked`, `prefs[map].labels` | receives `gps`, `raidEnd` | none |
| Map picker | v2 | (none) | `web/js/features/picker/` | `showScanBanner` (Dismiss) | none | none |
| Game log: tasks accepted/finished/failed, raid lines, game mode, screenshot key | v2, 04 | `internal/features/gamelog` | `web/js/app/live-events.js` (tasks: `features/tasks`) | none | sends `task` (deliver), `mode`, `keybind` | `logsPath`, `gameMode` |
| Raid: loading map, start, end; deletes that raid's GPS shots; the game-mode prompt | v2, 04 | `internal/features/raid` | `web/js/features/raid/` | none (resets `have`, `used`, extract marks) | sends `raidMap`, `raidStart`, `raidEnd` (deliver); page receives these and `mode` | `gameMode` |
| Position from screenshot names, trail | v2, 04 | `internal/features/gps` | `web/js/features/find-me/` | none | sends `gps` | `screenshotsPath` |
| Find me: player marker, pulse, off-screen chip, Find me button, auto-center (◎ Follow) | 01, 02 | (uses `gps`) | `web/js/features/find-me/` | none (pulse start in memory) | receives `gps` | `followPosition` (switch map), `autoCenter` |
| Scan tasks: capture, AI read, review, replace the list | v2, 04 | `internal/features/taskscan` | `web/js/features/scan/` | `tasks` (replaced on confirm) | sends `capture` | OpenAI key/model, `screenshotsPath` |
| AI Categorize | v2, 04 | `internal/features/aicategorize` | `web/js/features/ai-categorize/` | `cats`, `tasks[].partCats` (on apply), `aiOpen` | none (job polled while it runs) | OpenAI key/model/effort |
| Settings and the OpenAI key | v2, 02, 04 | `internal/storage` (settings file), `internal/app` | `web/js/features/settings/` | none | none | all of them |
| Game data: json.tarkov.dev, cache, built-in snapshot | v2, 04 | `internal/gamedata` | `web/js/app/game-data.js` | `squad-task-map-gamedata-<mode>.json` (server) | sends `data` | `gameMode` |
| Saved data: defaults, v1 → v2 migration, saving | v2, 04 | `internal/storage` (stores it as text) | `web/js/app/saved-data.js`, `web/js/app/saving.js` | the whole `squad-task-map-data.json` | none | none |
| Check for updates: manual button, signed manifest from GitHub Releases, download, swap exe, restart | 04c | `internal/features/updates` (+ `cmd/release`) | `web/js/features/updates/` | `squad-task-map-data.before-<version>.json` (newest 3), `squad-task-map-update-notice.json` | sends `updates` | none |
| Only the app's own page: Host check (421), Origin / Sec-Fetch-Site check (403), JSON bodies only (415) | 04d | `internal/httpapi` (`guard.go`), allowed hosts built in `internal/app/run.go` | `web/js/app/api.js`, `web/js/app/saving.js` (send JSON bodies as `application/json`) | none | none | none |
