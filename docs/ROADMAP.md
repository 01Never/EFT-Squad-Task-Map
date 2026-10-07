# Roadmap: v2.1 → v3

Fourteen tickets, in the order to build them. 01–04e are below (all done); 05–10 are GitHub issues (linked in the table). Each ticket has its goal, scope, acceptance checks, in-game checks for the owner, and open questions with a proposed default. Ask the owner about any open question before building that part.

| # | Ticket | Size | Touches | Depends on |
|---|---|---|---|---|
| 01 | Find me on the map: stand-out player marker + radar | S | page | none |
| 02 | Auto-center on me, keep zoom | S | page + one setting | 01 |
| 03 | Closest extract | S | page | 01 |
| 04 | Go backend: port the server to Go, written readable from the start; serve the JS unbundled | L | server | 01–03 merged |
| 04b | Reorganise the page for readability (no behaviour change) | M | page | 04 |
| 04c | Check for updates from GitHub Releases (manual button) | M | server + page + release tool | 04, 04b |
| 04d | Only answer the app's own page (Host/Origin checks on the local API) | S | server | 04c |
| 04e | Page bug fixes found by the browser suite | S | page | 04b |
| 05 | [#3](https://github.com/01Never/EFT-Squad-Task-Map/issues/3) Squad multiplayer over Tailscale (tsnet) | L | server + page | 04, 04b |
| 06 | [#4](https://github.com/01Never/EFT-Squad-Task-Map/issues/4) Read my extracts from the first raid screenshot (AI) | M | server + page | 04, 04b (and 03 to be useful) |
| 07 | [#5](https://github.com/01Never/EFT-Squad-Task-Map/issues/5) Item icons as task markers | S–M | page + server icon cache | 04, 04b |
| 08 | [#6](https://github.com/01Never/EFT-Squad-Task-Map/issues/6) Loot spots layer: high-value containers, documents, loose keys | M–L | data + page | 04, 04b |
| 09 | [#7](https://github.com/01Never/EFT-Squad-Task-Map/issues/7) My keys per map, and the rooms they unlock | M | page + saved state (+ sharing) | 04b, 08, 07 (05 for sharing) |
| 10 | [#8](https://github.com/01Never/EFT-Squad-Task-Map/issues/8) Looting routes | M | page (+ sharing) | 04b, 08, 09, 05 |

S = a day or two of focused work for Claude Code, M = a few days, L = a week or more. These are rough, for ordering only.

## Why this order

1. **01–03 first: the in-raid quick wins.** They're the squad's current pain point (finding yourself on the map) and they're small. They're almost entirely page-side code, and the page doesn't change in the Go port, so none of this work is redone later. Testing them in raids also covers the v2 checks that are still open (GPS arrow position and direction, raid start/end), so the Go port starts from a version proven in-game.
2. **The rewrite: 04, then 04b, before anything else.**
   - Every later ticket needs server work: tsnet, reading screenshots, icon caching, loot data. Doing the port first means none of that is written twice (in TypeScript and then in Go).
   - The owner wants to read and understand each feature's logic, so the rewrite is also when the code gets organised for readability (see `docs/CODE-STYLE.md`). The Go backend (04) is written that way from the start; the page is reorganised in 04b.
   - **Why two tickets:** they're kept apart so each is checkable on its own. 04 swaps the backend under an unchanged page (a 1:1 copy of behaviour, compared against the current app). 04b reorganises the page on top of a proven backend (no behaviour change, checked with browser smoke tests).
   - Every ticket after that lands in the readable, feature-by-feature layout.
3. **04c (Check for updates) right after the rewrite.**
   - Every later ticket ships a new exe to the squad. With this in place, a release is "publish a GitHub release, click Check for updates" instead of passing zips around.
   - It's manual by design: nothing is checked or installed until someone clicks the button.
4. **05 next.** tsnet is the main reason for Go, and multiplayer is the squad's biggest ask. Doing it before 06–10 also means each later feature (extract marks, key lists, routes) can be designed as shareable from day one instead of being added to sharing afterwards.
5. **06 and 07: small server-backed improvements** on top of the new backend. 06 makes 03 automatic.
6. **08, then 09, then 10.**
   - 08 builds the data pipeline for loot, including the locked doors (`locks`).
   - 09 (My keys) uses those doors, the loot near them and ticket 07's icons.
   - 10 (Routes) can then snap to loot spots and to your doors. Key lists and routes both ship shareable because 05 exists.

If the owner would rather not touch the Bun version at all, do 04, 04b and 04c first and then 01–03. Nothing else changes.

## Rules for every ticket
- One ticket per branch/PR. Bump the version, update `docs/USER-GUIDE.md` (and `README.md` if the feature list changes) for anything user-visible, and keep `docs/HANDOFF.md` current.
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
- With it on: zoom in, take three GPS screenshots at different spots (the synthetic file names in `docs/HANDOFF.md` §9 work), and each one centres at the same zoom.
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
- **Environment variables:** keep every `STM_*` and `PORT` variable from `docs/HANDOFF.md` §3 so the test setup carries over.
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

Then delete `server/*.ts`, the TS tests and the Bun scripts. Update `README.md` ("Building from source"), `docs/HANDOFF.md` and `CLAUDE.md`.

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
   - Update `docs/HANDOFF.md`'s code map.

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

# 04c · Check for updates (from GitHub Releases)

**Size:** M · **Touches:** server (new `internal/features/updates`), page (`web/js/features/updates/`, a Settings section), a release tool (`cmd/release`) · **Depends on:** 04, 04b

*Owner's change (2026-10-06): the update source is this repo's GitHub Releases instead of a Google Drive folder, now that the project is on GitHub. Everything else (manual button only, signed manifest, rename-and-replace) stays as first planned.*

## Goal
When the owner publishes a new release on GitHub, everyone in the squad can update from inside the app:
- Settings → **Check for updates** → see what's new → **Download and restart**.
- **Nothing happens automatically.** The app never checks, downloads or installs on its own. It only acts when someone clicks the button. (Owner's decision.)

## Why it comes right after the rewrite
Every later ticket (05–10) ships a new exe to the squad. With this in place, each release is "publish a GitHub release, tell the squad to click Check for updates", instead of passing zips around.

## How the app finds the latest version
- **The repo is public,** so release downloads need no token or account.
- **Each release has two assets:** `SquadTaskMap.exe` and a small signed manifest, `latest.json`:
  ```jsonc
  {
    "version": "2.6.0",
    "released": "2026-10-20",
    "notes": "• Check for updates…\n• …",
    "file": { "name": "SquadTaskMap.exe", "size": 12582912, "sha256": "<hex>" },
    "signature": "<ed25519 signature of everything above, base64>"
  }
  ```
- **The app reads the manifest from GitHub's stable "latest release" asset URL:**
  `https://github.com/01Never/EFT-Squad-Task-Map/releases/latest/download/latest.json`
  and downloads the exe from `…/releases/download/v<version>/SquadTaskMap.exe`.
  - These URLs are **not** the GitHub REST API, so its 60-requests-an-hour limit for anonymous callers doesn't apply.
  - "Latest" skips drafts and pre-releases, so the owner can stage a release as a draft or a pre-release without anyone being offered it.
- **The repo (`01Never/EFT-Squad-Task-Map`) is one constant with a comment,** built into the app. Both URLs are derived from it.
- **For tests,** `STM_UPDATES_BASE` overrides the base URL (`https://github.com/<repo>`) so `cmd/mock` can serve a fake GitHub. Like the other `STM_*` overrides, it's for development only.
- **Redirects:** GitHub answers asset URLs with a redirect to its download host. Follow redirects only to the allowlisted hosts (below).

## Safety (must-have)
Self-updating software that runs on friends' PCs is a target. Even if the GitHub account or a release is tampered with, the app must refuse anything the owner didn't sign:
1. **Signed manifest:**
   - The owner's release tool signs the manifest with an **Ed25519 private key** that never leaves the owner's PC (never in the repo, never in GitHub Actions secrets).
   - The app embeds the matching **public key** (Go `crypto/ed25519`, built in) and rejects any manifest whose signature doesn't verify.
   - Document where the private key lives and how to back it up: losing it means friends must update by hand once.
2. **Hash check:** the downloaded file's SHA-256 and size must match the signed manifest before anything is replaced.
3. **Only newer versions** (semantic version compare); no downgrades through the button.
4. **Fetch only from GitHub** (host allowlist: `github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com`), over HTTPS, with a size cap of manifest size + 10%. The manifest itself is capped at 64 KB.

## Replacing the running exe on Windows
A running exe can't be overwritten, but it can be renamed:
1. Download to `SquadTaskMap.download.exe` next to the current exe, then verify the signature, hash and size.
2. Rename the current exe to `SquadTaskMap.previous.exe` (replacing any older one).
3. Rename the download to `SquadTaskMap.exe`.
4. Start the new exe with `--updated-from=<old version>`, then exit the old process.
5. The new process waits for the old one's port to free up, then starts as normal.

**Notes:**
- Write these steps by hand with a comment on each (no new dependency). Keep the file operations behind a small interface so the steps and the rollback can be tested on any OS.
- **If any step fails, roll back:** rename `previous` back and tell the user. Their data files are never touched.
- **Before the first start of a new version,** copy `squad-task-map-data.json` to `squad-task-map-data.before-<version>.json`. Keep the last 3.
- If the exe's folder isn't writable, show "Couldn't update here. Download it from GitHub instead", with a link to the release page.
- Under `go run` (no installed exe), Check for updates still works but **Download and restart** is disabled with "Updates only apply to the built exe".

## Page
- **Settings → Updates:**
  - "You're on 2.5.0". **Check for updates**. "Last checked …" (shown only after a manual check).
  - Results:
    - **Up to date:** "You're up to date."
    - **New version:** "2.6.0 is available", then the release notes, the size, a "View on GitHub" link and a **Download and restart** button. The button asks for confirmation before it does anything.
    - **Error:** a plain explanation (no internet, GitHub unreachable, no release published yet, signature didn't match → "This update isn't from the owner; not installed").
  - **Progress** while downloading, with Cancel.
- **After restart:** the page reconnects on its own. The open SSE stream drops and is reopened; the page notices `/api/status` reports a new version and reloads.
  - It then shows "Updated to 2.6.0" with the notes once.

## Release tool for the owner (`cmd/release`)
`go run ./cmd/release -version 2.6.0 -notes notes.md`:
1. Checks that `-version` equals `Version` in `internal/app/run.go`, `package.json` and `winres/winres.json`.
2. Runs the tests and builds the Windows exe into `dist/`.
3. Computes its size and SHA-256.
4. Writes `dist/latest.json` and signs it with the private key (path from the `STM_RELEASE_KEY` environment variable, never in the repo).
5. Prints the next step, both ways:
   - with the GitHub CLI if it's installed: `gh release create v2.6.0 dist/SquadTaskMap.exe dist/latest.json --title "2.6.0" --notes-file notes.md`;
   - or by hand: "On GitHub → Releases → Draft a new release, tag `v2.6.0`, attach `dist/SquadTaskMap.exe` and `dist/latest.json`, publish."

Also `go run ./cmd/release -init-keys` creates the key pair once and prints the public key to paste into the code.

## Acceptance checks
- **Against `cmd/mock` serving a fake GitHub** (latest-release redirect, assets, a redirect to the download host):
  - "up to date", "new version", and "no release yet" (404) are handled.
  - A bad signature, a bad hash, a wrong size, an older version and a redirect to a host not on the allowlist are each refused with a clear message.
- **On Windows:** update 2.5.0 → 2.5.1 from a test release (a draft or pre-release can't be used, since "latest" skips them; use a fork or a short-lived real release).
  - The data files are untouched, a pre-update backup exists, and `previous.exe` exists.
  - The new version runs, and the page reloads by itself.
- **Failure halfway** (kill the download, or make the folder read-only): the old exe still runs and nothing is lost.
- The app makes **zero** network requests to GitHub unless the button is clicked (check with the mock's request log).
- **Docs:**
  - `docs/USER-GUIDE.md`: an "Updating" section for players, and the privacy note "the app contacts GitHub only when you click Check for updates";
  - a "Publishing an update" section for the owner (release tool, GitHub steps, key backup) in `docs/HANDOFF.md`;
  - `README.md`'s Privacy section gets the same one-line note.

## Owner checks
- Run `-init-keys` once and keep the private key safe (password manager or a USB stick).
- Do one real release on GitHub, and have a squadmate update with the button.

## Open questions (proposed default in brackets)
- Ship the exe directly, or a zip? [the exe; GitHub doesn't block exe assets]
- Where does the update source live: built into the exe, or also editable in Settings? [built in; not editable, so it can't be pointed somewhere malicious]
- Show a small "update available" dot after a manual check, until the user updates? [yes]
- Build releases with GitHub Actions? [not now: the signing key must stay on the owner's PC; Actions could build and the owner sign, later]


---

# 04d · Only answer the app's own page (local API hardening)

**Size:** S · **Touches:** server (`internal/httpapi`, `internal/app`) · **Depends on:** 04c · *Owner decision (2026-10-06), after QA's review of 04c.*

## Problem
The server listens on 127.0.0.1 only, but any web page open in the user's browser can still send it requests:
- **Cross-site "simple" POSTs** (e.g. `Content-Type: text/plain`) are accepted without a CORS preflight. A page can trigger `/api/updates/check` → `/download` → `/apply` (a forced restart, possibly mid-raid), `/api/ai/categorize` (spends OpenAI credit) or `/api/scan/confirm` (deletes screenshots). It can't read the answers, and it can only install a release signed by the owner.
- **DNS rebinding:** a site whose name resolves to 127.0.0.1 is same-origin with itself, so its page can read `/api/state` and overwrite it with PUT. Today the server answers any `Host` header.

## Scope
1. **One middleware in front of every route** (static files, API, SSE):
   - **Host check:** the `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` (the port the server actually listens on). Anything else → `421 Misdirected Request` with a one-line plain-text body. This blocks DNS rebinding.
   - **Origin check on state-changing requests** (every method except GET, HEAD, OPTIONS): when an `Origin` header is present it must be `http://127.0.0.1:<port>` or `http://localhost:<port>`, otherwise `403`. When `Origin` is absent, check `Sec-Fetch-Site` if present (`same-origin` or `none` pass), otherwise allow (non-browser clients such as tests and curl send neither).
   - **JSON bodies:** API routes that read a JSON body require `Content-Type: application/json` (`415` otherwise), so a cross-site form or `text/plain` POST can't reach them even if a browser omits `Origin`.
2. **The page keeps working unchanged.** Check that every `fetch` in `web/js/` sends `Content-Type: application/json` with a body (the page's own API helper should already). Only fix the page if one doesn't, and say so.
3. **Tests** (table-driven, names that read like the rules): good host/origin pass; foreign Host, foreign Origin, `null` Origin, cross-site `Sec-Fetch-Site`, `text/plain` body each refused with the right status; GET of static files and `/api/events` still work with the right Host; the port in Host must match.
4. **The single-instance check** (a second launch opens the running copy's page) and `cmd/mock` must keep working. `cmd/mock` is not the app and doesn't need the middleware.
5. **Ticket 05 (tsnet) note:** squadmates will reach a *separate* tsnet listener. Write the middleware so the allowed hosts are a list built in `internal/app`, so 05 can add its own listener's rules instead of loosening these.

## Acceptance checks
- `curl -X POST -H 'Origin: http://evil.example' -H 'Content-Type: text/plain' -d '{}' http://127.0.0.1:7777/api/updates/check` → 403, and the mock's log shows no GitHub request.
- `curl -H 'Host: attacker.example:7777' http://127.0.0.1:7777/api/state` → 421.
- The full browser suite passes unchanged.
- `docs/HANDOFF.md` (architecture) and the `httpapi` README describe the rule; the user guide's privacy section gets one line ("Only the app's own page can use it; other websites open in your browser can't").

## Owner checks
- None in-game; the app should behave exactly as before.

---

# 04e · Page bug fixes found by the browser suite

**Size:** S · **Touches:** page · **Depends on:** 04b · *Owner decision (2026-10-06): fix the three bugs the 04b suite found.*

1. **Settings checkboxes are squashed into thin slivers** ("Follow my position", "Center the map on me…"). They should look like normal checkboxes, left of their label, in the tarkov.dev style (`accent-color` from the palette), and stay clickable on the label too. Check desktop and phone width.
2. **Deselecting leaves the task row open.** Pressing Esc or clicking an empty spot on the map clears the selection (flash stops) but the task's row in the list stays expanded, so the next click on that row closes it instead of selecting it. Fix: deselecting also collapses the row it had opened, so the next click on that row selects it again (zoom + flash), exactly like a fresh click. Closing the popup behaves the same.
3. **"Switch data" reloads the game data twice.** *Outcome: kept, by design.* The two reloads are two real changes (the built-in data at once, then the fresh download); see `docs/HANDOFF.md` §11.

## Acceptance checks
- New browser-suite checks for each bug (fail before, pass after), and new logic tests where a rule changed.
- The rest of the browser suite passes. Only the expectations these fixes change are re-recorded (`STM_E2E_UPDATE=1` on those tests only), named in the commit: likely the Settings screenshot and the "Switch data" request list.
- No new timers, no polling, no animation of SVG attributes.

## Owner checks
- Open Settings: the two checkboxes look and click normally.
- Select a task, press Esc, click the same row again: it selects and zooms.

# 05–10 · Tracked as GitHub issues

From 2026-10-07 the remaining tickets live as issues on GitHub, one per ticket, with the same text (goal, scope, acceptance checks, owner checks, open questions). Read and discuss them there. The PR that builds a ticket says "Closes #N", which closes its issue on merge.

| # | Issue |
|---|---|
| 05 | [#3 Squad multiplayer over Tailscale (tsnet)](https://github.com/01Never/EFT-Squad-Task-Map/issues/3) |
| 06 | [#4 Read my extracts from the first raid screenshot (AI)](https://github.com/01Never/EFT-Squad-Task-Map/issues/4) |
| 07 | [#5 Item icons as task markers](https://github.com/01Never/EFT-Squad-Task-Map/issues/5) |
| 08 | [#6 Loot spots layer](https://github.com/01Never/EFT-Squad-Task-Map/issues/6) |
| 09 | [#7 My keys per map, and the rooms they unlock](https://github.com/01Never/EFT-Squad-Task-Map/issues/7) |
| 10 | [#8 Looting routes](https://github.com/01Never/EFT-Squad-Task-Map/issues/8) |

New tickets go straight to GitHub issues, in the same format (labels: `ticket`, `size: …`, `server`/`page`).
