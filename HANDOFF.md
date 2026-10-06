# Handoff: Squad Task Map v2

For Claude Code picking up this project. Read this file, then `CLAUDE.md` (rules), then `SPEC.md` (the v2 design, still the source of truth for intended behavior), then `docs/ROADMAP.md` (the tickets being built now) and `docs/CODE-STYLE.md` (how new code is written). `README.md` is the user-facing manual.

Current version: see `VERSION` in `server/main.ts` and `version` in `package.json` (kept equal).

---

## 1. Read this first

1. **What it is:** a Windows desktop helper for Escape from Tarkov. One Bun program compiled to `SquadTaskMap.exe` that:
   - serves a map web page on `http://127.0.0.1:7777`;
   - watches the game's **log files** (tasks accepted/finished, raid start/end, game mode);
   - watches the **screenshots folder** (in-raid GPS position from file names; task-list scans read by OpenAI vision);
   - downloads task/map data from **json.tarkov.dev**.
   The owner and their squad use it while playing, often with the map on half the screen.
2. **The game is CPU-bound and runs at the same time.** Lightness is a hard requirement, not a nice-to-have. See §7.
3. **The owner decides features.** They like to talk a feature through before anything is built. Don't change behavior that wasn't asked for. When a request is ambiguous, ask. Squadmates' feedback arrives through the owner; build what the owner asks for, which can differ from the raw feedback (e.g., the friend asked for red highlights and the owner said "not red").
4. **v2 has never run against the real game, real Windows paths, live json.tarkov.dev or a real OpenAI key.** It was built and tested in a Linux sandbox against stand-ins (§9). The owner hasn't reported in-game results yet. Treat the items in §10 as unverified until they confirm.
5. **Deliverables the owner expects:** the Windows exe (zipped; also `.7z` if the zip is over 30 MB) **and** the source. See §3.
6. **Git:** the project is a local git repo (no remote). `main` holds released work; each roadmap ticket gets its own branch (`ticket-NN-<name>`), merged into `main` when the owner accepts it.

---

## 2. Hard rules (also in CLAUDE.md)

- **TarkovMonitor is GPL-3.0.** Read it for formats and behavior; never copy its code.
- **File deletion:** never delete anything outside the app's own files except:
  1. screenshots the user confirmed in a scan (`Screens.deleteCaptured`, only names in the current capture list);
  2. GPS screenshots created during the raid that just ended (`Screens.deleteRaidShots`, only files it saw being created).
- **API keys** stay server-side, stored in plain text in `squad-task-map-settings.json`, and are only sent to `api.openai.com`. The page never sees the full key (`mask()`).
- **Projection (`web/js/logic/projection.js` `makeProj`) is exact** and verified against tarkov.dev test vectors. Keep its tests passing.
- **Saved-state changes need a migration path** (see §6.2).
- Use a scratch `STM_DATA_DIR` while developing so the owner's real `squad-task-map-data.json` isn't touched.

---

## 3. Run, test, build

Bun is installed at `%USERPROFILE%\.bun\bin\bun.exe` (on the user PATH; a VS Code window opened before the install may need a full restart to see it). Git is at `E:\coding\Git\cmd\git.exe`. Go and Node are **not** installed yet; ticket 04/04b need them. Bun is uninstalled as the last step of ticket 04 (owner's decision), not before.

No dependencies to install (empty `dependencies`; there's no `tsconfig` or `@types/bun`, so the editor may flag `Bun` globals and `import … with { type: "text" }`. `bun add -d @types/bun` fixes that if wanted).

| Task | Command |
|---|---|
| Dev run | `bun run dev` (bundles the page, then runs `server/main.ts`) |
| Unit tests | `bun test` (`tests/*.test.ts` plus `web/js/features/**/rules.test.js`) |
| Windows exe | `bun run build` → `dist/SquadTaskMap.exe` (~120 MB) |
| Linux binary (smoke tests) | `bun run build:linux` |

**Gotcha:** `server/main.ts` embeds `web/dist/app.js`. If you run `bun server/main.ts` directly after editing `web/js/*`, you get the **old** page (or an import error if `web/dist/` doesn't exist). Always go through `bun run dev` / `bun run build`, or run `bun run build:web` first.

**Environment variables** (PowerShell: `$env:NAME="value"; bun run dev`):

| Variable | Effect |
|---|---|
| `STM_DATA_DIR` | Where data/settings files live (default: exe folder, or cwd in dev) |
| `STM_NO_BROWSER=1` | Don't open a browser on start |
| `PORT` | First port to try (default 7777; tries up to 7800) |
| `STM_LOGS_DIR` / `STM_SCREENSHOTS_DIR` | Override detected game folders |
| `STM_JSON_BASE` | Game-data base URL (default `https://json.tarkov.dev`) |
| `STM_OPENAI_API` / `STM_WIKI_API` | OpenAI and wiki endpoints (for the mock server) |

**Release checklist**
1. Bump `VERSION` in `server/main.ts` and `version` in `package.json`.
2. `bun test`, then the manual checks in §9 that touch your change.
3. `bun run build`.
4. Zip `SquadTaskMap.exe` + `README.md` in a `SquadTaskMap-v2/` folder. If over 30 MB (it is, ~43 MB), also make a `.7z` with LZMA2 max (~28 MB). The owner receives files through a chat with a 30 MB limit.
5. Zip the source without `node_modules/`, `dist/`, `web/dist/`.
6. Update `README.md` for user-visible changes, and this file.

---

## 4. Architecture

```
Tarkov logs ──(5 s size check)──► LogWatcher ─┐
Screenshots ──(fs.watch)────────► Screens ────┤
json.tarkov.dev ──(hourly check)─► gamedata ──┼─► server/main.ts ──HTTP/SSE──► page (web/js) ──PUT /api/state──► squad-task-map-data.json
OpenAI ◄──(scan, categorize)───── ai.ts ──────┘        127.0.0.1 only
```

- **The page owns the saved data.** It loads `GET /api/state`, migrates it, and saves the whole object with `PUT /api/state` (500 ms debounce, `flush()` on tab hide/unload). The server just stores it (atomic write plus a `.bak`).
- **Server → page events use Server-Sent Events** (`/api/events`). There are two kinds (`server/events.ts`):
  - `deliver(ev)`: events that change saved data (`task` started/finished/failed, `raidEnd`). They're queued in `squad-task-map-pending.json` and resent until the page acks (`POST /api/events/ack`). That way a task accepted while the browser was closed still lands.
  - `broadcast(ev)`: transient events (`gps`, `capture`, `raidStart`, `raidMap`, `mode`, `keybind`, `data`). They're dropped if no page is open.
- The page handles events in `web/js/live.js` `handle()`.
- **The page never polls,** with one exception: it polls `/api/ai/job/:id` while an AI Categorize request runs.

### Server (`server/`)
| File | Role |
|---|---|
| `main.ts` | Embeds assets; every HTTP route (one `handler`); raid/GPS state; wiring of log events. Routes: `/api/config`, `/api/data`, `/api/status`, `/api/events(+/ack)`, `/api/state`, `/api/settings`, `/api/data/refresh`, `/api/ai/key`, `/api/ai/categorize`, `/api/ai/job/:id`, `/api/scan/{start,stop,cancel,remove,image,read,confirm}`, `/maps/*`, `/fonts/*`. |
| `gamedata.ts` | Loads the cache or bundled snapshot; refreshes from json.tarkov.dev when data is over 24 h old (checked hourly); validates (at least max(200, 50% of previous) tasks and at least 5 maps, else keeps the old data). `dataStatus().origin` is `live`, `cache` or `built-in`. |
| `convert.ts` | json.tarkov.dev raw files → the internal `stm-v2` format (§6.1). Also converts the bundled snapshot (`assets/game-data.json`). Has the scene-path → map and nameId → map tables. |
| `logs.ts` | `LogWatcher`: newest session folder, `notifications`/`application` log files, reads only new bytes, starts at the end (no catch-up), rescans the folder every 6th poll (30 s). |
| `logparse.ts` | Splits log text into entries (header line plus optional JSON block; keeps an incomplete tail) → events. |
| `screens.ts` | `fs.watch` on the screenshots folder (400 ms debounce). GPS-named files → `gps` callback. Capture mode for scans. The only code that deletes files. |
| `gpsname.ts` | Parses `YYYY-MM-DD[HH-MM]_x, y, z_qx, qy, qz, qw (n).png`; yaw uses TarkovMonitor's component order (x, z, y, w). |
| `paths.ts` | Data file names; Windows detection: Documents via PowerShell `GetFolderPath('MyDocuments')` (OneDrive-safe); logs via the registry uninstall key `EscapeFromTarkov` → `InstallLocation`, or Steam `libraryfolders.vdf` → `appmanifest_3932890.acf`. |
| `store.ts` | Settings (drops old `tt*` TarkovTracker keys), state file, v1 backup, pending event queue. |
| `ai.ts` | OpenAI Responses API, strict JSON schemas. `categorize()` works on **parts** and has a `get_wiki_page` tool. `readTaskList()` does the vision scan. Wiki cache kept 7 days. |

### Page (`web/`)
- `index.html`: all CSS (tarkov.dev palette, Bender font) and the shell. Mobile breakpoints at 860 px and 600 px. Feature CSS added by roadmap tickets sits in its own clearly labelled block until ticket 04b moves CSS into files.
- `web/js/logic/` (DOM-free, unit tested):
  - `projection.js`: game ↔ SVG coordinates, floor badges, arrow rotation.
  - `parts.js`: objective actions, splitting, progress.
  - `ready.js`: requirements, readiness, bring list.
  - `state.js`: defaults, `fill`, `migrate`, `catForPart`, `forgetTask`.
  - `match.js`: fuzzy task-name matching.
  - `simplify.js`: drawing strokes.
- `web/js/features/<name>/`: code added by roadmap tickets, written to `docs/CODE-STYLE.md` (README, `rules.js` + `rules.test.js`, `map-layer.js`/`panel.js`). See `docs/FEATURES.md`.
- UI modules:
  - `main.js`: boot and routing (`#/` picker, `#/map/<key>`).
  - `store.js`: `app` singleton, `save`, `activate`, `finish`, `setTick`.
  - `map.js`: SVG map, pan/zoom, layers, markers, popup, selection flash, panel hide.
  - `panel.js`: right panel and Bring list; all clicks delegated through `data-act`.
  - `ai.js`, `scan.js`, `settings.js`, `live.js`, `picker.js`, `util.js`.
- **Rendering model:** `renderAll()` rebuilds the panel's innerHTML (keeping its scroll position) and redraws the SVG layers. Map overlays are `<g class="sc" data-x data-y>`, counter-scaled in `apply()` so they keep their screen size at any zoom.

---

## 5. Domain rules (what the code implements)

**Task list.** A task is active when `S.tasks[id].active`. Sources:
- **Scan:** replaces the list (see Scan below); deletes the confirmed screenshots.
- **Log:** `type` 10 = started → add; 11/12 = failed/finished → `finish()` quietly (inactive, ticks cleared, unpinned; categories and sub-tasks kept).
- **Add by name**, and **Remove task** by hand.

Log task events count only when the log's `Session mode` matches the game-mode setting (`modeMatches()`).

**Parts** (`partsOf`):
- Each objective gets an action: `boss`, `pmc`, `scav`, `mark`, `plant`, `retrieve`, `go`, or `offmap`.
- Glue rules: `giveQuestItem` joins its `findQuestItem` group; `extract` joins the group before it.
- Tasks stay whole when they are "(In one raid)", when the user ticked Don't split (`noSplit`), or when they have only one group. A whole task's key is `<id>:*` and it takes the first action in `PRECEDENCE` (boss > pmc > scav > plant > mark > retrieve > go). Split parts are keyed `<id>:<action>`.
- A part drops off the map when all its objectives are ticked.

**Categories.**
- Built-ins: Boss hunts, PMC kills, Scav / any kills, Mark, Plant / stash, Retrieve, Scout & extract, Unsorted (`DEFAULT_CATS`, matched by `builtin`).
- `catForPart` precedence: `partCats[partKey]`, then `partCats["*"]` (v1 carry-over), then the built-in for the action, then Unsorted. "Auto-sort" is therefore implicit; the button only re-creates deleted built-ins.
- "Re-sort everything" clears all `partCats`. Both have Undo.

**Ticks and "have".**
- `S.ticks[objId]` is `true` or a count.
- `setTick` takes 1 off `S.have[item]` when a marker or plant objective is ticked, and records it in `S.used[objId]`, so unticking only gives back what that tick took.
- `have` and extract marks reset at raid end.

**Readiness:** possible when you have at least 1 of every requirement still needed (2 markers and 5 marker spots means all 5 are possible). Not ready means the marker is at 50% opacity with a "!" badge (top-left) and its zone has a dotted border.
- Wear requirements are a heuristic: up to 4 single-item groups = all needed; anything else = any one outfit (`requirementsOf`).

**Bring list:** keys, items to place, gear and found-in-raid items for what's currently shown. The scope is the map, visible categories, Pinned-only and unticked objectives. Found-in-raid items also include off-map active tasks.

**Pins:** per task. Pinned-only filters the list, the markers and the Bring list.

**Extracts:** semi-transparent until clicked (marked); marks are stored in `prefs[map].extMarked` and cleared at raid end.

**Selection (2.0.1):**
- Clicking a marker selects the part: its row gets a white outline and scrolls to the centre, and the popup opens.
- Clicking a row selects it and zooms to its spots.
- The selected markers flash for as long as the part is selected. Esc, an empty-map click or the popup × deselects.

**Hide list (2.0.1):** `S.panelHidden`; Hide ▸ in the panel header and ◂ Tasks on the map. A `ResizeObserver` → `keepView()` keeps centre and zoom on any size change. Hiding isn't offered under 860 px, where the list sits under the map.

**GPS:** a new GPS-named screenshot → `gps` event. The map comes from the log's scene path (`raid.map`/`pendingMap`). The page switches maps if "Follow my position" is on, draws the player marker with `arrowRotation(cfg, yaw)`, and keeps a trail of the last 5 positions. Roadmap tickets 01–03 extend this (see `web/js/features/find-me/`).

**Raid lifecycle (application log):**
- Map: `scene preset path:maps/<x>.bundle` or `TRACE-NetworkGameCreate … Location: <nameId>`.
- Start: `application|GameStarted`.
- End: a `SelectProfile`/`SelectedProfile`/`PrepareSelectedProfileLocally ProfileId:` line, or `Got notification | UserMatchOver`. This only ends a raid if one was active or GPS shots exist.
- At raid end the server deletes that raid's GPS shots and `deliver`s `raidEnd`. The page then resets `have`, `used`, extract marks and the trail.

**Scan:**
1. `Scan tasks` → capture mode.
2. New non-GPS images appear as thumbnails.
3. Done → the page shrinks each image to ≤2048 px JPEG and sends it to `/api/scan/read`, 3 at a time.
4. Names are matched (exact, else Levenshtein ratio ≥ 0.82, with the trader as tie-break).
5. Review → confirm **replaces the list** (owner's decision after 2.0.1): new tasks are added, and every active task not in the scan is removed as if it never existed (`forgetTask`: entry, ticks, used counts and sub-tasks), with no list shown first. Removal is skipped if any screenshot failed to read or nothing was recognised. Confirm deletes the files; Cancel deletes nothing.

---

## 6. Data formats

### 6.1 Internal game data (`format: "stm-v2"`, served by `/api/data`)
- Task: `{id, name, trader, map, wiki, minLevel, kappa, lk, objs[]}`
- Objective: `{id, type, d (text), n (count), fir, opt, maps[], zones[{m,x,y,z,top?,bottom?,ol?[[x,z]]}], poss[{m,p[[x,y,z]]}], keys: Item[][] (outer = all needed, inner = alternatives), items[], marker, qi, targets[], gear{weapons, mods[][], wearing[][], notWearing}|null, time}`
- Maps: `{key, scene, nameId, extracts[{n, fa, x, y, z, ol?}], transits[{n, x, y, z}]}`
- Map keys: `streets-of-tarkov`, `ground-zero`, `customs`, `factory`, `interchange`, `lighthouse`, `reserve`, `shoreline`, `woods`. Labs, Labyrinth and Terminal have no SVG; their tasks are listed on the picker as "not shown on a map".

The raw json.tarkov.dev format (`{mode}/tasks`, `tasks_en`, `maps`, `maps_en`, `traders`, `traders_en`, `items_en`; names are translation keys) was **inferred** from tarkovtaskmap's converter and tarkov-api's GraphQL schema, because the sandbox couldn't reach json.tarkov.dev. If the real files differ, the download fails validation and the app keeps the bundled snapshot (Settings shows the error). **Fetch the real files and compare against `fromRaw()` before trusting live data** (ticket 04 step 0).

### 6.2 Saved state (`squad-task-map-data.json`, `version: 2`)
See SPEC §12. Fields: `cats`, `tasks{id: {active, source, addedAt, gamePct, scannedAt, noSplit, pinned, partCats}}`, `ticks`, `have`, `used`, `subs`, `draw`, `prefs{map: {ext, extMarked, labels, drawOn}}`, `pinnedOnly`, `panelTab`, `panelHidden`, `collapsed`, `dcolor`, `dwidth`, `aiOpen`, `showScanBanner`, `migratedFrom`.
- **Adding a field:** add its default to `freshState()`. `fill()` adds missing defaults when loading. Only bump `version` and add a `migrate` step for structural changes; keep the v1 → v2 path working (fixture: `tests/fixtures/v1-data.json`, the owner's real v1 file).

### 6.3 Files next to the exe
`squad-task-map-data.json` (+ `.bak`), `squad-task-map-settings.json` (OpenAI key/model/effort, `gameMode`, `logsPath`, `screenshotsPath`, `followPosition`), `squad-task-map-gamedata-<mode>.json`, `squad-task-map-pending.json`, `squad-task-map-wikicache.json`, `squad-task-map-data.v1-backup.json`.

---

## 7. Performance rules

Measured idle cost: **~0.2% of one core, ~90–100 MB RSS.** A bare Bun process holding the same heap costs the same; it's Bun's GC timer. Keep it there:
- Server timers stay as they are: log poll 5 s (a `statSync`, then read only new bytes); folder rescan 30 s; missing-folder retry 60 s; game-data check hourly (downloads at most daily). Screenshots use `fs.watch`. **No faster timers.**
- **The page:** no polling, no timers, no continuous animation, with these exceptions:
  - **The selection flash** is HTML rings in `#fx` over the map, animated only with CSS `transform`/`opacity`. That runs on the compositor with zero main-thread paint. A trace showed 0 Paint/Layout per second, versus ~120 paints per second for the old SVG `r` animation.
  - **The find-me pulse** (ticket 01) uses the same technique, and only for ~20 s after a new position or a Find me click.
  - **Never animate SVG attributes** or anything inside the map SVG: the map is a huge SVG, and each repaint is expensive.
  - `renderFx()` rebuilds the rings only when the selection signature changes, so re-renders don't restart the animation; `placeFx()` repositions them in `apply()` using `svg.getScreenCTM()`.
- Pan/zoom uses `requestAnimationFrame` (`applySoon`).

---

## 8. Recipes

- **New API route:** add a branch in `handler()` in `server/main.ts`; use `json()`/`body()`. Keep it on 127.0.0.1.
- **New live event:** server `deliver()` if it must reach saved data, else `broadcast()`; handle it in `live.js` `handle()`.
- **New panel button:** markup with `data-act="x"` in `panel.js`; add `case "x":` in `bindPanel`'s switch; `save()` then `renderAll()`/`renderPanel()`.
- **Toast with Undo:** `toast(msg, { label: "Undo", run: () => … })`. Snapshot with `snapshotCats()`/`restoreCats()` for category changes.
- **New map:** add the SVG to `assets/` and import it in `main.ts` `SVGS`. Add an entry to `assets/maps-config.json` (key, name, svg, transform, rotation, bounds, svgBounds, baseLayer, heightRange, layers, labels). These values come from tarkov.dev's maps data (the-hideout/tarkov-dev). Check that the scene/nameId tables in `convert.ts` map to the key.
- **Change splitting/categories:** edit `parts.js`/`state.js` and add a case to `tests/core.test.ts` (tasks are looked up by name from the snapshot).
- **New roadmap feature:** a folder in `web/js/features/<name>/` with `README.md`, `rules.js`, `rules.test.js` and `map-layer.js`/`panel.js`; add a row to `docs/FEATURES.md`.

---

## 9. Testing

**Unit:** `bun test`.
- `tests/core.test.ts`: projection vectors, conversion, parts, readiness/bring list, migration, matching, GPS names.
- `tests/watchers.test.ts`: log parsing and the watchers, using temp folders.
- `web/js/features/**/rules.test.js`: the roadmap features' rules.

**Offline end-to-end:** `bun tests/mock-server.ts` (port 7820) fakes json.tarkov.dev (built from the snapshot by `tests/helpers.ts` `snapshotToRaw`), OpenAI (accepted key `sk-test_1234567890abcdefghijkl`; vision returns preset rows, changeable via `POST /set-rows`; categorize moves keyed parts to "Key runs"), and the wiki. `POST /fail {"fail":true}` simulates a json.tarkov.dev outage; `GET /log` lists requests. Then run the app with:
```
STM_DATA_DIR=<scratch>  STM_LOGS_DIR=<scratch>\logs  STM_SCREENSHOTS_DIR=<scratch>\shots  STM_NO_BROWSER=1
STM_JSON_BASE=http://127.0.0.1:7820  STM_OPENAI_API=http://127.0.0.1:7820/v1  STM_WIKI_API=http://127.0.0.1:7820/wiki
```
Create `<scratch>\logs\log_2026.10.01_10-00-00_1.1.5.1\` containing empty `x notifications.log` and `x application.log`, then **append** lines to simulate the game (the formats are the same as the helpers in `tests/watchers.test.ts`):
```
2026-10-01 11:25:03.123 -05:00|1.1.5.1|Info|notifications|Got notification | ChatMessageReceived
{
  "message": { "type": 10, "templateId": "<taskId> description" }
}
2026-10-01 11:25:03.123 -05:00|1.1.5.1|Info|application|Session mode: Regular
2026-10-01 11:25:03.123 -05:00|1.1.5.1|Info|application|scene preset path:maps/city_preset.bundle rcid:x
2026-10-01 11:25:03.123 -05:00|1.1.5.1|Info|application|GameStarted:12.3 real:4.5
2026-10-01 11:25:03.123 -05:00|1.1.5.1|Info|application|SelectProfile ProfileId:5f1 AccountId:123
```
- Message `type` is 10 = started, 11 = failed, 12 = finished.
- GPS: create a file in the shots folder named `2026-10-01[14-05]_-120.53, 3.10, 210.77_0.00000, 0.70711, 0.00000, 0.70711 (0).png`.
- Scan: start a scan, then drop any images into the shots folder.

Browser end-to-end checks are driven with `puppeteer-core` + the installed Microsoft Edge (headless), from scratch scripts outside the repo. Ticket 04b turns them into a permanent suite. Note the page keeps an SSE connection open, so wait for an element rather than for network idle.

---

## 10. Unverified: needs the owner in-game or on Windows

1. **Windows folder detection:** the registry/Steam logs lookup and the PowerShell Documents lookup. Settings shows ✓/✗ for each folder; both can be pasted by hand.
2. **Real log lines:** accept a task → added within ~5 s; finish one → removed; PvE events ignored while the setting is PvP Season; the raid start/end lines and the keybind JSON (`Control settings:` → `keyBindings[].keyName == "MakeScreenshot"`).
3. **GPS arrow direction:** two screenshots facing along a straight road. If it's off by 90° or 180°, fix the component order in `yawFromQuaternion` or the correction in `arrowRotation`. Keep the projection itself untouched.
4. **Raid end:** the toast appears, `have` is 0, and only that raid's GPS shots are gone.
5. **json.tarkov.dev live format** (§6.1).
6. **Scan accuracy** with real screenshots and a real model (default `gpt-5.4-mini`), and that a full scan leaves exactly the in-game list.

---

## 11. Known gaps and quirks (not bugs the owner has reported; ask before changing behavior)

- **Phantom tasks (reported by squadmates, not diagnosed):** tasks show that the player doesn't have. Suspects, from reading the code: (1) the v1 → v2 migration activates the whole v1 manual list, including tasks finished since; (2) `modeMatches()` accepts every log task event while the session mode is unknown, which is the case whenever the app starts after the game; (3) several open tabs each save the whole state, so a stale tab can restore a removed task; (4) a scan of a trader's available-tasks page, or a fuzzy match to the wrong name. The owner chose not to diagnose for now; a full scan now clears them. Each task entry's `source` and `addedAt` show which path added it.
- **Scan ignores the Reasoning setting:** `readTaskList` always sends `effort: "low"` for gpt-5/gpt-6/o-series models. SPEC §8 says to reuse the setting, defaulting to low.
- **No single-instance guard:** a second exe binds the next port, and both watch the logs and write the same data file.
- **Don't split vs moved parts:** a manual move stored on `<id>:<action>` doesn't apply once the task is unsplit (`<id>:*`); it falls back to the precedence default.
- GPS trail labels ("x min ago") overlap when zoomed far out.
- Item icons load from assets.tarkov.dev; offline they remove themselves (`onerror`).
- AI Categorize jobs live in server memory (`JOBS`); a restart drops a running job.
- Story chapters on the in-game Tasks screen aren't in tarkov.dev data, so they show as "Not recognised" in scans. That's expected.
- The map SVGs are CC BY-NC-SA 4.0: non-commercial only.
- The pending-event `seq` restarts at the highest queued id (0 if the queue is empty) when the server restarts, while an open page keeps its old `ackUpTo`.

---

## 12. History

- **v1.x:** TarkovTracker sync, a manual task list, AI Categorize. The owner dropped TarkovTracker because it showed tasks they didn't have.
- **2.0.0:** the full SPEC.md build: json.tarkov.dev data, logs, scan, parts, readiness, bring list, pins, extracts, GPS, raid end, migration from v1.
- **2.0.1** (squad feedback):
  - The selected task's row is clearly highlighted. The old CSS `.task.sel>.trow` never matched, because the row sits inside `.trow-wrap`.
  - The selected markers flash continuously (white ring, black edge; not red, per the owner).
  - The task list can be hidden; the map keeps its zoom on resize.
  - Esc deselects.
- **After 2.0.1, before ticket 01:** a confirmed scan replaces the task list instead of only adding (owner's request).
- **Roadmap (`docs/ROADMAP.md`):** tickets 01 → 10, one branch each. Progress is tracked in `docs/FEATURES.md` and below.

**References:**
- tarkov.dev: `the-hideout/tarkov-dev` (projection, map config), `the-hideout/tarkov-dev-svg-maps` (map art), `the-hideout/tarkov-api` (schema).
- TarkovMonitor: `tarkovtracker-org/TarkovMonitor` (GPL; formats only).
- json.tarkov.dev (data).
