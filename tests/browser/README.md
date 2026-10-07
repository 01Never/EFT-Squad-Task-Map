# Browser smoke suite (`tests/browser/`)

**What it is:** end-to-end checks of the real page in headless Edge, against the real Go server
and the offline mock (`cmd/mock`). It was written for ticket 04b (reorganise the page with no
behaviour change) and stays as the safety net for every later ticket: run it before and after a
change.

- It builds the app and the mock **from this working tree** at the start of each run, so it
  always tests the page files next to it.
- Each scenario starts its own app on scratch folders in the system temp folder, with saved data
  and settings from `fixtures/`. It **never touches the owner's real data**: every `STM_*`
  variable from your shell is dropped before the app starts.
- It imports nothing from `web/js/`. It only uses what a user or the server sees: DOM ids,
  classes, `data-*` attributes, visible text and the HTTP API. The full list is below; a change
  that renames one of them must update this suite in the same commit.
- `npm test` doesn't run it (it needs Edge, Go and the mock).

## Running it

Prerequisites: Microsoft Edge (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`,
or set `STM_E2E_EDGE`), Go on the PATH (or `STM_E2E_GO`), Node 24, and `npm install` once
(dev dependencies `playwright-core` and `pngjs`; no browser download).

From PowerShell in the repo root:
```
npm run test:browser
```
That's `node --test --test-concurrency=1 --test-global-setup=tests/browser/global-setup.js "tests/browser/*.e2e.mjs"`.
The global set-up builds both programs and starts the mock once; the files run one after the
other. About 3 minutes; most of it is waiting for the game-log check (every 5 s) and the 20 s
find-me pulse.

One file, or some tests by name:
```
node --test --test-global-setup=tests/browser/global-setup.js tests/browser/find-me.e2e.mjs
node --test --test-global-setup=tests/browser/global-setup.js --test-name-pattern="Hide gives" tests/browser/task-list.e2e.mjs
```
(A file run without `--test-global-setup` builds its own copies and starts its own mock.)

**Ports:** the mock on **7821**, the apps on **7830–7859** (one per scenario, claimed with lock
files in `%TEMP%\stm-e2e-ports`, so parallel runs never share one). Override with
`STM_E2E_MOCK_PORT` and `STM_E2E_APP_PORTS=7860-7889` to run a second copy side by side. If
something already answers like the mock on the mock port (e.g. one left over from a run that
was killed), it's reused.

**Scratch folders:** `%TEMP%\stm-e2e-run-*` (the built programs and each scenario's data,
removed at the end), plus `%TEMP%\stm-e2e-screens-desktop` and `-phone` for the screenshot
scenarios: their paths show up in the panel footer and in Settings, so they're fixed to keep
screenshots identical between runs. Don't run two copies of the suite at once in record mode.

## Settings (environment variables)

| Variable | Effect |
|---|---|
| `STM_E2E_RECORD=<dir>` | Record mode: saves screenshots, each scenario's API requests and the saved-data round trips into `<dir>` (see below). |
| `STM_E2E_UPDATE=1` | Rewrites the recorded expectations in `fixtures/expected/` instead of checking them. Only after a deliberate behaviour change, and say so in the commit. |
| `STM_E2E_STATE=<path>` | Also runs the saved-data round trip on that file, e.g. a **copy** of the owner's `squad-task-map-data.json` (the file is only read; the app works on a copy). |
| `STM_E2E_STATE_EXPECTED=<path>` | What the `STM_E2E_STATE` round trip must save, e.g. the `state/stm-e2e-state.json` recorded before a change. Without it, a v2 file must come back unchanged (fields the page adds as defaults are listed, not failed). |
| `STM_E2E_KEEP=1` | Keep the scratch folders (each has the app's console output in `app-output.txt`). |
| `STM_E2E_PAGE_FROM_DISK=1` | Serve `web/` from disk (`STM_ASSETS_DIR`) instead of the files built into the exe. By default the suite tests the exe as built, which also checks `embed.go`. |
| `STM_E2E_EDGE`, `STM_E2E_GO` | Paths to Edge and Go. |
| `STM_E2E_MOCK_PORT`, `STM_E2E_APP_PORTS` | Ports (default 7821 and 7830-7859). |

## Before and after a change (ticket 04b)

```
$env:STM_E2E_RECORD = "dist/04b-baseline/before"; npm run test:browser      # on the old page
$env:STM_E2E_RECORD = "dist/04b-baseline/after";  npm run test:browser      # on the new page
node tests/browser/compare.mjs dist/04b-baseline/before dist/04b-baseline/after
```
A recording holds:
- `requests/<file>--<test>.json`: the page's requests in order. `api` lists every request that
  isn't a static file: `METHOD /path?query`, plus `body:<fingerprint>` for PUT/POST, and
  `# step` markers. Before fingerprinting, values that change between runs are replaced:
  timestamps from the last two days, ids the page makes up (new categories, sub-tasks), AI job
  ids; repeated polls of one AI job count once. `bodies` has the normalised bodies. `static` is
  the set of scripts, styles and fonts loaded (04b moves those, so they're only listed).
- `screenshots/*.png` at 1600×900 (and 400×850 for phone): picker, Streets map, task list, Bring
  list, Settings, a selected task, phone picker and map. Animations are frozen, item icons
  (assets.tarkov.dev) are blocked, fonts are loaded first.
- `state/*.json`: what the page saved after loading each data fixture and saving with no edits.

`compare.mjs <before> <after>` checks the request lists are identical, diffs every screenshot
pixel by pixel (prints the % of differing pixels and writes a diff image to `<after>/diff/`;
`--max-diff-percent` and `--tolerance` relax it) and checks the saved data is equal. Exit code
0 = everything matches. Two runs of the unchanged page match exactly (0 differing pixels).

## Scenarios

| File | Tests |
|---|---|
| `picker-and-map.e2e.mjs` | picker counts per map (every task active; recorded); one Streets task counts on Streets only; Streets markers, zones, extracts and category counts (recorded); the Scav extract chip. |
| `task-list.e2e.mjs` | add a task by name; tick a marker objective → "have" goes down, untick gives it back (and only what that tick took); pins and Pinned only (list, markers, Bring list); mark / unmark / clear extracts; Move to, Re-sort everything + Undo, Don't split; selection highlight, flash, marker click, Esc, empty-map click; Hide / ◂ Tasks keeping the view; Settings save; phone width layout and Find me. |
| `ai-and-scan.e2e.mjs` | AI key (wrong, then right), categorize, apply, undo (mock); Scan without a key asks for one; Scan capture → review → confirm replaces the list and deletes the screenshot; cancel at review and while capturing keep the screenshots. |
| `game-log.e2e.mjs` | log: "Pve" then "PvpSeason" leaves no prompt; accepted task added, finished task removed; a PvE session's task ignored, the prompt switches data; GPS screenshot → arrow turned by the heading; raid end resets bag counts and extract marks and deletes that raid's GPS screenshots. |
| `find-me.e2e.mjs` | ticket 01: marker, 20 s pulse, off-screen chip, Find me and Show keep the zoom; ticket 02: Follow off/on, mid-drag, toolbar ↔ Settings; ticket 03: closest extract (shown, marked, transits, raid end). |
| `paint.e2e.mjs` | a Chrome trace sees paints while zooming (control); 0 main-thread Paint/Layout during the selection flash and during the find-me pulse. |
| `saved-data.e2e.mjs` | v1 fixture → recorded migration; rich v2 fixture saves back unchanged; v2 with missing fields → recorded fill; `STM_E2E_STATE` (skipped unless set). |
| `icons.e2e.mjs` | ticket 07: A Fuel Matter on Reserve shows the MS2000 icon (`image[href="/icons/<id>.webp"]` in `g.mk`; the app fetched it once from the mock's `/assets/`); Dandies on Streets shows the stashed items; with the icon 404 (`POST /icons-missing` on the mock) markers silently become shapes (no `image` left); Settings → Task markers (`#sMarkers`) "shapes" is saved as `taskIcons: false`; a plant with alternatives has a `circle[r="3.4"]` "+" badge; frame timing and a Chrome trace with every task active on Streets, shapes vs icons. `STM_E2E_SHOTS=<dir>` saves screenshots. |
| `squad.e2e.mjs` | ticket 05: **three copies of the app on the dev transport** (own data folders, app ports and peer ports; the harness's `startApp`/`Scenario` take `env`, and `startApp` takes `keepData` to restart a copy): Join in Settings (bad code shows the server's message), drawings travel in the friend's colour and undo removes them, a friend's ✎ Draw switch hides them, tasks shared by one and not the other, "Also: …", badge dots, Shared with squad, popup progress, Friends' tasks, a friend offline ("last seen") and back, Leave. `STM_E2E_SHOTS=<dir>` saves screenshots. Uses `#sSquad*`, `.squad-chip`, `[data-squad-drawings]`, `[data-squad-tasks]`, `[data-act=squadonly]`, `.also`, `.squad-dot`, `.squad-tasks`, `.friend-marker`, `g[data-friend]`. |
| `loot.e2e.mjs` | ticket 08, against a **second mock serving the real json.tarkov.dev files** (`startRealDataMock()`: `MOCK_DOCS=real`, on a port claimed from the app range; the app gets it as `STM_JSON_BASE`): the Loot section starts closed and nothing is loaded; chip counts equal `testdata/golden/loot-real.json.gz`; ★ High value (saved set), a spot's popup, an empty-map click closes it, a bubble click zooms in, a single chip, reload keeps the choices, another map has none, None; markers, "!", the Bring tab and selection never change; Streets with every chip on: far fewer markers than spots, 0 Paint / 0 Layout in a 3 s idle trace. Uses `[data-loot-section]` (+ `summary`, `open`), `[data-loot="<type>"]` (`aria-pressed`, `.n`), `[data-act="loothigh"]`, `[data-act="lootnone"]`, `svg.map g.lt` (`.lt-group` = bubble), `#lootpop` (`hidden`, `h3`, `.m`), `.mapui`. |
| `screens.e2e.mjs` | the main screens come up; the baseline screenshots in record mode. |

**Fixtures** (`fixtures/`): `fresh-v2-state.json` (the page's empty state), `rich-v2-state.json`
(ticks, counter ticks, pins, a hidden and a custom category, moved parts, Don't split, sub-tasks,
a drawing, view settings for two maps, extract marks, have/used, collapsed category),
`partial-v2-state.json` (fields missing on purpose). The v1 fixture is `tests/fixtures/v1-data.json`.
Task ids come from `testdata/golden/data-mock.json.gz`, what the mock serves.

**Recorded expectations** (`fixtures/expected/`, recorded from the page before 04b): picker and
Streets counts, the AI proposal lines and wrong-key message, the scan review, the GPS arrow
turns, and the saved-data round trips.

## What the suite relies on (keep these, or update the suite with them)

**HTTP:** `GET /api/loot/<map>` (the loot scenario), `GET /api/status` (`statePath`, `data.origin`, `data.mode`, `settings`, `raid.sessionMode`,
`gps`, `ai`), `GET /api/data`, `GET /api/config`; requests matched by path: `PUT /api/state`,
`PUT /api/settings`, `PUT /api/ai/key`, `POST /api/scan/start`, `POST /api/scan/cancel`.
Files in the data folder: `squad-task-map-data.json`, `squad-task-map-settings.json`.

**Shell:** `#settings`, `#navinfo .raid`, `#navinfo .modewarn`, `#navinfo .dd`, `#modeSwitch`,
`#toast` (shown = computed `display` isn't `none`), `#toastAct`, `.modal`, `.modal h3`,
`.modal h4`, `.modal .mnote`, `#capbar` (`hidden`), `#capdone` (`disabled`), `#capcancel`,
`#capbar .th img`.

**Picker:** `.picker h1` ("Maps"), `.picker .lede`, `.picker .card` (`href="#/map/<key>"`,
`.meta b`, `.meta span`, `.meta span.has`, `.thumb svg`), `.picker details.offmap summary`, `#pscan`.

**Map:** `svg.map` (its `viewBox` is the pan/zoom; the map art's own groups have class `.lyr`),
`svg.map g.mk` (task markers: a `path`, or for an item icon a `rect` tile + `image`), `svg.map g.ex` (`data-name`, `.on` when marked,
a `rect` inside), `svg.map g[data-r]` (your marker; `data-r` = arrow turn in degrees, one decimal),
`svg.map text` "You", `svg.map polyline[stroke-dasharray="9 6"]` (line to the closest extract),
`svg.map polygon` outside `.lyr` (zones + extract outlines), `#stage`, `#fx .ping` with
`i.halo` / `i.wave` (CSS animations `halo` / `wave`, infinite), `#findme-fx`, `.findme-ring`,
`#findme-chip` (`hidden`), `#gpsbar` (`hidden`), `#gpsbar-you`, `#gpsbar-closest`, `#gpsgo`,
`#gpsclosest`, `#pop` (shown = computed `display` isn't `none`), `#pop h3`, `#zin`, `#zfit`,
`#bfindme` (`disabled`, `title`, `.lbl`), `#bfollow` (`aria-pressed`), `#bpin` (`aria-pressed`),
`#showpanel`, `.app`, `.app.nopanel`.

**Panel:** `#panel`, `#panel .phead`, `#panel .phead h2 small`, `#addtask`, `[data-tab="tasks"]`,
`[data-tab="bring"]`, `[data-act="pinnedonly"]` (`aria-pressed`, `.n`), `[data-act="clearpins"]`,
`[data-act="clearext"]`, `#panel .exlist` / `.tag.ai` (marked extracts, ticket 06), `#sReadExt`, `#exOn` / `#exOff` (the extracts notice), `[data-act="hidepanel"]`, `details.menu summary`, `[data-act="resortall"]`,
`[data-ext="pmc|scav|shared|transit"]` (`aria-pressed`, `.n`), `.cat` (`data-cat`, `.tog .name`,
`.tog .cnt`), `.tasks .task`, `.task` (`data-task`, `data-part`, `.sel`), `.task .trow`,
`.trow-wrap`, `.nm` (its first text node is the task name), `.bang`, `.partof`,
`[data-act="pin"]`, `.pinb.on`, `.tbody`, `[data-tickbox="<objective id>"]`,
`select[data-move="<part key>"]` (option values = category ids), `[data-act="unmove"]`,
`[data-nosplit="<task id>"]`, `.bring`, `.bl[data-key="<item id>"]`, `.bl .need`, `.bl .bt`,
`[data-have="1"]`, `[data-haveset]`.

**AI and scan:** `.aihead`, `.aihead .s`, `[data-ai-act="key|send|apply|undo"]`, `#aitext`,
`.msg.bot[data-mi]`, `.msg .ch li`, `.msg .acts2`, `.msg .acts2 .ok`, `#aikey`, `#aisave`,
`#aierr`, `#rvok`, `#rvcancel`, `.modal [data-add]` (inside a `label`), `.modal .tag.warnt`.

**Settings:** `#sMode`, `#sFollow`, `#sCenter`, `#sSave`, `#sClose`.

**Visible text** checked word for word: toasts "No task called “…”", "Added “…”",
"Re-sorted everything" (+ "Undo"), "Settings saved", "OpenAI key saved", "Applied 3 changes",
"Undone", "Scanning reads your screenshots with OpenAI — add your key first",
"Added 6 tasks · removed 1 · deleted 1 screenshot", "Added from the game: Dandies",
"Switched to PvE data", "Raid over: bag counts and extract marks reset, 2 GPS screenshots
deleted", "Following you"; the picker's "N active tasks. Pick a map." and "1 task" / "no tasks";
"need 3"; "Showing pinned tasks only."; "Clear 1 marked"; "Done (1)", "0 captured"; the scan
review note and "Update list & delete 1 screenshot"; "● In raid: Streets of Tarkov",
"PvE data", "PvE · Switch data Not now"; "📍 You … · just now Show", "Closest shown";
Find me's two tooltips; Settings' "PvP · 515 tasks · downloaded just now" and "No key yet";
"not set up", "gpt-5.4-mini", "Moved 3 parts that need keys."; the Re-sort confirm
"Put every part back into its default category?".

## Writing a new scenario

- `test("<a sentence>", (t) => withScenario(t, { state, settings, phone }, async (s) => { … }))`.
  `s.page` is the Playwright page; `s.openMap(key)`, `s.openPicker()`, `s.appLog(line)`,
  `s.taskMessage(id, 10|11|12)`, `s.dropGps(x, y, z)`, `s.dropGpsAndWait(...)`,
  `s.dropScreenshot(name)`, `s.savedState()`, `s.status()`, `s.step(label)`.
- Wrap every action that saves in `await s.saving(() => …)`: the page saves 500 ms after a
  change, and waiting for each save keeps the request list the same from run to run.
- Wait for an element or a condition, never for network idle: the page keeps a live-event
  stream open.
- The scenario fails if the page throws or logs a console error.
