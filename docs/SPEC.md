# Squad Task Map — v2 Spec (local edition)

This spec covers the next version of the local Windows app in this folder. Read the whole file before changing code. Build in the milestone order in §14, and finish each milestone's acceptance check before starting the next.

The owner tests in-game and reviews each milestone. Where a check needs the real game, ask the owner to run it and report back. Don't mark that check done yourself.

---

## 1. What exists today (v1)

A single-user app that runs on the owner's PC and serves a web page on `http://127.0.0.1:7777`. It's built with Bun and compiled to one Windows `.exe`.

| File | What it does |
|---|---|
| `server.ts` | Bun HTTP server, bound to 127.0.0.1 only, with ports 7777–7799 tried in order. Serves the page, map SVGs, the Bender font and game data. Saves state to `squad-task-map-data.json` and settings to `squad-task-map-settings.json`, both next to the exe. Has TarkovTracker endpoints (`/api/tt/*`), OpenAI endpoints (`/api/ai/*`) and `/api/refresh` (downloads a newer game-data snapshot). |
| `ai.ts` | AI Categorize: fetches and cleans Tarkov wiki pages, then calls the OpenAI **Responses API** with a strict JSON schema and a `get_wiki_page` tool. Supports a model name and a reasoning-effort setting. |
| `web/index.html` | The whole front end in one file: map rendering (SVG pan, zoom and pinch), markers, panel, categories, sub-tasks, drawing, AI chat, TarkovTracker and manual-list task sources. Styled after tarkov.dev (gunmetal/gold, Bender font). |
| `assets/` | Map SVGs (10 maps), `maps-config.json` (projection, layers and labels from tarkov.dev's `maps.json`), `game-data.json` (a tarkov.dev data snapshot from 2026-09-20, taken from the tarkovtaskmap GitHub project), `fonts.json`. |

Features that already work and **must keep working**:
- Map picker
- Accurate projection: `makeProj()`, ported from tarkov.dev and verified against known points
- Floor badges
- Extracts and transits
- Place-name labels
- Categories: create, rename, color, shape, reorder, delete, show/hide by clicking the heading
- Sub-tasks with map pins
- Drawing with undo/redo
- Wiki links
- AI Categorize with review, apply and undo
- Autosave to the JSON file with a `.bak` copy

Build and run (PowerShell):
```powershell
bun server.ts                                   # dev; opens the browser
$env:STM_NO_BROWSER=1; bun server.ts            # dev without opening a browser
bun build --compile --minify --target=bun-windows-x64 server.ts --outfile dist/SquadTaskMap.exe
```
Test hooks already in `server.ts`/`ai.ts`: `STM_DATA_DIR`, `PORT`, `STM_OPENAI_API`, `STM_WIKI_API`, `STM_TT_API` (the last one goes away in v2).

---

## 2. Goals of v2

1. **Drop TarkovTracker.** It shows tasks the owner doesn't have. The app keeps its own task list instead, fed by three sources:
   - **Screenshot scans** of the in-game task list, read by the OpenAI vision model.
   - **Game log watching:** a task accepted in-game is added automatically, and one finished or failed is removed quietly.
   - **Add by name** (search box), for fixes.
2. **Game data straight from json.tarkov.dev**, including zone outlines, gear restrictions and marker items.
3. **Parts:** a task with different kinds of work is split, and each part can sit in a different category.
4. **Ticks per objective,** done by hand. A ticked objective leaves the map and lowers the items needed.
5. **Default categorize button** that is rule-based and needs no AI.
6. **Readiness:** a bring list with "have" counts. A task you can't do yet gets a "!" and goes semi-transparent, and its zone border becomes dotted.
7. **Pins** and a "Pinned only" filter.
8. **Extracts:** semi-transparent by default; click one to mark it solid.
9. **GPS:** an in-raid screenshot updates your position on the map.
10. **Raid lifecycle:** after each raid, reset "have" counts and delete that raid's GPS screenshots.

Non-goals: multiplayer, the hosted VPS version, and Labs/Terminal maps (no aligned SVG).

---

## 3. Decisions already made by the owner

| Topic | Decision |
|---|---|
| Task source | No TarkovTracker. Scans **replace** the list: tasks not in the scan are forgotten entirely (changed after 2.0.1 by the owner; was add-only). Logs add accepted tasks and **quietly** remove finished or failed ones. |
| Catch-up | None. Logs are read live only, from the end of the file at startup. A new scan covers anything missed. |
| Objective progress | Ticked by hand in the app. The game logs don't record objective completion. |
| Finished parts | A part whose objectives are all ticked **drops off the map**. |
| Splitting | Automatic, with a per-task **"Don't split"** option. |
| Readiness | Something is "possible" if you have **at least 1** of each thing it still needs. Example: 2 markers and 5 marker spots means all 5 show as possible. At 0, the remaining spots get "!" and go semi-transparent. |
| Ticking a placement | Lowers the remaining need by that objective's count **and** lowers the "have" count by the same amount (not below 0). Unticking reverses both. |
| After each raid | "Have" counts reset to 0. That raid's GPS screenshots are deleted. Ticks stay. |
| Scan screenshots | Deleted once the scan's review is confirmed. Not deleted if cancelled. |
| Extracts | Shown semi-transparent. A click toggles "marked" (solid). |
| Log polling | Same as TarkovMonitor: check log file sizes every **5 s** and read only new bytes. Screenshots use a file-system watcher, not polling. |

---

## 4. Game data (milestone 1)

### 4.1 Source
- Fetch from **json.tarkov.dev**. These flat files are what tarkov.dev's site and TarkovTracker use; the GraphQL API at api.tarkov.dev is described as deprecated and unstable.
  - Endpoints: `{mode}/tasks`, `{mode}/tasks_en`, `{mode}/maps`, `{mode}/maps_en`, plus items if needed for names.
  - `mode` is `regular`, `pve` or `pvp-season`, following the game-mode setting (§4.3). `https://json.tarkov.dev/endpoints` lists everything.
  - The base files hold translation keys, and the `_en` files hold the English text.
  - **Fetch them and inspect the real shape before writing types.** The sandbox that wrote this spec couldn't reach the site.
- The GraphQL schema (github.com/the-hideout/tarkov-api, `schema-static.mjs`) documents the fields. These are the ones v2 needs:
  - `TaskZone { position, outline[], top, bottom, map }`: zone polygons, new in v2.
  - `TaskObjectiveMark.markerItem`
  - `TaskObjectiveItem { items[], count, foundInRaid }`
  - `TaskObjectiveQuestItem { questItem, count, possibleLocations }`
  - `TaskObjectiveShoot { targetNames[], count, wearing[[Item]], notWearing[], usingWeapon[], usingWeaponMods[[Item]], timeFromHour, timeUntilHour, zones, bodyParts, distance }`
  - `requiredKeys: [[Item]]` on every objective. **Inner arrays are alternatives**; check this against a task with alternative keys.
  - `MapExtract { name, faction, position, outline[], top, bottom }`, plus `Map.transits`
  - `Map.nameId`, and a scene path. TarkovMonitor matches the log's `scene preset path:maps/<x>.bundle` against a map `scenePath` field from json.tarkov.dev's maps data.
  - `Task.wikiLink`, `factionName`, `minPlayerLevel`, `kappaRequired`, `lightkeeperRequired`
- Confirm the semantics of `wearing: [[Item]]` (alternative outfits vs items worn together) using **The Good Times – Part 1**, which requires an M4A1, 6B43 armor and a Kiver-M helmet.

### 4.2 Caching and offline fallback
- On startup, use the cached copy (`squad-task-map-gamedata-<mode>.json` next to the exe) if it's under 24 h old. Otherwise fetch in the background and swap it in when done.
- If a fetch fails, or returns fewer than 50% of the previous task count, keep the old copy and show a warning in the top bar.
- Keep a bundled snapshot in `assets/` as the last-resort fallback. Replace the current tarkovtaskmap-derived snapshot with one fetched from json.tarkov.dev by a script (`bun scripts/snapshot.ts`).
- `slim()` in `server.ts` turns raw data into what the browser needs. Extend it for the new fields, and keep the browser payload under about 3 MB.

### 4.3 Game mode
- Settings offer **Regular PvP / PvE / PvP Season**.
- When the log watcher sees `Session mode: <mode>` (§9), show "You're playing PvP Season; switch data?" if it differs from the setting. Don't switch silently.
- Log mode values seen in TarkovMonitor: `Regular`/`PVP`, `Pve`/`PVE`, `PvpSeason`/`Seasonal`/`SZN`.

---

## 5. The task list (milestone 1)

### 5.1 Remove TarkovTracker
- Delete the `/api/tt/*` endpoints, token settings, the TarkovTracker modal and sync button, `computeActive()`, and the "source mode" chips (TT / Manual / Both).
- Remove `STM_TT_API`.
- On first start, remove the TarkovTracker token from the settings file.

### 5.2 Active list
- A task is **active** if `S.tasks[id].active === true`.
- How tasks get in and out:
  - **Scan** adds (§8).
  - **Log "started"** adds (§9).
  - **Add by name:** the existing paste and search logic becomes a single "Add task" search box with autocomplete over the data.
  - **Log "finished" or "failed"** removes quietly.
  - **"Remove" button** on a task removes it.
- The **Remove** button sets `active: false`, but **keeps** the task's category choices, sub-tasks, ticks and pin. If the task comes back, it returns as it was.
- A log **finished/failed** event also sets `active: false` and keeps categories and sub-tasks, but clears its ticks and pin (§9).
- Each entry records `source` (`scan` | `log` | `manual`), `addedAt`, and the in-game `%` from the last scan (shown small as "in-game 33%").

### 5.3 Migration from v1 state
- Bump `version` to 2.
- Keep the categories and every task's category choice.
- Tasks with `manual: true` become `active: true`.
- TarkovTracker-derived activity wasn't saved, so those tasks start inactive.
- Show a one-time banner on the map picker: "Scan your task list to load your current tasks."
- Write `squad-task-map-data.v1-backup.json` before migrating.

---

## 6. Parts, ticks and categories (milestone 2)

### 6.1 Action of each objective
| Objective type(s) | Action |
|---|---|
| `visit`, `extract`, `useItem` (e.g. fire a flare), other location-only types | `go` |
| `mark` | `mark` |
| `plantItem` | `plant` |
| `plantQuestItem` | `plant` (stash a quest item you picked up) |
| `findQuestItem`, plus the matching `giveQuestItem` | `retrieve` |
| `shoot`, target a boss | `boss` |
| `shoot`, target PMC/USEC/BEAR | `pmc` |
| `shoot`, target Scav or Any | `scav` |
| `findItem`, `giveItem`, `buildWeapon`, `sellItem`, `skill`, `traderLevel`, `experience`, … | `offmap` (never drawn; listed in the task body) |

For the boss list, use the boss names in json.tarkov.dev's map `bosses` data, or a constant: Reshala, Killa, Tagilla, Glukhar, Sanitar, Shturman, Kollontay, Kaban, Partisan, Zryachiy, Knight, Big Pipe, Birdeye.

### 6.2 Splitting a task into parts
1. Take the objectives that are on the current game data's maps (any map, not just the open one), excluding `offmap`.
2. If the task's description or any objective text contains "(In one raid)", **don't split**.
3. If the task has the per-task `noSplit` flag, **don't split**.
4. Group objectives by action. Glue rules:
   - `giveQuestItem` joins the `retrieve` group of the same quest item.
   - An `extract` ("Survive and extract") joins the group that comes before it in objective order, or the first group.
5. One group means no split. Two or more groups become **parts**, ordered by first objective. A part's key is `taskId:action`.
6. An unsplit task gets one action by precedence: `boss` > `pmc` > `scav` > `plant` > `mark` > `retrieve` > `go`.

### 6.3 Categories
- **Default set**, created by the default-categorize button when missing, with `builtin` keys in this order:
  1. Boss hunts `boss`
  2. PMC kills `pmc`
  3. Scav / any kills `scav`
  4. Mark `mark`
  5. Plant / stash `plant`
  6. Retrieve `retrieve`
  7. Scout & extract `go`
  8. Unsorted `unsorted`
- Give each a distinct color and shape. Existing user categories stay.
- **Assignment** is stored per part: `S.tasks[id].partCats[partKey] = catId`, with `manual: true` when the owner moved it. An unsplit task uses the single key `taskId:*`.
- **Default categorize button** (in the panel header, labeled "Auto-sort"): every part with no manual choice goes to the category whose `builtin` equals its action, or Unsorted if that category was deleted. Manual choices are never touched. Show a toast with the count changed and an **Undo**.
- **AI Categorize** (`ai.ts`): send parts, not whole tasks. Each part's id is its part key, plus its objectives. Update `INSTRUCTIONS` to the new category meanings, and tell the model a part covers only some of the task's objectives. Applying writes `partCats` with `manual: true`.

### 6.4 Ticks
- `S.ticks[objectiveId]` is `true`, or a number for objectives with `count > 1` (shown as a counter, e.g. 1/3).
- Ticking a `mark` or `plantItem` objective also lowers `S.have[itemId]` by the amount ticked, not below 0. Unticking adds it back. For `plantItem` with alternative items, take from the first alternative with have > 0.
- A ticked objective's markers and zones leave the map.
- A part is **done** when all its non-optional objectives are ticked. Done parts leave the map and collapse in the list under "Done parts".
- Ticks survive scans and log events. Clear them when a task is finished per the log.

### 6.5 How parts look
- **List row:** "Capturing Outposts — part 1 of 2" with a split icon. Below it, chips for the other parts in their category colors; clicking one scrolls to it.
- **Category header** counts parts: "PMC kills · 6 (2 partial)".
- **Marker:** a small split badge at the **bottom-right**. The popup shows the whole task, with this part's objectives highlighted.
- **Task body:** a "Don't split" checkbox. Turning it on merges the parts into one, placed by precedence unless the owner moves it.

---

## 7. Readiness, bring list and map styling (milestone 3)

### 7.1 Requirements per remaining (unticked) objective
| Kind | From | "Possible" when |
|---|---|---|
| Key | `requiredKeys` (each inner list = alternatives) | have ≥ 1 of any alternative |
| Placed item | `mark.markerItem` (need 1), `plantItem.items` (alternatives) × `count` | have ≥ 1 of any alternative |
| Gear | `shoot.wearing`, `usingWeapon`, `usingWeaponMods` | have ≥ 1 of each required piece (per the semantics confirmed in §4.1) |
| Found-in-raid | `findItem`/`giveItem` | **Info only**: never affects readiness |

- An objective, part or unsplit task is **ready** when every requirement of its remaining objectives is possible.
- Readiness is computed **per objective** for markers and zones, and per part for list rows.

### 7.2 Bring list
- A second tab in the right panel: **Tasks | Bring list**.
- **Scope:** exactly what's visible. That means the open map, visible categories, the Pinned-only filter, active tasks, and unticked objectives.
- **Sections:**
  - **Keys:** one line per key, need 1. Alternatives are shown as "A or B".
  - **Items to place:** summed remaining need across objectives. Expanding a line shows the breakdown, e.g. "A Fuel Matter 2, Anesthesia 3".
  - **Gear to wear / use**
  - **Find in raid (info):** from the visible tasks **plus all active off-map tasks** (e.g. Booze), since those items can be found on any map.
- **Each line:** item name, tarkov.dev icon (`https://assets.tarkov.dev/<itemId>-icon.webp`; check it loads offline-gracefully), need, and a **have** number with − / + buttons and typing allowed. Lines where have = 0 and need > 0 are highlighted.
- `S.have[itemId]` is shared across maps. It resets to 0 at raid end (§10). Also add a "Reset all" button.

### 7.3 Map styling rules
- **Fully opaque by default.** Only two things are ever semi-transparent: **not-ready** markers and zones, and **unmarked extracts** (§11). Use about 50% opacity, tuned by eye.
- **Not-ready marker:** semi-transparent, plus a **"!" badge at the top-left**.
- **Badge positions:**
  - top-left: "!"
  - top-right: floor number or "B"
  - bottom-right: split
  - bottom-left: reserved
- **Zones:** draw each `TaskZone.outline` as a polygon, projected with `makeProj()`, in the category color with a light fill. Ready zones get a solid border; not-ready zones get a **dotted** border (`stroke-dasharray`). Keep the center marker. Zones without an outline keep just the marker.
- **Floor for zones:** use `top`/`bottom` with the layer extents in `maps-config.json` when present. Otherwise use the position's y, as `floorBadge()` does now.

---

## 8. Screenshot task scan (milestone 6)

- **Requires** an OpenAI key (the existing settings modal). Without one, the Scan button opens that modal.
- **Screenshots folder:** `Documents\Escape From Tarkov\Screenshots`.
  - Resolve Documents through Windows' known folder, **not** `%USERPROFILE%\Documents`, because OneDrive often redirects it. From Bun, run `powershell -NoProfile -Command [Environment]::GetFolderPath('MyDocuments')` once and cache the result.
  - A setting lets the owner override the path.
- **Flow:**
  1. **Scan tasks** (map picker and panel) starts capture mode. A banner reads "Capturing: open your task list in-game and press your screenshot key on each page. 0 captured · Done · Cancel".
  2. Watch the folder with `fs.watch`. Accept image files created after capture started whose names **don't** match the GPS pattern (§10). Show live thumbnails, with a remove-(×) button on each.
  3. **Done:** read each image, resize so the long edge is 2048 px or less (lossless PNG or high-quality JPEG), and send it to the configured OpenAI model with an `input_image`. Use a strict JSON schema: `[{ name, trader|null, progress|null }]`. Run 3 images at a time, with progress shown.
     - Prompt: "Read every task row visible in this Escape from Tarkov task list screenshot…". Keep it simple, with no game knowledge needed.
     - Reuse the reasoning setting, defaulting to low for this job.
  4. **Match** names to the data using the existing `norm()` plus Levenshtein ratio of 0.82 or more. Use the trader to break ties between same-name tasks. De-duplicate across images, keeping the highest progress.
  5. **Review screen:**
     - New tasks, with how many land on each map
     - Already active (unchanged)
     - Not matched, each with a search box to fix by hand
     - Off-map tasks (no map objectives) listed separately. They're still added: they never appear on a map, but their found-in-raid items show in the bring list (§7.2).
  6. **Confirm:** add new tasks, auto-sort the new parts (§6.3), and **delete the scanned screenshot files**. Every active task not in the scan (matched, or fixed by hand in the review) is removed as if never added: its entry, ticks, used counts and sub-tasks are deleted, with no list shown first. Removal is skipped when any screenshot failed to read or no task was recognised. **Cancel** deletes nothing.
- **Tabs:** the in-game list has STORY / SIDE / OPERATIONAL. Story chapters likely don't exist in tarkov.dev's task data; they'll fall into "Not matched", which is fine.
- **Cost:** about 1–2k input tokens per image. Show an estimate before sending if the model is unknown.

---

## 9. Game log watcher (milestone 5)

TarkovMonitor (github.com/tarkovtracker-org/TarkovMonitor) is the reference.

> **It's GPL-3.0. Read it to understand formats and behavior. Don't copy its code into this project.**

- **Find the logs folder,** in this order:
  1. The setting, if set
  2. The registry uninstall entry for EFT (`InstallLocation`)
  3. Steam: `libraryfolders.vdf`, then `appmanifest_<EFT app id>.acf`
  4. Ask the owner to pick it

  Logs live in `<install>\Logs` or `<install>\build\Logs`, with one sub-folder per game session. Watch for new session folders and switch to the newest.
- **Files to read:** in the current session folder, the file whose name contains `notifications` and the one containing `application`. Rotated copies use a `_000` suffix.
- **Polling:** every 5 s, compare file size with the saved offset and read only the new bytes. At startup and on a new session folder, start **at the end of existing files** (no catch-up). Handle a file shrinking (reset to 0) and partial last lines (keep the remainder for the next read).
- **Entry format** (verify against real files on this PC):
  - A line starting `YYYY-MM-DD HH:MM:SS.mmm[ ±HH:MM]|…message…`
  - Optionally followed by a JSON block: lines from one starting with `{` to one starting with `}`
- **Task events:**
  - Find message lines containing `Got notification | ChatMessageReceived`.
  - In the JSON, `message.type`: **10 = started, 11 = failed, 12 = finished**.
  - Task id = `message.templateId.split(" ")[0]`, which is the same id as tarkov.dev.
  - Ignore ids not in the task data (dailies and weeklies).
  - **Started:** add the task as active (source `log`) and auto-sort its parts.
  - **Finished or failed:** set it inactive quietly, clear its ticks and unpin it. Categories and sub-tasks are kept.
- **Session mode:** application lines containing `Session mode: <mode>`. Only apply task events while the session mode matches the game-mode setting (§4.3).
- **Raid lifecycle** (application log), used by §10:
  - Raid start: `application|GameStarting` / `application|GameStarted`
  - Map: `application|scene preset path:maps/<name>.bundle`
  - Raid end: TarkovMonitor treats a profile-select line (`SelectProfile`/`SelectedProfile`/`PrepareSelectedProfileLocally ProfileId:`) after a raid started as the end. Matching cancelled or aborted is **not** a raid.
  - Confirm these lines in the owner's real `application` log before relying on them.
- **Testing without the game:** add `bun test` cases that write synthetic log files (same line format) into a temp folder and check events fire once each, including split writes and file rotation.

---

## 10. GPS from screenshots, and raid end (milestone 7)

- **Where the position comes from:** during a raid, the game writes your position and rotation into the screenshot **file name**. The app reads the name, never the image. Pattern, as matched by TarkovMonitor:
  `YYYY-MM-DD[HH-MM]_<x>, <y>, <z>_<qx>, <qy>, <qz>, <qw> (<n>).png`
  The coordinates have two decimals, can be negative, and are game coordinates. These go straight into `makeProj().toSvg(x, z)`, with `y` used for the floor.
- **Facing direction:** derive the yaw from the quaternion. Watch out: TarkovMonitor passes the components in a swapped order (`x, z, y, w`). Verify by having the owner take two screenshots facing known directions (e.g. down a straight road) and checking the arrow.
- **Which map:** the map from the log's scene path (§9). Fallback: the map currently open in the app.
- **On a new GPS screenshot:**
  - Switch to that map (setting: "Follow my position", default on).
  - Draw a **player arrow** (distinct color, white outline, floor badge) and center on it if it's off-screen.
  - Keep a fading trail of the last 5 positions, labeled "2 min ago".
  - The trail is cleared when a new raid starts.
- **Keybind check:** warn if no screenshot key is bound in-game. See how TarkovMonitor reads EFT's control settings to check this.
- **At raid end:**
  1. Reset every `S.have` to 0.
  2. Delete the GPS screenshots **created during that raid**: names matching the GPS pattern with a file time between raid start and end. Never delete anything else.
  3. Show a toast: "Raid over: bag counts reset, 7 screenshots deleted."

---

## 11. Pins and extracts (milestone 4)

**Pins**
- A pin icon on each task row and in the marker popup. Pins are per task (all its parts) and stored in `S.tasks[id].pinned`.
- **Pinned only** toggle in the panel header and as a map button. When on, the list, markers, zones and the bring list show only pinned tasks; category show/hide still applies on top.
- **Clear pins** button. Finished tasks unpin automatically (§9).

**Extracts**
- The existing PMC / Scav / Shared / Transit chips still decide which kinds are shown.
- Shown extracts are **semi-transparent** (marker and label). Clicking one toggles **marked**: fully opaque, bold label and a thicker outline. Stored per map in `prefs[map].extMarked[extractName]`.
- If tarkov.dev's data has an extract `outline`, draw it the same way: dashed when unmarked, solid when marked.
- **Clear marked** link in the Extracts section.

---

## 12. Saved state (v2)

```jsonc
{
  "version": 2,
  "cats": [{ "id", "name", "color", "icon", "visible", "builtin": "boss|pmc|scav|mark|plant|retrieve|go|unsorted|null" }],
  "tasks": { "<taskId>": {
      "active": true, "source": "scan|log|manual", "addedAt": 0, "gamePct": 33, "scannedAt": 0,
      "noSplit": false, "pinned": false,
      "partCats": { "<taskId:action>": { "cat": "<catId>", "manual": false } } } },
  "ticks": { "<objectiveId>": true },                 // or a number for counted objectives
  "have":  { "<itemId>": 2 },
  "subs": [/* unchanged from v1 */], "draw": {/* unchanged */},
  "prefs": { "<mapKey>": { "ext": {...}, "extMarked": { "<extractName>": true }, "labels": true, "drawOn": true } },
  "pinnedOnly": false, "panelTab": "tasks|bring", "collapsed": {}, "dcolor": "#ff4d4d", "dwidth": 4
}
```

**Settings file:** OpenAI key, model and effort (unchanged); `gameMode`; `logsPath`; `screenshotsPath`; `followPosition`. Remove the `tt*` fields.

---

## 13. Code organisation (milestone 0)

`web/index.html` is a 665-line single file with dense code, and v2 roughly doubles the feature set. Before adding features:

- Split the front end into ES modules under `web/js/`: `state`, `data`, `projection`, `map`, `markers`, `panel`, `categories`, `parts`, `readiness`, `bring`, `drawing`, `ai`, `scan`, `gps`, `ui`.
- Keep the single-exe build working. Either embed each module with `import … with { type: "text" }` the way `index.html` is embedded today, or use Bun's HTML bundling if it compiles cleanly to the Windows exe. Pick one and note why in `README.md`.
- Pure logic goes in modules with **no DOM access**, so `bun test` can cover it: projection, name matching, objective actions, splitting, readiness, bring-list sums, log parsing, GPS filename parsing.
- Server side: split `server.ts` into `server/` modules (`routes`, `gamedata`, `logs`, `screenshots`, `settings`), keeping `ai.ts`.
- **No behavior change in milestone 0.** Every v1 feature must work the same.

---

## 14. Milestones and acceptance checks

**M0 · Refactor + test harness**
✅ `bun test` passes, with at least projection, name matching and drawing simplification covered. The exe builds and every v1 feature works as before. Ask the owner to spot-check.

**M1 · json.tarkov.dev data, game mode, TarkovTracker removed, migration**
✅ Data loads live and from cache. Unplugging the network falls back to the cache, then the bundled snapshot. The v1 data file migrates with categories intact and a v1 backup written. No TarkovTracker UI or code remains. Add-task search works.

**M2 · Parts, ticks, Don't split, Auto-sort, AI on parts**
✅ Unit tests: Capturing Outposts stays whole (one action). Secrets of Polikhim stays whole ("In one raid"). A visit+kill task splits into two parts. `giveQuestItem` joins its pick-up.
✅ Ticking one of A Fuel Matter's two marker objectives removes that marker from the map. Ticking both removes the part.
✅ Auto-sort never changes a manually moved part, and Undo restores the previous state.

**M3 · Readiness, bring list, zones**
✅ With markers have = 2 and 5 marker spots visible, all 5 are opaque. Set have = 0: all 5 show "!" and are semi-transparent, and their zones are dotted. Tick one spot with have = 1: have becomes 0 and need becomes 4.
✅ The bring list follows map, category, pinned and tick filters exactly.

**M4 · Pins, extracts**
✅ Pinned only hides unpinned tasks everywhere, including the bring list. Extracts start semi-transparent, a click makes one solid, and that survives a restart.

**M5 · Log watcher**
✅ Unit tests on synthetic logs pass.
✅ Owner test: accept a task in-game and it appears within about 5 s. Finish one and it disappears quietly. A PvE session doesn't touch the Season list.
✅ CPU stays near 0% in Task Manager while idle.

**M6 · Screenshot scan**
✅ Owner test: capture 3+ in-game task pages. The review lists the tasks correctly. Confirm adds new ones, removes tasks not in the scan, and deletes those screenshot files. Cancel deletes nothing.

**M7 · GPS + raid end**
✅ Owner test: in a raid, press the screenshot key. The app switches to the right map, and the arrow is where they are, facing the right way.
✅ At raid end, "have" counts are 0 and only that raid's GPS screenshots are gone.

**M8 · Polish + package**
✅ README updated (setup, folders, privacy, costs). The exe builds and is zipped. If the zip exceeds 30 MB, also produce a `.7z`.

---

## 15. Open questions (use the default, flag it in your milestone report)

1. **Mark vs Plant:** separate categories (default) or one combined "Mark / place"?
2. **Auto-sort scope:** default is only parts with no manual choice. Should there also be a "Re-sort everything" option behind a confirmation?
3. **Marked extracts:** default is to keep them until cleared. Should they reset after each raid like the bag counts?
4. **Follow my position:** default on. OK?

---

## 16. Licences and credits
- **Map SVGs:** Shebuka and contributors, the-hideout/tarkov-dev-svg-maps, **CC BY-NC-SA 4.0**. Non-commercial only.
- **tarkov.dev code** (projection, palette, Bender font): the-hideout/tarkov-dev, MIT.
- **Game data:** tarkov.dev (community).
- **TarkovMonitor:** GPL-3.0. Reference only, no copied code.
- Not affiliated with Battlestate Games. The app only reads files the game writes (logs, screenshots). It never touches game memory or game files.
