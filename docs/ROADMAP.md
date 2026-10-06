# Roadmap: v2.1 → v3

Twelve tickets, in the order to build them. Each ticket file has its goal, scope, acceptance checks, in-game checks for the owner, and open questions with a proposed default. Ask the owner about any open question before building that part.

| # | Ticket | Size | Touches | Depends on |
|---|---|---|---|---|
| 01 | Find me on the map: stand-out player marker + radar | S | page | none |
| 02 | Auto-center on me, keep zoom | S | page + one setting | 01 |
| 03 | Closest extract | S | page | 01 |
| 04 | Go backend: port the server to Go, written readable from the start; serve the JS unbundled | L | server | 01–03 merged |
| 04b | Reorganise the page for readability (no behaviour change) | M | page | 04 |
| 04c | Check for updates from a Google Drive folder (manual button) | M | server + page + release tool | 04, 04b |
| 05 | Squad multiplayer over Tailscale (tsnet) | L | server + page | 04, 04b |
| 06 | Read my extracts from the first raid screenshot (AI) | M | server + page | 04, 04b (and 03 to be useful) |
| 07 | Item icons as task markers | S–M | page + server icon cache | 04, 04b |
| 08 | Loot spots layer: high-value containers, documents, loose keys | M–L | data + page | 04, 04b |
| 09 | My keys per map, and the rooms they unlock | M | page + saved state (+ sharing) | 04b, 08, 07 (05 for sharing) |
| 10 | Looting routes | M | page (+ sharing) | 04b, 08, 09, 05 |

S = a day or two of focused work for Claude Code, M = a few days, L = a week or more. These are rough, for ordering only.

## Why this order

1. **01–03 first: the in-raid quick wins.** They're the squad's current pain point (finding yourself on the map) and they're small. They're almost entirely page-side code, and the page doesn't change in the Go port, so none of this work is redone later. Testing them in raids also covers the v2 checks that are still open (GPS arrow position and direction, raid start/end), so the Go port starts from a version proven in-game.
2. **The rewrite: 04, then 04b, before anything else.**
   - Every later ticket needs server work: tsnet, reading screenshots, icon caching, loot data. Doing the port first means none of that is written twice (in TypeScript and then in Go).
   - The owner wants to read and understand each feature's logic, so the rewrite is also when the code gets organised for readability (see `docs/CODE-STYLE.md`). The Go backend (04) is written that way from the start; the page is reorganised in 04b.
   - **Why two tickets:** they're kept apart so each is checkable on its own. 04 swaps the backend under an unchanged page (a 1:1 copy of behaviour, compared against the current app). 04b reorganises the page on top of a proven backend (no behaviour change, checked with browser smoke tests).
   - Every ticket after that lands in the readable, feature-by-feature layout.
3. **04c (Check for updates) right after the rewrite.**
   - Every later ticket ships a new exe to the squad. With this in place, a release is "upload to Drive, click Check for updates" instead of passing zips around.
   - It's manual by design: nothing is checked or installed until someone clicks the button.
4. **05 next.** tsnet is the main reason for Go, and multiplayer is the squad's biggest ask. Doing it before 06–10 also means each later feature (extract marks, key lists, routes) can be designed as shareable from day one instead of being added to sharing afterwards.
5. **06 and 07: small server-backed improvements** on top of the new backend. 06 makes 03 automatic.
6. **08, then 09, then 10.**
   - 08 builds the data pipeline for loot, including the locked doors (`locks`).
   - 09 (My keys) uses those doors, the loot near them and ticket 07's icons.
   - 10 (Routes) can then snap to loot spots and to your doors. Key lists and routes both ship shareable because 05 exists.

If the owner would rather not touch the Bun version at all, do 04, 04b and 04c first and then 01–03. Nothing else changes.

## Rules for every ticket
- One ticket per branch/PR. Bump the version, update `README.md` for anything user-visible, and keep `HANDOFF.md` current.
- **Readability first: follow `docs/CODE-STYLE.md`.**
  - Each feature gets its own folder on both sides, with a README, and `docs/FEATURES.md` is updated.
  - Tickets 01–03 come before the rewrite. Even so, write their new code in that style and in its own `web/js/features/<name>/` folder where practical; 04b moves the rest.
- **Light while Tarkov runs:**
  - no polling in the page;
  - no new fast timers on the server;
  - continuous animations only as HTML overlays animated with `transform`/`opacity` (see the `#fx` selection flash in `web/js/map.js`); never animate inside the map SVG.
  - Measure idle CPU before and after any ticket that adds work while idle.
- **Saved-data changes:** new fields get defaults in `freshState()`; old files must keep loading.
- **Privacy:** anything new that leaves the PC (images to OpenAI, data to squadmates) is listed in the README's "Privacy and cost" section.
- Report after each ticket: what changed, how it was verified, and what the owner needs to check in-game.


---

# 01 · Find me on the map

**Size:** S · **Touches:** page (`web/js/map.js`, `web/index.html`) · **Depends on:** none

## Problem
Squadmates find it hard to spot their own position. Today it's a 12 px green disc with a white arrow (`renderGps()`). It's close to the "Scout & extract" category green and it gets lost among task markers.

## Goal
Your position is the first thing your eye lands on, at any zoom, on any part of any map. The app also helps you find it when it's off-screen.

## Scope
1. **A marker that stands out**
   - Bigger (about 1.5× today's), with a heavy outline (white with an outer black edge, like the selection rings) so it reads on light roads and dark buildings.
   - **A colour no category or extract kind uses.** Category colours today: red, orange, lime, yellow, cyan, pink, green, beige. Extracts: green, blue, amber, purple. Selection rings are white. Show the owner 2–3 colour options as screenshots before settling.
   - The heading arrow stays, rotated with `arrowRotation()` as now. The floor badge stays.
   - A small "You" label next to it.
   - Drawn above everything else on the map, including task markers and extracts.
2. **Radar effect**
   - Rings expand from your position and fade, like a radar ping.
   - It runs continuously while the fix is recent; proposed default: the last 10 minutes. After that it switches to a slow, subtle pulse so the marker reads as stale.
   - Each new screenshot fires a stronger burst of 2–3 fast rings, so you notice the update.
   - **Implementation rule:** HTML elements over the map, animated only with CSS `transform` and `opacity`, positioned in `apply()` the way `renderFx()`/`placeFx()` place the selection rings. Never animate inside the SVG. Respect `prefers-reduced-motion` (static ring, no animation).
3. **Off-screen pointer**
   - When your position is outside the visible part of the map, show a small chip on the map edge pointing toward you, with the distance from the map's centre (e.g. "You · 240 m").
   - Clicking it centres on you without changing the zoom.
4. **"Find me" button**
   - In the map toolbar (📍). It centres on your position, keeping the zoom, and fires the burst.
   - It's disabled, with a tooltip, when there's no position yet.
   - The `#gpsbar` "Show" button does the same.
5. **The trail:** keep it (last 5 positions, "x min ago"), but make the dots smaller and fainter so they don't compete with the marker.

## Out of scope
Changing how the position is obtained (GPS file names) and auto-centring (ticket 02).

## Acceptance checks
- At full-map zoom on Streets and Customs, with all categories shown, the marker is the most prominent thing on screen. Check screenshots with the owner.
- A performance trace while idle with a recent fix: 0 main-thread Paint/Layout per second from the radar. Same method as the selection flash, which was verified with a Chrome trace.
- The off-screen chip appears and disappears correctly while panning; clicking it centres on you at the same zoom.
- Works on mobile width (the map sits above the list).
- Selection flash and radar together are still easy to tell apart.

## Owner checks in-game
- In a raid, take a screenshot: the marker is easy to find at a glance, from the map at its normal size, on a second monitor or half-screen.

## Open questions (proposed default in brackets)
- Stale after how long? [10 minutes, then a slow pulse]
- Show the "You" label always, or only when zoomed in? [always]


---

# 02 · Auto-center on me, keeping the zoom

**Size:** S · **Touches:** page, plus one setting passed through the server · **Depends on:** 01 (shares the "centre on me" helper)

## Goal
An option to keep the map centred on you: every time a GPS screenshot comes in, the map pans so you're in the middle, **at whatever zoom you had**.

## Today
- "Follow my position" (`settings.followPosition`, on by default) switches to the raid's map.
- It also calls `centerOn(gps, true)`, which only moves the view if you're off-screen, and **changes the zoom** (`w = min(vb.w, home.w / 2.5)`).

## Scope
1. **New setting:** "Center the map on me when I take a screenshot (keeps your zoom)".
   - Stored next to `followPosition` in `squad-task-map-settings.json` as `autoCenter`.
   - The server passes it through `/api/settings` and `/api/status` like `followPosition`. The Go port (ticket 04) must include it.
   - Default: off. See the open question.
2. **Map toolbar toggle:** "📍 Follow" with `aria-pressed`, mirrored with the setting. Changing either changes both.
3. **Behaviour on a new GPS fix:**
   - **On:** pan so the fix is centred. Never change the zoom.
   - **Off:** keep today's "only if off-screen" behaviour, but never change the zoom there either (see the open question).
   - Switching maps still follows `followPosition`. On a map switch, centre on the fix at the map's default zoom.
4. **Don't fight the user:** if they're mid-drag or mid-pinch when a fix arrives, wait until they let go, then centre.
5. Re-use the helper from ticket 01 ("centre on, keep zoom"). Retire the zoom-changing branch of `centerOn()` if the owner agrees.

## Acceptance checks
- With it on: zoom in, take three GPS screenshots at different spots (the synthetic file names in `HANDOFF.md` §9 work), and each one centres at the same zoom.
- With it off: an on-screen fix doesn't move the map; an off-screen fix brings it into view without a zoom change.
- The toolbar toggle and Settings stay in sync after a reload.

## Owner checks in-game
- Play a raid with it on; the map should feel like a minimap that follows you.

## Open questions (proposed default in brackets)
- Default on or off? [off, since it moves the map under you; easy to turn on]
- When off, should off-screen fixes still bring you into view? [yes, as today, but without zooming]


---

# 03 · Closest extract

**Size:** S · **Touches:** page (`web/js/map.js`) · **Depends on:** 01. It works with manual extract marks; ticket 06 makes the marks automatic.

## Goal
Whenever a GPS screenshot comes in, highlight the extract closest to you **among the ones you have**, so you know where to head.

## Which extracts count ("the ones you have")
1. Extracts marked for this raid (`prefs[map].extMarked`): marked by hand today, or automatically by ticket 06.
2. If none are marked yet, fall back to the extract kinds currently shown by the chips (PMC / Scav / Shared), and label the result "closest shown". Transits are excluded unless the Transit chip is the only one on.

## Scope
1. **Distance:** straight-line distance on the map (x, z) from the fix to each counted extract. Game units are metres. Ignore height; label it as straight-line ("~180 m").
2. **Highlight on the map:**
   - A ring on the closest extract, in the player colour from ticket 01, so it reads as "your exit".
   - A dashed line from you to it, with the distance label at the midpoint.
   - The line and ring are drawn once per fix; nothing animates inside the SVG. If you want motion, use the HTML overlay approach from ticket 01.
3. **In `#gpsbar`:** "Closest: Crash Site · ~180 m". Clicking it centres on that extract, keeping the zoom.
4. **Updates:** recalculated on each new fix, on marking or unmarking an extract, and on a chip change. Cleared at raid end along with the fix.
5. Optional, behind an open question: list the two runner-ups in the gpsbar tooltip.

## Out of scope
Walking paths and route-finding: there's no navmesh, so it's straight-line only. Extract requirements (paid, power switch, etc.) can be shown when 06 provides them.

## Acceptance checks
- Synthetic GPS file names at three known positions on Customs pick the expected closest extract; check the distances by hand from `/api/data` coordinates.
- Marking and unmarking extracts changes the result immediately.
- No position → nothing shown. Raid end → cleared.

## Owner checks in-game
- After a screenshot, the highlighted extract is the one you'd actually head to (within reason for straight-line distance).

## Open questions (proposed default in brackets)
- Include transits when nothing is marked? [no]
- Show runner-ups? [only in the gpsbar tooltip]


---

# 04 · Go backend

**Size:** L · **Touches:** everything in `server/`, the build, tests · **Depends on:** 01–03 merged (port the latest server)

## Goal
Replace the Bun/TypeScript server with Go and still ship **one Windows exe**. Behaviour stays the same:
- same HTTP routes and JSON shapes;
- same SSE events;
- same data files next to the exe.

That way the page needs no changes beyond how its scripts load, and the owner's saved data keeps working. The owner knows Go and wants to be able to work on the backend.

**The page stays JavaScript and is served as-is:** ES modules from `web/js/`, no bundler.

## Why
- tsnet (ticket 05) is a Go library.
- A much smaller exe: today's is about 120 MB, of which about 115 MB is the Bun runtime.
- A steadier idle footprint.
- Native Windows APIs replace shelling out to `reg query` and PowerShell.

## Step 0: capture the truth before porting
Do this with the current Bun app, so the Go version has something exact to match:
1. **Golden outputs.** Save each of these to `testdata/golden/`:
   - `/api/data` for the bundled snapshot;
   - `/api/data` for the mock json.tarkov.dev docs;
   - the events from the sample logs in `tests/watchers.test.ts`;
   - the parsed GPS file names.
2. **Real json.tarkov.dev files** (`regular/tasks`, `tasks_en`, `maps`, `maps_en`, `traders`, `traders_en`, `items_en`). Fetch them now; the original build couldn't reach the site. Compare them with what `server/convert.ts` `fromRaw()` assumes, and fix the converter (in TS first) if they differ. Save trimmed copies as fixtures.
3. **Real game logs and screenshot names** from the owner's PC: one session folder, plus a few screenshot names. **Ask before reading folders outside the project.** Fix any parsing differences in TS first, so the Go port inherits correct behaviour.

## Layout and code style
**Write the Go code readable from the start, following `docs/CODE-STYLE.md`.** The owner knows Go and wants to read each feature's logic. Readable beats concise.
- Use the backend layout in CODE-STYLE §1:
  - `internal/app` is the one place that wires features together;
  - `internal/features/<name>/` holds each feature (`gamelog`, `raid`, `gps`, `taskscan`, `aicategorize`);
  - shared infrastructure is `httpapi`, `events`, `storage`, `gamedata`, `gamefolders`, `screenshots`, `openai`;
  - `cmd/mock` holds the offline stand-ins and `testdata/` the fixtures.
- **Rules in `rules.go`, I/O elsewhere.** For example, the log *parser* is pure functions over text; the log *watcher* does the file reading and calls the parser.
- **Event names** as constants in `internal/events/names.go`, spelled exactly as the page uses them today.
- **Every goroutine documented** (who starts it, what it waits on, how it stops). Errors wrapped with context.
- **A `README.md` per backend feature package** (CODE-STYLE §9 template). Start `docs/FEATURES.md` with the backend columns filled in; 04b completes the page columns.
- Table-driven tests whose case names read like the rules.

The page itself is reorganised in **ticket 04b**, straight after this one. In 04 the page changes only in how its scripts load (below).

## Porting notes (the non-obvious parts)
- **State is opaque.** The page owns the saved data; the server stores the text. Don't model it in Go. Keep the atomic write (temp file + `os.Rename`) and the `.bak`.
- **SSE:** use `http.Flusher`. Don't set a server-wide `WriteTimeout` (it kills long-lived streams); use `http.ResponseController` per handler if needed. Keep the two delivery kinds exactly:
  - `deliver`: queued in `squad-task-map-pending.json` until acked;
  - `broadcast`: live-only.
- **MIME types:** Go's `mime.TypeByExtension` reads the Windows registry, and some PCs map `.js` to `text/plain`. Browsers then refuse to run module scripts. **Set Content-Type explicitly** for `.js`, `.css`, `.svg`, `.json` and `.woff2`.
- **Caching:** files come from memory. Send `ETag` = version; use `no-cache` in dev.
- **Unbundled page:** change `<script type="module" src="/app.js">` to `/js/main.js`. Remove the Bun bundle step and `web/dist/`. All imports are already relative with `.js` extensions.
- **Log watcher:**
  - `time.Ticker` at 5 s; `os.Stat`, then `ReadAt` of the new bytes only (max 4 MB per read).
  - Keep an incomplete trailing entry, and an incomplete UTF-8 sequence, for the next read.
  - Folder rescan every 6th tick. Start at the end of existing files; read a new session folder from its start.
- **Screenshots:** `fsnotify` (ReadDirectoryChangesW on Windows), 400 ms debounce per file, and wait until the size is stable before reading a file.
  - Only delete names in the capture list (scan confirm) or GPS shots seen being created this raid. Port the tests that prove it.
- **Windows paths:**
  - `golang.org/x/sys/windows`: `KnownFolderPath(FOLDERID_Documents)` (OneDrive-safe) instead of PowerShell.
  - The `registry` package for the EFT uninstall key and Steam paths.
  - The Steam `libraryfolders.vdf` → `appmanifest_3932890.acf` logic as today.
- **OpenAI:** plain `net/http` + JSON is enough; keep the same instructions and strict schemas from `server/ai.ts`. Keep the API key server-side; it's only sent to api.openai.com.
- **Ports and binding:** 127.0.0.1 only, 7777 → 7800 fallback, as now.
- **Open the browser:** `rundll32 url.dll,FileProtocolHandler <url>` (or `cmd /c start "" <url>`). Respect `STM_NO_BROWSER`.
- **Environment variables:** keep every `STM_*` and `PORT` variable from `HANDOFF.md` §3 so the test setup carries over.
- **Build:** `GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o dist/SquadTaskMap.exe .`, as a console app like today.

## Tests
- Go tests for:
  - log parsing and the watcher, including split writes, a new session folder and no catch-up;
  - screenshots, including the safe-deletion rules;
  - GPS names;
  - conversion: **JSON-equal to the goldens from step 0**;
  - the store (atomic write, `.bak`, pending queue).
- **The page's logic tests** (`web/js/logic`: projection, parts, readiness, migration, matching) stay JavaScript. Move them out of `tests/core.test.ts` into plain JS test files run by `node --test`, which needs no packages (see the open question).
- `cmd/mock` replaces `tests/mock-server.ts` with the same endpoints and behaviour.

## Parity check before deleting the TypeScript server
Run old and new side by side against `cmd/mock`, with the same scratch folders:
- `/api/data`: JSON-equal.
- `/api/status`: same shape.
- The state file round-trips unchanged; v1 migration still produces the same result from `tests/fixtures/v1-data.json`.
- The same synthetic log lines and GPS file names produce the same events, in the same order.
- Scan flow: capture, read, confirm-deletes and cancel-keeps behave the same.
- The browser checks from v2 still pass: tasks added and removed from logs, raid end resets, mode switch, settings and scan.

Then delete `server/*.ts`, the TS tests and the Bun scripts. Update `README.md` ("Building from source"), `HANDOFF.md` and `CLAUDE.md`.

## Acceptance checks
- `go test ./...` and the JS logic tests pass. The parity check passes.
- The code follows `docs/CODE-STYLE.md`. Every backend feature package has a README, and `docs/FEATURES.md` exists. The owner reads `internal/app` plus two feature packages (suggested: `gamelog` and `raid`) and confirms they're easy to follow.
- The exe runs on Windows from a fresh folder and from a folder with existing v2 data.
- Windows Defender doesn't flag the exe (Go binaries sometimes get false positives; check before handing it out).
- Idle cost measured with the page open for 2 minutes, compared against Bun's ~0.2% of one core and ~95 MB: CPU no worse, memory lower.
- Exe size reported. My rough expectation is under 20 MB without tsnet.

## Owner checks
- Replace the exe in your usual folder: your tasks, drawings and settings are all still there.
- One raid: tasks from logs, GPS, raid end and the scan all behave as before.

## Open questions (proposed default in brackets)
- JS logic tests: `node --test` (needs Node installed) or keep Bun as a dev-only tool? [`node --test`]
- Add a single-instance guard now? A second launch would just open the browser to the running app and exit. [yes; multiplayer makes two instances messier]
- Exe icon and version info (shows in Explorer and Task Manager)? [yes, small]
- Code-signing to avoid SmartScreen and antivirus warnings? [not now; it costs money]


---

# 04b · Reorganise the page for readability (no behaviour change)

**Size:** M · **Touches:** everything in `web/` · **Depends on:** 04 (done and verified first, so each change is checked on its own) · **Part of the Go rewrite**

## Goal
Rewrite the page's JavaScript and CSS following `docs/CODE-STYLE.md`, so the owner can open a feature's folder and understand its logic:
- organised by feature;
- rules separate from drawing code;
- full names, small named functions;
- JSDoc types; a README per feature.

**The app must behave exactly the same.** Same screens, same saved data, same API calls.

## Why now
The Go rewrite (04) gives the backend this structure from the start. Doing the page straight after means every later ticket (05–10) lands in the readable layout, and the owner learns the codebase once. Doing it *after* 04, not at the same time, keeps the two big changes checkable separately: 04 swaps the backend under an unchanged page; 04b changes the page on top of a proven backend.

## Scope
1. **Move to the feature layout** in CODE-STYLE §1:
   - `app/`, `map/`, `panel/` and `features/<name>/` with `rules.js`, `panel.js`, `map-layer.js`, `<name>.css`, `README.md`.
   - Code added by tickets 01–03 moves into `features/find-me/` and `features/extracts/` if it isn't there already.
2. **Rename and split** following CODE-STYLE §2–5:
   - full-word names (no `S`, `M`, `t`, `o`, `mk`, `$`);
   - small render functions instead of giant template strings;
   - named handlers per feature instead of the panel's one big `switch`;
   - named constants for every game or design number (e.g., the 0.82 name-match threshold, the 500 ms save debounce, the 7 px tap-vs-drag tolerance, the 2048 px scan image size).
3. **Make the order explicit:** map layers in `map/layers.js` and panel sections in `panel/panel.js`.
4. **Types:**
   - `// @ts-check` in every file;
   - `jsconfig.json` with `checkJs: true`;
   - JSDoc `@typedef`s for Task, Objective, Part, SavedState, Category, Settings and each event payload in `app/types.js`;
   - fix what the checker finds without changing behaviour.
5. **Event names** in `app/event-names.js`, matching Go's `internal/events/names.go`, plus the Go test that compares them.
6. **CSS:**
   - `web/css/base.css` holds colours as named variables, e.g. `--selection-ring`, `--player`, `--category-boss`.
   - Each feature has its own CSS file.
   - `index.html` links them in a fixed order.
7. **Tests:**
   - The page's logic tests (projection, parts, readiness, migration, matching, simplify) move next to their rules as `*.test.js`, run with `node --test`.
   - Test names are rewritten as sentences.
8. **Docs:**
   - `docs/FEATURES.md` (the start-here table) and a README for every feature folder, using the template in CODE-STYLE §9.
   - Update `HANDOFF.md`'s code map.

## Checking nothing changed
1. **Saved data:** load the owner's real `squad-task-map-data.json` (a copy) and the v1 fixture. After a load-and-save with no edits, the saved JSON is equal (same keys and values) to before; migration output is unchanged.
2. **API calls:** the same requests in the same order for the same actions (compare the server's request log before and after).
3. **Browser smoke tests** (Playwright via Node, dev-only, kept in `tests/browser/`). The v2 build was checked with these scenarios; turn them into a permanent suite and run it before and after:
   - map picker counts per map;
   - markers, zones and extracts counts on Streets;
   - add by name; tick a marker objective → "have" goes down, untick gives it back;
   - pins and Pinned only; mark an extract;
   - Move to; Re-sort everything with Undo; Don't split;
   - AI key + categorize + apply + undo (mock);
   - scan capture → review → confirm deletes / cancel keeps (mock);
   - log events: accept → added, finish → removed, mode prompt → switch;
   - GPS screenshot → arrow; raid end → counts and marks reset, GPS shots deleted;
   - settings save; hide/show the list; selection highlight and flash; phone width.
4. **Screenshots** of picker, map, panel, Bring list and settings, before and after. They should look identical.
5. **Performance:** the selection flash and radar still cause 0 main-thread paints while idle (Chrome trace). Pan and zoom are as smooth as before.

## Acceptance checks
- Everything in "Checking nothing changed" passes.
- No file in `web/js` uses single-letter names outside loops and coordinates. No function over ~40 lines without a reason noted in a comment.
- Every feature folder has a README; `docs/FEATURES.md` lists every feature.
- The owner reads two feature READMEs plus their `rules.js` (suggested: readiness and extracts) and confirms they're easy to follow.

## Open questions (proposed default in brackets)
- Keep the browser smoke tests permanently (they need Node + Playwright as dev tools)? [yes; they're the safety net for every later ticket]
- Prettier for consistent JS formatting? [yes, dev-only, `printWidth: 100`]


---

# 04c · Check for updates (from a Google Drive folder)

**Size:** M · **Touches:** server (new `internal/features/updates`), page (`web/js/features/updates/`, a Settings section), a release tool (`cmd/release`) · **Depends on:** 04, 04b

## Goal
When the owner uploads a new version to a shared Google Drive folder, everyone in the squad can update from inside the app:
- Settings → **Check for updates** → see what's new → **Download and restart**.
- **Nothing happens automatically.** The app never checks, downloads or installs on its own. It only acts when someone clicks the button. (Owner's decision.)

## Why it comes right after the rewrite
Every later ticket (05–10) ships a new exe to the squad. With this in place, each release is "upload to Drive, tell the squad to click Check for updates", instead of passing zips around.

## How the app finds the latest version
- **A small manifest file,** `latest.json`, sits in the owner's Drive folder, shared "Anyone with the link can view":
  ```jsonc
  {
    "version": "2.3.0",
    "released": "2026-10-20",
    "notes": "• Find me: radar ping…\n• Closest extract…",
    "file": { "driveId": "<exe file id>", "name": "SquadTaskMap.exe", "size": 31457280, "sha256": "<hex>" },
    "signature": "<ed25519 signature of everything above, base64>"
  }
  ```
- **The manifest's Drive file ID is fixed and built into the app** as the update source. Keep it in one constant with a comment, so switching to a different host later (e.g., GitHub Releases) is a one-line change.
- **To publish a new version, the owner uploads new copies over the existing files** with Drive's **Manage versions → Upload new version**. That keeps each file's ID and link the same, so the app always reads the same manifest.
- **Fetch with Drive's direct-download URL** for a file shared by link. Two things to handle and test:
  1. For larger files, Google may return an HTML page ("Google Drive can't scan this file for viruses") instead of the file. The size where that starts isn't documented. The downloader must:
     - detect an HTML response;
     - follow the page's confirm link or form;
     - never treat HTML as the exe.
  2. Drive can block downloads of `.exe` files it flags. If that happens, ship a `.zip` instead and unzip after verifying (see the open question).

## Safety (must-have)
Self-updating software that runs on friends' PCs is a target. Even if the Drive folder or a link is tampered with, the app must refuse anything the owner didn't publish:
1. **Signed manifest:**
   - The owner's release tool signs the manifest with an **Ed25519 private key** that never leaves the owner's PC.
   - The app embeds the matching **public key** (Go `crypto/ed25519`, built in) and rejects any manifest whose signature doesn't verify.
   - Document where the private key lives and how to back it up: losing it means friends must update by hand once.
2. **Hash check:** the downloaded file's SHA-256 and size must match the signed manifest before anything is replaced.
3. **Only newer versions** (semantic version compare); no downgrades through the button.
4. **Fetch only from Google Drive** (an allowlist of hosts), over HTTPS, with a size cap of manifest size + 10%.

## Replacing the running exe on Windows
A running exe can't be overwritten, but it can be renamed:
1. Download to `SquadTaskMap.download.exe` next to the current exe, then verify the signature, hash and size.
2. Rename the current exe to `SquadTaskMap.previous.exe` (replacing any older one).
3. Rename the download to `SquadTaskMap.exe`.
4. Start the new exe with `--updated-from=<old version>`, then exit the old process.
5. The new process waits for the old one's port to free up, then starts as normal.

**Notes:**
- `github.com/minio/selfupdate` implements this rename-and-replace (plus checksum and signature checks). Use it or write the same steps by hand; either way, comment each step.
- **If any step fails, roll back:** rename `previous` back and tell the user. Their data files are never touched.
- **Before the first start of a new version,** copy `squad-task-map-data.json` to `squad-task-map-data.before-<version>.json`. Keep the last 3.
- If the exe's folder isn't writable, show "Couldn't update here. Download it from the Drive folder instead", with a link.

## Page
- **Settings → Updates:**
  - "You're on 2.2.0". **Check for updates**. "Last checked …" (shown only after a manual check).
  - Results:
    - **Up to date:** "You're up to date."
    - **New version:** "2.3.0 is available", then the release notes, the size and a **Download and restart** button. The button asks for confirmation before it does anything.
    - **Error:** a plain explanation (no internet, Drive blocked the download, signature didn't match → "This update isn't from the owner; not installed").
  - **Progress** while downloading, with Cancel.
- **After restart:** the page reconnects on its own. The open SSE stream drops and is reopened; the page notices `/api/status` reports a new version and reloads.
  - It then shows "Updated to 2.3.0" with the notes once.

## Release tool for the owner (`cmd/release`)
`go run ./cmd/release -version 2.3.0 -notes notes.md`:
1. Runs the tests and builds the Windows exe.
2. Computes its size and SHA-256.
3. Writes `latest.json` and signs it with the private key (path from an environment variable, never in the repo).
4. Prints what to upload where: "Upload `dist/SquadTaskMap.exe` as a new version of the exe file; upload `dist/latest.json` as a new version of the manifest."

Also `go run ./cmd/release -init-keys` creates the key pair once and prints the public key to paste into the code.

## Acceptance checks
- **Against `cmd/mock` serving a fake Drive** (manifest + exe + the virus-scan interstitial page):
  - "up to date", "new version", and the interstitial are handled.
  - A bad signature, a bad hash, a wrong size and an older version are each refused with a clear message.
- **On Windows:** update 2.3.0 → 2.3.1 from a test Drive folder.
  - The data files are untouched, a pre-update backup exists, and `previous.exe` exists.
  - The new version runs, and the page reloads by itself.
- **Failure halfway** (kill the download, or make the folder read-only): the old exe still runs and nothing is lost.
- The app makes **zero** network requests to Drive unless the button is clicked (check with the mock's request log).
- **README:**
  - an "Updating" section for players;
  - a "Publishing an update" section for the owner (Drive steps, release tool, key backup);
  - a privacy note: the app contacts Google Drive only when you click Check for updates.

## Owner checks
- Run `-init-keys` once and keep the private key safe (password manager or a USB stick).
- Do one real release through Drive, and have a squadmate update with the button.

## Open questions (proposed default in brackets)
- Ship the exe directly, or a zip? [the exe; switch to a zip only if Drive blocks exe downloads]
- Where does the update-source ID live: built into the exe, or also editable in Settings (so the squad can follow a different folder)? [built in; not editable, so it can't be pointed somewhere malicious]
- Show a small "update available" dot after a manual check, until the user updates? [yes]
- Move to GitHub Releases later? [possible: one constant plus a small fetcher; not now]


---

# 05 · Squad multiplayer over Tailscale (tsnet)

**Size:** L · **Touches:** server (new `internal/features/squad`), page (`web/js/features/squad/`) · **Depends on:** 04, 04b

## Goal
Friends running the app see:
- each other's **drawings**;
- if each player chooses to share them, each other's **tasks**;
- clearly, **which tasks they share**.

There's no website and no server to run. The apps connect directly over a private Tailscale network, built into the exe with **tsnet**. Friends install nothing extra; they paste an invite code once.

## How it fits together
```
Your app ──tsnet──┐                      ┌──tsnet── Friend's app
  127.0.0.1:7777  │   private tailnet    │   127.0.0.1:7777
  (your page)     └── peer API :7777 ────┘   (their page)
```
- Each app keeps serving its own page on **127.0.0.1** only, as now.
- When the player has joined a squad, the app also starts a **tsnet node** and listens on the tailnet for the **peer API**. That listener is separate from the local UI, and nothing else is exposed.
- **Mesh, no host:** every app connects to every other online app (a squad is ≤ 6 people). Anyone can be offline; you see their **last known** data with "last seen".

## Setup (one-time, owner)
1. Create a free Tailscale account (the Personal plan; non-commercial use).
2. In the access controls, define `tag:stm` and allow `tag:stm → tag:stm` on port 7777 only.
3. Create an **auth key**: reusable, pre-approved, tagged `tag:stm`, expiry ≤ 90 days. That's the squad invite code; share it privately (e.g., in a Discord DM).
4. Friends paste it into Settings → Squad → Join.
   - Devices stay joined after the key expires, so you only need a new key for new people.
   - Check that key expiry is disabled for these machines in the admin console, so nobody gets logged out after the default node-key lifetime.
5. To remove someone, delete their machine in the admin console.

Write this as a short guide in the README, with screenshots if possible.

## What's shared ("my share")
```jsonc
{
  "v": 1,
  "player": { "id": "<random, created once>", "name": "Mike", "color": "#4dabf7" },
  "rev": 42, "updatedAt": 0,
  "draw": { "<mapKey>": [ /* strokes, same shape as S.draw */ ] },
  "tasks": null | { "<taskId>": { "ticks": { "<objId>": true | 3 }, "pct": 40 } }  // null when "Share my tasks" is off
}
```
- The **page** builds the share from its saved state and sends it with `PUT /api/squad/share`, debounced about 1 s after a save. The server stays unaware of the saved-data format.
- **Never shared:** the OpenAI key, folder paths, screenshots, settings, bring-list counts, categories and AI chats.
- Friends' data is **read-only** for you.

## Peer API (tailnet listener only)
- `GET /squad/v1/share` → the latest share with `rev`.
- `GET /squad/v1/stream` → SSE: a full share whenever `rev` changes. The data is small; diffs aren't needed.
- **Identify callers** with tsnet's `LocalClient().WhoIs`. Reject anything that isn't a `tag:stm` node.
- Cap request and response sizes (e.g., 2 MB).

## Discovery and connection
- Find peers from the tailnet's peer list (tagged `tag:stm`, hostname `stm-<player id>`).
  - React to changes using tsnet's IPN bus watch (event-driven).
  - If that's impractical, a status check every 60 s is the most allowed; no faster.
- For each online peer: fetch the share, then keep its stream open. Reconnect with backoff (1 s → 60 s cap).
- **Cache** friends' last shares in `squad-task-map-squad.json` (with `lastSeen`) so offline friends still show.
- The tsnet state folder (`squad-task-map-tailscale/` next to the exe) holds node keys. Treat it as secret; **Leave squad** logs out and deletes it.

## Page
- **Settings → Squad:**
  - Join (invite code) / Leave;
  - your name and colour;
  - **Share my tasks** (off by default);
  - status: "Connected · 3 of 4 friends online".
- **Panel → Squad chips:** one per friend (colour dot, name, online or "last seen 2 h"), each with two toggles: drawings and tasks.
- **Friends' drawings:** a read-only layer per friend, under your own drawings, in that friend's colour (see the open question). Hidden when that friend's toggle is off.
- **Shared tasks:**
  - A task you and at least one shown friend both have active gets "Also: Mike, Sam" on its row and in the popup.
  - Its map markers get small friend-colour dots in the **bottom-left badge slot**, which SPEC §7.3 reserved.
  - Filter: **"Shared with squad"** shows only those.
  - In the popup, each friend's progress on that part ("Mike 2/5 · Sam ✓").
- **Friends' other tasks** (they have it, you don't): hidden by default. When a friend's task toggle is on, they appear in a "Friends' tasks" block at the bottom of the list. On the map they're drawn smaller, in the friend's colour, and they never affect your readiness or your Bring list.
- Live updates come from the server as `squad` SSE events (broadcast). The page also loads `/api/squad` at boot.

## Lightweight rules
- No squad joined → tsnet never starts. Zero cost for solo players.
- Joined: idle cost is tsnet keepalives and open streams. Shares are sent only on change (debounced).
- Measure idle CPU with tsnet up and 2 peers connected, and report it.

## Testing without a real tailnet
- Add a dev transport behind `STM_SQUAD_DEV_PEERS=127.0.0.1:7901,127.0.0.1:7902`: the peer API runs on localhost ports with no tsnet. It lets 3 instances (separate `STM_DATA_DIR`s) be tested on one PC and in CI.
- Then one real test on a tailnet with 2 PCs.

## Acceptance checks
- Three local instances (dev transport):
  - Drawing in A appears in B and C within about 1 s.
  - Undo in A removes it from B and C.
  - B's toggle hides A's layer.
- Tasks: A shares, B doesn't. A sees no tasks from B; B sees A's tasks (when B turns A's task toggle on). Shared-task badges and the filter are correct.
- C goes offline: A and B still show C's last data with "last seen". C comes back: data refreshes.
- Leave squad: tsnet state is deleted and friends' cache is cleared.
- Solo (never joined): no tsnet process or traffic; idle CPU is unchanged from ticket 04.

## Owner checks
- Two or more of you join with the invite code. You see each other's drawings live and the "Also: …" badges on shared tasks.

## Open questions (proposed default in brackets)
- Friends' drawings in their own stroke colours or in the friend's profile colour? [profile colour, so you can tell whose is whose]
- Share task ticks, or just the task list? [list + ticks, so "Mike 2/5" works]
- Share live GPS positions with the squad? This is a big feature with fair-play implications, so it's **not in this ticket**. [ask the owner; later ticket if wanted]
- Share this raid's extract marks (after ticket 06)? [later, small add-on]


---

# 06 · Read my extracts from the first raid screenshot

**Size:** M · **Touches:** server (`internal/features/extracts`, using `internal/openai`, `internal/screenshots` and the `raid` feature), page (`web/js/features/extracts/`) · **Depends on:** 04, 04b. Pairs with 03, which then picks the closest of *your* extracts automatically.

## Goal
At the start of a raid, the player opens Tarkov's extract list (double-tap **O**) and presses the screenshot key. The app reads that screenshot with the OpenAI model, works out which extracts this player has, and **marks them on the map**, exactly like clicking them by hand.

## How it works
1. **Trigger:** the first GPS screenshot after `raidStart` (see the open question about retrying).
   - Wait until the file is fully written (its size is stable).
   - Shrink it to ≤ 2048 px JPEG in Go, then send it to the model in the background.
   - This happens once per raid, so it's a small cost.
2. **Prompt:**
   - Read the extract list shown on screen: each extract's name and any status or requirement text.
   - If no extract list is visible, return none.
   - Strict JSON schema: `{ "visible": bool, "extracts": [{ "name": string, "note": string|null }] }`.
   - Use the low reasoning setting, as the task scan does.
3. **Matching:**
   - Match names to that raid's map extracts **and transits** with the existing fuzzy matcher (normalise, Levenshtein ratio ≥ 0.82).
   - Map comes from the log's scene path or nameId, falling back to the open map.
   - Names that don't match are listed in a toast so the player can mark them by hand.
4. **Marking:**
   - Matched extracts are set in `prefs[map].extMarked` with `{ auto: true, note }` so the UI can tell AI marks from manual ones. The existing marks are a plain `true` flag; extend the stored value **without breaking old data** (`true` must still read as marked).
   - They clear at raid end, as manual marks do today.
   - The player can unmark or mark more by clicking, as now.
5. **Feedback:**
   - A toast: "Marked 4 extracts from your screenshot (1 not recognised: …)".
   - A small "AI" tag on auto-marked extracts in the panel's extract list.
   - Requirement notes (e.g., "Requires paracord") show on hover or tap.
6. **Settings:** "Read my extracts from my first raid screenshot", only available with an OpenAI key. See the open question for the default.

## Delivery
`deliver({ type: "extracts", map, marked: [...], unknown: [...] })`: queued until acked, because it changes saved data. The page applies it.

## Privacy (README update needed)
Today the app only reads screenshot **file names**. With this on, **the first in-raid screenshot image** (shrunk) is sent to OpenAI each raid.
- Say so in "Privacy and cost": about 1–2k input tokens per raid.
- The screenshot is still deleted at raid end, as today.

## Acceptance checks
- Mock OpenAI (`cmd/mock`) returns a preset extract list; a synthetic GPS screenshot after a synthetic `GameStarted` marks the expected extracts on the right map. Unknown names show in the toast.
- No key, or the setting off → nothing is sent (verify in the mock's request log).
- Only one model call per raid (plus retries, if adopted). Raid end clears marks; the next raid triggers again.
- Ticket 03's closest-extract uses the auto marks immediately.

## Owner checks in-game
- Double-tap O, take a screenshot: within a few seconds your extracts are marked.
- Try a PMC raid and a Scav raid. Check the in-game names match the map's names; report any mismatches so they can be added as aliases.

## Open questions (proposed default in brackets)
- If the first screenshot doesn't show the extract list, try the next ones? [yes, up to 3 screenshots per raid; stop once a list is found]
- Default on when an OpenAI key exists? [on, with a one-time notice explaining what's sent]
- Also read the raid timer from the same screenshot? [no; not asked for]


---

# 07 · Item icons as task markers

**Size:** S–M · **Touches:** page (shared marker drawing in `web/js/map/`, plus `web/js/features/icons/`), `internal/gamedata` (quest-item ids), server icon cache (`internal/features/icons`) · **Depends on:** 04, 04b

## Goal
For objectives where you **place something**, the map marker shows **the item's icon** instead of the category shape:
- marking with an MS2000 Marker or other special equipment;
- planting a WI-FI camera, a jammer or a quest item;
- stashing an item.

You can see at a glance what to bring to each spot.

## Scope
1. **Which objectives:**
   - `mark` uses the marker item (MS2000 by default).
   - `plantItem` uses the item; if there are alternatives, the first one, with a small "+" corner mark.
   - `plantQuestItem` uses the quest item.
   - All other objectives keep their category shape.
2. **The marker:**
   - The icon sits in a rounded tile with a **category-colour border**, so category identity stays.
   - The existing badges keep their slots: "!" top-left, floor top-right, split bottom-right. The bottom-left slot stays reserved for squad dots (ticket 05).
   - The not-ready style is unchanged: 50% opacity + "!" + dotted zone.
   - Same screen size as other markers at every zoom, and the same selection flash.
3. **Icons:**
   - Source: `https://assets.tarkov.dev/<itemId>-icon.webp`.
   - Quest items need their **id** in the data. Today the converter keeps only the quest item's name (`qi`), so add `qiId`.
   - Check that quest-item icons exist on assets.tarkov.dev. If one doesn't, fall back to the category shape.
4. **Icon cache (server):**
   - Serve icons through the app (`/icons/<id>.webp`).
   - Download each icon once into `squad-task-map-icons/` next to the exe and serve it from there afterwards. That makes it work offline after the first view, and it's kinder to tarkov.dev.
   - Do the same for the Bring list icons, which currently hotlink.
   - **Only ever** fetch from assets.tarkov.dev, with a 24-character hex id; nothing else can be requested through it.
5. **Settings:** "Task markers: item icons / shapes" (see the open question).
6. **Offline / failed icon:** fall back to the shape silently.

## Acceptance checks
- A Fuel Matter (Reserve) shows MS2000 icons. Dandies' stash part shows the stashed item's icon. A quest-item plant shows the quest item's icon (or a shape if none exists).
- Readiness, selection flash, floor and split badges all still work on icon markers.
- With the network off after one online view, icons still show from the cache. With an empty cache and no network, shapes show; no broken images.
- Pan and zoom are as smooth as before with ~40 icon markers on Streets.

## Owner checks
- Look at your maps: are icons clearer than shapes? Are they too small or too big?

## Open questions (proposed default in brackets)
- The owner asked for "the Special Equipment icon for any task that needs it, *or* the icon of the item to stash". Use each item's own icon (which covers both) rather than one generic "Special equipment" icon? [the item's own icon]
- Default: icons or shapes? [icons]
- Gear objectives (wear or use X): show the gear's icon too? [no; keep shapes; maybe later]


---

# 08 · Loot spots layer (high-value containers, documents, loose keys)

**Size:** M–L · **Touches:** data pipeline (`internal/gamedata`), page (`web/js/features/loot/`) · **Depends on:** 04, 04b

## Goal
Show high-value loot spots on the map, toggled by type, for planning loot and Scav runs:
- safes, weapon boxes, PC blocks, jackets, filing cabinets, medcases, supply crates;
- loose high-value items, documents/intel, and keys that spawn as loot.

Locked doors and the keys that open them are extracted here (`locks`), but they're shown by **ticket 09 (My keys)**.

## Data
tarkov.dev's map data has what's needed. The GraphQL schema lists these on `Map`:
- `lootContainers`: `{ lootContainer { id, name, normalizedName }, position }`;
- `lootLoose`: `{ items [Item], position }`;
- `locks`: `{ lockType, key Item, needsPower, position, outline, top, bottom }`;
- also `switches`, `hazards`, `stationaryWeapons` and `btrStops`, not in scope.

tarkov.dev's own interactive map draws container layers by type and loose loot by item or handbook category.

1. **Find where these live in json.tarkov.dev's files first** (`{mode}/maps` and friends), plus item metadata for loose loot: names, handbook categories, and a price or base price if available.
   - Inspect the real files; don't guess (see ticket 04, step 0).
   - If a field isn't in json.tarkov.dev, the tarkov.dev GraphQL API (`api.tarkov.dev/graphql`) is the fallback. Ask the owner before adding a second data source.
2. **Converter output:** add per map, keeping it compact (short keys, rounded coordinates):
   ```jsonc
   "loot": {
     "containers": [{ "t": "safe", "x": 0, "y": 0, "z": 0 }],          // t = container normalizedName
     "loose": [{ "i": ["<itemId>", …], "x": 0, "y": 0, "z": 0 }],
     "locks": [{ "key": "<itemId>", "type": "door", "power": false, "x": 0, "y": 0, "z": 0, "ol": [[0, 0]], "top": 0, "bottom": 0 }]   // used by ticket 09
   },
   "lootTypes": { "safe": "Safe", … }                                   // display names
   ```
3. **Size:** loot can be thousands of points per map. Measure the added size of `/api/data`; if it's large, serve loot per map at `/api/loot/<map>`, loaded when that map opens.

## Page
1. **Panel section "Loot"** (collapsed by default):
   - Chips per container type, with counts.
   - Chips for loose-loot groups (e.g., Documents & intel, Electronics, Valuables, Keys).
   - A **"High value"** preset that turns on a sensible set in one click.
   - Choices are saved per map in `prefs[map].loot`, a new field with a default.
2. **Markers:**
   - Small, clearly secondary to task markers: a neutral tile with a simple type glyph, or the item icon for single-item loose spots (via ticket 07's cache).
   - Floor badge as for tasks.
   - Tap shows a popup: name, items or key, floor.
   - Loot markers are **not** selectable as tasks and never affect readiness.
3. **Floors:** respect the floor selector and `floorBadge()` as task markers do.

## Performance (must-have)
`apply()` re-transforms every `.sc` element on each pan/zoom frame. Thousands of loot markers would make panning stutter. Pick one approach and measure:
- **Draw only markers inside the current view** (with a margin), updated after pan/zoom settles; and/or
- **Cluster when zoomed out** (one "12 safes" bubble per grid cell), splitting as you zoom in; or
- Draw loot on a **canvas overlay** redrawn after each view change (no per-element transforms).

Acceptance target: on Streets with every loot chip on, panning and zooming stays smooth, and idle cost is unchanged (no timers, no animation).

## Acceptance checks
- Counts per type match the source data for 2–3 maps.
- Toggling chips is instant. Choices persist per map across restarts.
- The performance target above, checked with a Chrome trace while panning.
- Loot markers don't change task readiness, the Bring list or selection.

## Owner checks
- Open Customs and Interchange with "High value" on: the spots you know (dorms safes, PC blocks, …) are where you expect.

## Open questions (proposed default in brackets)
- What counts as "High value"? [containers: safes, weapon boxes, PC blocks, tech supply crates, medcases, jackets, filing cabinets; loose: documents/intel, valuables, electronics, keys; owner can tweak]
- A price threshold for loose items (needs price data)? [only if json.tarkov.dev has prices; otherwise categories only]
- Include hazards (minefields, snipers) and BTR stops as extra chips? [not now]


---

# 09 · My keys per map, and the rooms they unlock

**Size:** M · **Touches:** page (`web/js/features/keys/`, plus readiness and the Bring list), saved state, squad share · **Depends on:** 04b, 08 (locks and loot data), 07 (key icons). 05 is needed for sharing keys with the squad.

## Goal
Each player keeps a **saved key list per map**: the keys they usually bring there. The map then **highlights every door and lock those keys open**, so you can see at a glance where your keys get you in and what loot is likely behind each door. The list stays the same raid after raid until you change it, because the squad usually brings the same keys to a map.

## Data
From ticket 08's converter output: `loot.locks` per map. Each lock has:
- the key item id;
- the lock type (door, container, trunk, …);
- `needsPower`;
- the position, door outline, top and bottom.

One key can open several locks. Key names and icons come from the item data and ticket 07's icon cache.

**Keys that matter on a map:** every key with a lock on it, plus keys that tasks on the map need (`objs[].keys`). That's the list to pick from.

## Scope
1. **"My keys" section** in the map panel. It's per map, and collapsed shows "My keys (5)".
   - **Add key:** a search box over this map's keys (name + icon). Keys that open nothing on this map can still be added through an "all keys" search, flagged "doesn't open anything here".
   - Each key in the list shows its icon, its name, and how many locks it opens here ("3 doors, 1 container"). Click it to fly to its locks.
   - Remove with ×, with Undo. Also "Copy from another map" (e.g., Ground Zero ↔ Streets) and "Clear".
   - **Saved** in the state as `keyring: { "<mapKey>": ["<keyItemId>", …] }`, a new field with a default `{}`.
   - **Not reset at raid end** (unlike Bring-list counts).
2. **Map layer: your keys' locks**
   - For each lock opened by a key on your list:
     - a **door marker** (key icon tile in a "your keys" colour no category uses), with the floor badge;
     - the door **outline** drawn as a highlighted polygon when the data has one.
   - Doors needing power get a ⚡ badge.
   - **Tap a door:**
     - key name and icon, lock type, floor, "needs power";
     - tasks that use this key;
     - **loot likely behind it:** ticket 08 loot spots on the same floor within a short radius of the door (proposed 8 m), highlighted while the popup is open. Label it "nearby, approximate". The data has the door, not the room's walls.
   - A toggle "All locked doors" also shows doors for keys you **don't** have, dimmed. That helps you decide which keys are worth bringing.
     - Dimmed doors are a new exception to the "markers are fully opaque" rule (SPEC §7.3). Note it in `CLAUDE.md`'s conventions.
3. **Readiness and the Bring list**
   - A key on this map's list counts as **had** for task readiness on this map, raid after raid. Today the "have" counts reset after each raid.
   - The Bring list's Keys section shows "On your key list ✓" for those keys.
   - Keys you still need for visible tasks but haven't listed stay highlighted as missing, as now.
4. **Squad (with 05):**
   - Optionally share your key lists, under a "Share my keys" toggle.
   - Doors a squadmate can open show their colour dot. The door popup lists "Mike has this key".
   - A task's key requirement shows "Sam has it".
5. **Pre-raid check:** when a raid starts on a map (raid start from the logs), the toast includes "Bring your 5 keys for Customs". Clicking it opens the list.

## Out of scope
- Tracking key uses or durability.
- Detecting which keys are in your inventory automatically (the game doesn't expose it).
- Exact room boundaries (not in the data).

## Acceptance checks
- Add 3 keys on Customs. Their doors are highlighted, with outlines where available. Reload: still there. Raid end: still there.
- A task needing one of those keys is "ready" for the key part without touching the Bring list counts, and it's still ready after a raid end.
- "All locked doors" shows the rest dimmed. Removing a key un-highlights its doors; Undo restores it.
- Copying the list to another map keeps only keys that matter there (or asks).
- The door popup lists tasks and nearby loot. The nearby-loot radius check is right on two known doors.
- Performance as in 08: no animation, smooth pan and zoom with all doors shown.

## Owner checks
- Set up your usual keys for one map. The highlighted doors match where those keys actually work in-game, and the "loot behind it" is roughly right.

## Open questions (proposed default in brackets)
- Should keys on your list count as "had" for readiness automatically? [yes, on that map only]
- Radius for "loot likely behind the door"? [8 m, same floor; tune after the owner checks]
- Share key lists with the squad? [yes, behind its own "Share my keys" toggle]
- Also show keycards for extracts and power switches (e.g., the keycard for an extract)? [only if they appear in the locks data; otherwise later]


---

# 10 · Looting routes

**Size:** M · **Touches:** page (`web/js/features/routes/`), saved state, squad sharing · **Depends on:** 04b, 08 (snap to loot spots), 09 (snap to locked doors), 05 (share routes)

## Goal
Build your own looting routes, mainly for Scav runs: an ordered path of stops on a map, saved, shown on demand and shared with the squad.

## Scope
1. **Route mode** (map toolbar button "🧭 Route", like Draw):
   - Click to add a stop at the end.
   - Stops **snap** to a nearby loot spot, locked door (ticket 09), extract or task marker (within ~12 px) and take its name; otherwise "Stop 3".
   - Drag a stop to move it. Click the line between two stops to insert one. Delete a stop with × in its popup or the Delete key.
   - Esc or the button again finishes.
2. **Route look:**
   - A line in the route's colour with direction arrows.
   - **Numbered stops**, with start and end (extract) emphasised.
   - Total straight-line length and number of stops are shown in the panel.
3. **Panel section "Routes"** (per map):
   - List with name, colour, stops and length. Show/hide toggle per route.
   - Rename, recolour, duplicate, reverse, delete (with Undo).
   - "Edit" re-enters Route mode for that route.
4. **Saved state:** `routes: { "<mapKey>": [{ id, name, color, visible, stops: [{ x, z, y?, label, ref? }] }] }`.
   - Game coordinates, like drawings. `ref` points at the snapped loot spot or extract.
   - New field with a default in `freshState()`.
5. **Sharing (with 05):** routes are part of "my share". Friends' routes show in their colour (read-only) with a **"Copy to my routes"** action.
6. **In raid (light touch):** if a route is visible and you have a GPS fix, the gpsbar shows "Next stop: 3 · PC block · ~60 m" (the nearest stop ahead of the last one you passed). This is optional; see the open question.

## Out of scope
Automatic route planning (no navmesh data), and timing estimates.

## Acceptance checks
- Create a 6-stop route on Customs. Snapping picks loot spots and takes their names; drag and insert work; the length updates.
- Reload: routes persist. Hide and show works per route.
- With 05: a friend's route appears in their colour; Copy makes an editable copy of your own.
- Undo restores a deleted route.
- Nothing animates; pan and zoom stay smooth with 3 visible routes plus the loot layer.

## Owner checks
- Plan a Scav run route, play it, and say whether the stop numbers and the line read well while playing on a second screen.

## Open questions (proposed default in brackets)
- "Next stop" hint during raids? [yes, if a single route is visible; otherwise off]
- Import and export a route as a code to paste in Discord (works without the squad feature)? [yes, small]
- Freehand segments between stops (to show a path around obstacles)? [no; straight lines between stops for now]
