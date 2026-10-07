# Handoff: Squad Task Map v2

For Claude Code picking up this project. Read this file, then `CLAUDE.md` (rules), then `docs/SPEC.md` (the v2 design, still the source of truth for intended behavior), then `docs/ROADMAP.md` (the tickets being built now) and `docs/CODE-STYLE.md` (how new code is written). `docs/USER-GUIDE.md` is the user-facing manual; `README.md` is the GitHub landing page (overview, download, building).

Current version: see `Version` in `internal/app/run.go` (also `version` in `package.json` and the version info in `winres/winres.json`; keep all three equal).

---

## 1. Read this first

1. **What it is:** a Windows desktop helper for Escape from Tarkov. One Go program compiled to `SquadTaskMap.exe` (~27 MB since ticket 05 added tsnet, ~12 MB before; v2 up to 2.3.0 was Bun/TypeScript) that:
   - serves a map web page on `http://127.0.0.1:7777`;
   - watches the game's **log files** (tasks accepted/finished, raid start/end, game mode);
   - watches the **screenshots folder** (in-raid GPS position from file names; task-list scans read by OpenAI vision);
   - downloads task/map data from **json.tarkov.dev**;
   - once the player joins a squad (ticket 05), shares drawings (and, if chosen, tasks) with
     friends' copies over a private Tailscale network built into the exe (tsnet). Never joined →
     none of that starts.
   The owner and their squad use it while playing, often with the map on half the screen.
2. **The game is CPU-bound and runs at the same time.** Lightness is a hard requirement, not a nice-to-have. See §7.
3. **The owner decides features.** They like to talk a feature through before anything is built. Don't change behavior that wasn't asked for. When a request is ambiguous, ask. Squadmates' feedback arrives through the owner; build what the owner asks for, which can differ from the raw feedback (e.g., the friend asked for red highlights and the owner said "not red").
4. **Checked against real data on 2026-10-04/05 (ticket 04 step 0):** the live json.tarkov.dev files, the owner's real log files (one session, anonymised in `testdata/logs/real-session`) and real screenshot names (`testdata/screenshots/names.txt`), and Windows folder detection on the owner's PC. Still not seen in-game: the items in §10.
5. **Deliverables the owner expects:** the Windows exe (zipped; also `.7z` if the zip is over 30 MB) **and** the source. See §3.
6. **Git:** the repo is on GitHub at `github.com/01Never/EFT-Squad-Task-Map` (public). `main` holds accepted work; each roadmap ticket gets its own branch, merged into `main` when the owner accepts it. Releases are published as GitHub Releases (ticket 04c).
7. **Agents:** role briefs for Claude Code subagents live in `.claude/agents/` (backend, frontend, tester, docs). The main session acts as product manager: it writes the brief for each ticket, hands it to the right agent, and reviews the result before it reaches `main`.

---

## 2. Hard rules (also in CLAUDE.md)

- **TarkovMonitor is GPL-3.0.** Read it for formats and behavior; never copy its code.
- **File deletion:** never delete anything outside the app's own files except:
  1. screenshots the user confirmed in a scan (`taskscan.Scan.Confirm`, only names in the current capture list);
  2. GPS screenshots created during the raid that just ended (`raid.Tracker.End`, only files it saw being created).
  Both go through `screenshots.Watcher.DeleteFile`, which refuses anything but a plain file name in the folder.
- **API keys** stay server-side, stored in plain text in `squad-task-map-settings.json`, and are only sent to `api.openai.com`. The page never sees the full key (`storage.MaskKey`).
- **Projection (`web/js/map/projection.js` `makeProj`) is exact** and verified against tarkov.dev test vectors. Keep its tests passing.
- **Saved-state changes need a migration path** (see §6.2).
- Use a scratch `STM_DATA_DIR` while developing so the owner's real `squad-task-map-data.json` isn't touched.

---

## 3. Run, test, build

Go 1.27 and Node 24 are portable installs in `E:\coding\toolchains` (`go\bin`, `node`), on the user PATH (the owner chose portable after the admin prompt for a system-wide install was cancelled). Git is at `E:\coding\Git\cmd\git.exe`. Bun was uninstalled after the Go port passed its parity check (owner's decision).

Go dependencies: `github.com/fsnotify/fsnotify` (screenshots folder notifications), `golang.org/x/sys` (Windows registry and the Documents known folder), `tailscale.com` (tsnet, the squad network of ticket 05; it brings many indirect modules and +14.7 MB of exe; its test helpers `tstest/integration/testcontrol` run a fake tailnet in `internal/features/squad/tsnet_test.go`). The page has no dependencies and no build step.

| Task | Command |
|---|---|
| Dev run | `go run .` (page files are served from disk, so edits show on reload) |
| Server tests | `go test ./...` |
| Page tests | `npm test` (= `node --test "web/js/**/*.test.js"`) |
| Page type check | `npm run typecheck` (= `npx -y -p typescript tsc -p jsconfig.json --noEmit`; downloads TypeScript on first use, nothing installed in the project). VS Code checks the same files as you type (`jsconfig.json`, `// @ts-check`). |
| Browser suite | `npm run test:browser` (see §9 and `tests/browser/README.md`) |
| Windows exe | `go build -trimpath -ldflags "-s -w" -o dist/SquadTaskMap.exe .` (~27 MB; zipped ~10 MB) |
| Icon / version info | edit `winres/winres.json`, then `go-winres make --arch amd64 --out rsrc` (writes `rsrc_windows_amd64.syso`, picked up by `go build`) |

**Environment variables** (PowerShell: `$env:NAME="value"; go run .`):

| Variable | Effect |
|---|---|
| `STM_DATA_DIR` | Where data/settings files live (default: exe folder, or cwd in dev) |
| `STM_NO_BROWSER=1` | Don't open a browser on start |
| `PORT` | First port to try (default 7777; tries up to 7800) |
| `STM_LOGS_DIR` / `STM_SCREENSHOTS_DIR` | Override detected game folders |
| `STM_JSON_BASE` | Game-data base URL (default `https://json.tarkov.dev`) |
| `STM_OPENAI_API` / `STM_WIKI_API` | OpenAI and wiki endpoints (for the mock server) |
| `STM_UPDATES_BASE` | Replaces `https://github.com/01Never/EFT-Squad-Task-Map` for "Check for updates" (the mock serves a fake GitHub at `http://127.0.0.1:7820/github/01Never/EFT-Squad-Task-Map`) |
| `STM_UPDATES_PUBLIC_KEY` | Only when `STM_UPDATES_BASE` is on this PC (127.0.0.1, ::1, localhost); otherwise ignored: trust this base64 public key instead of the built-in one (the mock's test key is in `testdata/updates/mock-public-key.txt`) |
| `STM_RELEASE_KEY` | For `cmd/release` only: the path of the owner's private signing key file |
| `STM_ASSETS_DIR` | Serve the page files from this folder instead of the ones built into the exe (automatic under `go run`) |
| `STM_SQUAD_DEV_LISTEN` | Squad dev transport (ticket 05): serve the peer API on this address on this PC (e.g. `127.0.0.1:7901`) instead of using tsnet at all. Ignored (one console line) unless it's a loopback address. |
| `STM_SQUAD_DEV_PEERS` | With `STM_SQUAD_DEV_LISTEN`: the other copies' peer API addresses, comma-separated (`127.0.0.1:7902,127.0.0.1:7903`) |
| `STM_SQUAD_DEBUG=1` | Print tsnet's own (verbose) log in the console |
| `TS_CONTROL_URL` | Tailscale's own variable, read by tsnet: use another control server (only for tests and measurements, e.g. a fake tailnet). Not needed with a real tailnet. |

**One copy at a time:** the running copy writes `squad-task-map-instance.json` (port, pid) in the data folder; a second launch on the same data folder opens that copy's page and exits. Copies with different `STM_DATA_DIR`s run side by side (tests, squad dev setups).

**Release checklist**
1. Bump `Version` in `internal/app/run.go`, `version` in `package.json` and the versions in `winres/winres.json` (then `go-winres make --arch amd64 --out rsrc`).
2. `go test ./...`, `npm test`, then the manual checks in §9 that touch your change.
3. `go build -trimpath -ldflags "-s -w" -o dist/SquadTaskMap.exe .`
4. Zip `SquadTaskMap.exe` + `USER-GUIDE.md` (from `docs/`) in a `SquadTaskMap-v2/` folder. The Go exe zips well under the chat's 30 MB limit; only if a zip is over 30 MB, also make a `.7z` with Windows' own tar: `tar --format 7zip --options "7zip:compression=lzma2,7zip:compression-level=9" -cf SquadTaskMap-<version>.7z SquadTaskMap-v2`.
5. Zip the source: `git archive --format=zip --prefix=squad-task-map-<version>-source/ -o <file>.zip HEAD`.
6. Update `docs/USER-GUIDE.md` for user-visible changes, and this file.

---

## 3b. Publishing an update (ticket 04c)

Friends update from inside the app (Settings → Updates → Check for updates), from this repo's
GitHub Releases. The app never checks by itself. It trusts a release only if its `latest.json` is
signed with the owner's Ed25519 key, so a tampered release or account can't push code. Details and
the HTTP API: `internal/features/updates/README.md`; the tool: `cmd/release/README.md`.

**Once: make the signing key** (done 2026-10-06 for 2.6.1; the key is in
`%AppData%\SquadTaskMap\release-private-key.txt` on the owner's PC. Keep these steps for a new key)
1. `go run ./cmd/release -init-keys`. It writes the **private key** to
   `%AppData%\SquadTaskMap\release-private-key.txt` (or `-key-out <path>`) and prints the public key.
2. **Back the private key up** (password manager or a USB stick). Never put it in the repo, in
   GitHub (not even Actions secrets) or in chat. If it's lost, friends must update by hand once;
   if it leaks, anyone can publish "updates": make a new key pair and hand out a new build.
3. Paste the printed public key into `EmbeddedPublicKey` (`internal/features/updates/rules.go`,
   replacing the `TODO(owner)` placeholder), build, and give that version to the squad by hand.
   Until then every check ends with "This copy can't check for updates yet".
4. Point the tool at the key: `$env:STM_RELEASE_KEY = "C:\...\release-private-key.txt"`
   (`setx STM_RELEASE_KEY ...` to keep it).

**Each release**
1. Bump the version in `internal/app/run.go`, `package.json` and `winres/winres.json` (then
   `go-winres make --arch amd64 --out rsrc`); write `docs/release-notes/X.Y.Z.md` (what's new, plain text, one bullet
   per line).
2. `go run ./cmd/release -version X.Y.Z -notes docs/release-notes/X.Y.Z.md`. It checks the three versions match and
   that your key is the app's key, runs `go test ./...` and `npm test`, builds
   `dist/SquadTaskMap.exe`, and writes the signed `dist/latest.json`.
3. Publish on GitHub, with the command it prints:
   `gh release create vX.Y.Z dist/SquadTaskMap.exe dist/latest.json --title "X.Y.Z" --notes-file docs/release-notes/X.Y.Z.md`
   or by hand: GitHub → Releases → Draft a new release → tag `vX.Y.Z` → attach **both** files →
   Publish (not as a pre-release: "latest" skips drafts and pre-releases, which is also how you
   stage a release nobody is offered yet).
4. Tell the squad to click Check for updates. For the zip deliverables (§3 checklist) the exe is
   the same `dist/SquadTaskMap.exe`.

Gotchas: the exe attached must be exactly the one `latest.json` describes (re-run the tool if you
rebuild); a release with only one of the two files makes friends see "no release"/a download error;
publishing a version lower than a friend's shows them "older than the version you're running".

---

## 3c. Squad network setup (ticket 05, owner, once)

The squad's copies talk directly over a private Tailscale network (a "tailnet"). Friends install
nothing: the network is inside the exe. The owner sets it up once:
1. Create a free Tailscale account (the Personal plan; non-commercial use).
2. In **Access controls**, define the tag and allow squad copies to reach each other on port 7777
   only:
   ```jsonc
   {
     "tagOwners": { "tag:stm": ["autogroup:admin"] },
     "grants": [ { "src": ["tag:stm"], "dst": ["tag:stm"], "ip": ["tcp:7777"] } ]
   }
   ```
   (Keep whatever else your policy has; if it uses `acls` instead of `grants`, the same rule is
   `{"action": "accept", "src": ["tag:stm"], "dst": ["tag:stm:7777"]}`.)
3. **Settings → Keys → Generate auth key**: **reusable**, **pre-approved**, tags: **`tag:stm`**,
   expiry 90 days or less. That key (`tskey-auth-…`) is the squad's **invite code**. Share it
   privately (e.g. a Discord DM), never in a public channel.
4. Each friend pastes it into **Settings → Squad → Join** (the page part is `web/js/features/squad/`).
   - Devices stay joined after the key expires: a new key is only needed for new people.
   - In the admin console's **Machines** list, check that **key expiry is disabled** for the squad
     machines (tagged devices usually have it off), so nobody is logged out after the default
     node-key lifetime.
5. To remove someone, delete their machine in the admin console. Their copy then shows "Signed
   out of the squad network" until they leave and join with a new code.

Each copy shows up as `stm-<player id>`. Its node key is in `squad-task-map-tailscale/` next to
the data files: treat that folder as secret. **Leave squad** logs out and deletes it.

**Trying it on one PC (no Tailscale):** three copies with their own data folders and the dev
transport, e.g. in three PowerShell windows:
```
$env:STM_DATA_DIR="E:\scratch\a"; $env:PORT=8101; $env:STM_SQUAD_DEV_LISTEN="127.0.0.1:7901"; $env:STM_SQUAD_DEV_PEERS="127.0.0.1:7902,127.0.0.1:7903"; go run .
$env:STM_DATA_DIR="E:\scratch\b"; $env:PORT=8102; $env:STM_SQUAD_DEV_LISTEN="127.0.0.1:7902"; $env:STM_SQUAD_DEV_PEERS="127.0.0.1:7901,127.0.0.1:7903"; go run .
$env:STM_DATA_DIR="E:\scratch\c"; $env:PORT=8103; $env:STM_SQUAD_DEV_LISTEN="127.0.0.1:7903"; $env:STM_SQUAD_DEV_PEERS="127.0.0.1:7901,127.0.0.1:7902"; go run .
```
then join each with any `tskey-…` text (the dev transport doesn't use it).

---

## 4. Architecture

```
Tarkov logs ──(5 s size check)──► features/gamelog ─┐
Screenshots ──(OS notifications)─► screenshots ─────┤
json.tarkov.dev ──(hourly check)─► gamedata ────────┼─► internal/app ──httpapi (HTTP/SSE)──► page (web/js) ──PUT /api/state──► squad-task-map-data.json
OpenAI ◄──(scan, categorize)───── taskscan / aicategorize ┘          127.0.0.1 only
Friends' copies ◄─(tailnet :7777, peer API; only when joined)─► features/squad ─► internal/app ─► "squad" event ─► page
```

- **The page owns the saved data.** It loads `GET /api/state`, migrates it, and saves the whole object with `PUT /api/state` (500 ms debounce, `flush()` on tab hide/unload). The server just stores it (atomic write plus a `.bak`).
- **Server → page events use Server-Sent Events** (`/api/events`). There are two kinds (`server/events.ts`):
  - `deliver(ev)`: events that change saved data (`task` started/finished/failed, `raidEnd`). They're queued in `squad-task-map-pending.json` and resent until the page acks (`POST /api/events/ack`). That way a task accepted while the browser was closed still lands.
  - `broadcast(ev)`: transient events (`gps`, `capture`, `raidStart`, `raidMap`, `mode`, `keybind`, `data`, `updates`, `squad`). They're dropped if no page is open.
- The page handles events in `web/js/app/live-events.js`: one named handler per event name (`app/event-names.js`, checked against `internal/events/names.go` by `names_test.go`).
- **Only the app's own page is answered** (ticket 04d, `internal/httpapi/guard.go`). Every request goes through `httpapi.Guard` with the allowed hosts `internal/app` builds for the bound port (`127.0.0.1:<port>`, `localhost:<port>`): another Host → 421 (blocks DNS rebinding); a state-changing request (not GET/HEAD/OPTIONS) whose `Origin` isn't `http://` + an allowed host, or, without `Origin`, whose `Sec-Fetch-Site` isn't `same-origin`/`none` → 403 (blocks cross-site POSTs); a body not sent as `application/json` on a JSON-body route → 415. Clients that send neither header (curl, tests, the single-copy check) pass. The page sends every JSON body with `Content-Type: application/json` (`app/api.js`, `app/saving.js`, `features/updates/panel.js`). Ticket 05's peer API is not on this server: it is a separate listener (the tailnet, or a 127.0.0.1 port with the dev transport) with its own checks (`Host` must be its own IP address and port, which blocks DNS rebinding; `tag:stm` nodes via tsnet `WhoIs`, or loopback only; never a request carrying `Origin` or `Sec-Fetch-Site`; ≤ 2 streams per machine; at most one share a second taken from each friend), in `internal/features/squad/peerapi.go`.
- **The page never polls,** with one exception: it polls `/api/ai/job/:id` while an AI Categorize request runs.

### Server (Go; start with `internal/app/app.go`)
| Package | Role |
|---|---|
| `main.go`, `embed.go` | Entry point; `//go:embed` of `web/` and `assets/` (the page is served as-is, no bundler). |
| `internal/app` | Creates every part and wires them (`app.go`: log event → raid/gps/events; screenshot → gps or scan), the backend behind every route (`backend.go`), start-up (`run.go`: data folder, single copy, port 7777→7800, the allowed hosts for that port, banner, browser), the squad's wiring (`squad.go`: tsnet or dev transport, its settings block, the `squad` event, resume at launch only when joined). |
| `internal/httpapi` | `Guard` (Host/Origin checks) and `jsonBody` (415) in `guard.go`, route table and thin handlers (`routes.go`), static files with explicit content types and an ETag = version (`static.go`), the `Backend` interface listing everything the page can ask for. |
| `internal/events` | Event names (`names.go`, spelled identically in `web/js/app/event-names.js`; `names_test.go` fails if the lists differ) and the SSE hub: `Deliver` (queued in `squad-task-map-pending.json` until acked) and `Broadcast` (live only). |
| `internal/storage` | Files next to the exe: settings (unknown fields kept, `tt*` dropped), the page's saved data as opaque text (atomic write + `.bak`), v1 backup. |
| `internal/gamedata` | Saved copy or built-in snapshot; refresh when over 24 h old (checked hourly); validation (≥ max(200, 50% of previous) tasks, ≥ 5 maps); `convert.go`/`snapshot.go` = 1:1 port of v2's converter, JSON-equal to the v2 goldens. |
| `internal/gamefolders` | Logs folder via the launcher's registry entry or Steam libraries; Documents via `FOLDERID_Documents` (OneDrive-safe). |
| `internal/screenshots` | Watches the screenshots folder (fsnotify); a file is handed on once quiet for 400 ms with a stable size; the only file deletion, limited to plain names in the folder. |
| `internal/openai` | Responses API client, error hints, key/model shape checks. |
| `internal/features/gamelog` | `rules.go` parser (entries → events, screenshot-key check) and `watcher.go` (5 s size check, new bytes only, newest session folder, no catch-up). |
| `internal/features/raid` | Raid state (loading map, start, end, session mode) and that raid's GPS shots; `rules.go`: `ModeMatches`, `EndsOnMenuReturn`. |
| `internal/features/gps` | Position from screenshot names (`rules.go`), last position + trail (`tracker.go`). |
| `internal/features/taskscan` | Capture mode, serving captured images, the vision read, confirm/cancel. |
| `internal/features/aicategorize` | AI Categorize (prompt, tool loop, review of the answer), wiki fetch/clean/cache (7 days), jobs. |
| `internal/features/updates` | "Check for updates" (ticket 04c): signed manifest from GitHub Releases, background download, rename-and-replace with rollback, restart. Starts only from a click: no timers. README has the full API. |
| `internal/features/squad` | Squad sharing over a private tailnet (ticket 05): your share (rev stamping, tasks dropped unless shared), the peer API on its own listener (`GET /squad/v1/share`, `/squad/v1/stream`), friends found on the IPN bus and held on SSE streams with 1 s → 60 s backoff, everything received validated, friends cached with `lastSeen`; tsnet or dev transport (picked in `internal/app/squad.go`). Starts only when joined. README has the full API for the page. |
| `cmd/mock` | Offline stand-ins for json.tarkov.dev, OpenAI, the wiki and a fake GitHub Releases (byte-equal to v2's Bun mock for the first three). |
| `cmd/release` | The owner's release tool: version check, tests, Windows build, signed `latest.json`. See "Publishing an update". |

### Page (`web/`)
Plain JavaScript modules served as-is (no bundler), organised by feature (`docs/CODE-STYLE.md` §1).
Every file starts with `// @ts-check`; types are JSDoc (`web/js/app/types.js`), checked by VS Code
and `npm run typecheck`. Each feature folder has a README.
- `index.html`: the shell (top bar, `#view`, capture bar, toast) and the stylesheets, linked in a
  fixed order: `web/css/base.css` (colours as variables such as `--player`, `--selection-ring`,
  `--not-ready`; fonts, buttons, fields, dialogs, tags; the 860 px and 600 px breakpoints), then
  `map/map.css`, `panel/panel.css`, then one file per feature. A later file wins a tie.
- `web/js/main.js`: start-up only (load config, data, status, saved data; migrate; route; connect).
- `web/js/app/`: the shared parts.
  - `state.js`: `app`, the one shared changing state (saved data, game data, status, the open map).
  - `types.js`: JSDoc types (Task, Objective, Part, SavedState, Category, Settings, events…).
  - `saved-data.js`: `freshState()`, `fillMissingFields()`, `migrateSavedData()` (v1 → v2).
  - `saving.js`: `save()` (500 ms debounce), `flush()`, save on close.
  - `game-data.js`: lookups (tasks by id, objectives by id, name matcher, map names), reload.
  - `live-events.js`: the live-event router; `event-names.js`: the names.
  - `routing.js`: `#/` picker or `#/map/<key>`, and `rerenderPage()`.
  - `api.js`, `dom.js` (find, escape, SVG elements, toast, modal), `map-prefs.js`, `game-modes.js`.
- `web/js/map/`: the map view, no feature rules.
  - `map-page.js`: open/close a map, `renderMapPage()` (panel, then each layer, then the popup),
    floors, modes (pan / draw / place).
  - `layers.js`: the map's layers, bottom to top. `view.js`: pan, zoom, fit, `applyView()`.
    `input.js`: mouse, touch, wheel, keys. `projection.js` (exact, tested). `markers.js` and
    `marker-shapes.js`: drawing a marker. `place-names.js`. `selection-flash.js` (`#fx`).
    `map-art.js`: the SVG files.
- `web/js/panel/panel.js`: the panel's header, the Tasks tab's sections in order, the footer,
  hide/show, and the one router for its clicks and changes (each feature lists its handlers).
- `web/js/features/<name>/`: `tasks`, `readiness`, `sub-tasks`, `drawing`, `extracts`, `find-me`,
  `picker`, `raid`, `scan`, `ai-categorize`, `settings`. Each has `README.md`, `rules.js` (no DOM,
  tested in `rules.test.js`), `panel.js` and/or `map-layer.js`, and its `<name>.css`. See
  `docs/FEATURES.md`.
- **Rendering model:** `renderMapPage()` rebuilds the panel's innerHTML (keeping its scroll position)
  and redraws the SVG layers. Map overlays are `<g class="sc" data-x data-y>`, counter-scaled in
  `applyView()` so they keep their screen size at any zoom.

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
- The selected markers flash for as long as the part is selected. Esc, an empty-map click or the popup × deselects and closes the row it had opened (04e), so the next click on that row selects it again.

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

The raw json.tarkov.dev format (`{mode}/tasks`, `tasks_en`, `maps`, `maps_en`, `traders`, `traders_en`, `items_en`; names are translation keys) was first **inferred**, then **checked against the real files on 2026-10-05**: the assumptions hold, nothing is left untranslated, 515 tasks with the same ids as the snapshot, payload ~1.8 MB. The real files are kept (gzip) in `testdata/jsontarkovdev/`, and the Go converter is JSON-equal to v2 on them (`internal/gamedata/convert_test.go`).

### 6.2 Saved state (`squad-task-map-data.json`, `version: 2`)
See SPEC §12. Fields: `cats`, `tasks{id: {active, source, addedAt, gamePct, scannedAt, noSplit, pinned, partCats}}`, `ticks`, `have`, `used`, `subs`, `draw`, `prefs{map: {ext, extMarked, labels, drawOn}}`, `pinnedOnly`, `panelTab`, `panelHidden`, `collapsed`, `dcolor`, `dwidth`, `aiOpen`, `showScanBanner`, `migratedFrom`.
- **Adding a field:** add its default to `freshState()`. `fill()` adds missing defaults when loading. Only bump `version` and add a `migrate` step for structural changes; keep the v1 → v2 path working (fixture: `tests/fixtures/v1-data.json`, the owner's real v1 file).

### 6.3 Files next to the exe
`squad-task-map-data.json` (+ `.bak`), `squad-task-map-settings.json` (OpenAI key/model/effort, `gameMode`, `logsPath`, `screenshotsPath`, `followPosition`, `autoCenter`), `squad-task-map-gamedata-<mode>.json`, `squad-task-map-pending.json`, `squad-task-map-wikicache.json`, `squad-task-map-data.v1-backup.json`, `squad-task-map-instance.json` (port of the running copy), `squad-task-map-data.before-<version>.json` (newest 3, made before an update), `squad-task-map-update-notice.json` (release notes for the copy an update starts), `squad-task-map-squad.json` (ticket 05: my last squad share, friends' last shares with `lastSeen`), `squad-task-map-tailscale/` (ticket 05: tsnet's state folder with the node key, secret; deleted by Leave squad); the settings file's `squad` block holds `playerId`, `name`, `color`, `shareTasks`, `joined` (never the invite code); next to the exe, `SquadTaskMap.download.exe` and `SquadTaskMap.previous.exe` during/after an update.

---

## 7. Performance rules

Measured idle cost with the page open (2 min, 2026-10-05): **Go 2.4.0: 0.000% of one core, 34 MB working set** (Bun 2.3.0 was 0.18% and 57 MB). Keep it there:
- Server timers stay as they are: log poll 5 s (an `os.Stat`, then read only new bytes); folder rescan 30 s; missing-folder retry 60 s; game-data check hourly (downloads at most daily). Screenshots use OS file notifications (fsnotify). **No faster timers.**
- **The page:** no polling, no timers, no continuous animation, with these exceptions:
  - **The selection flash** is HTML rings in `#fx` over the map, animated only with CSS `transform`/`opacity`. That runs on the compositor with zero main-thread paint. A trace showed 0 Paint/Layout per second, versus ~120 paints per second for the old SVG `r` animation.
  - **The find-me pulse** (ticket 01) uses the same technique, and only for ~20 s after a new position or a Find me click.
  - **Never animate SVG attributes** or anything inside the map SVG: the map is a huge SVG, and each repaint is expensive.
  - `renderSelectionFlash()` (`map/selection-flash.js`) rebuilds the rings only when the selection signature changes, so re-renders don't restart the animation; `placeSelectionFlash()` repositions them in `applyView()` using `svg.getScreenCTM()`.
- Pan/zoom uses `requestAnimationFrame` (`applyViewSoon()` in `map/view.js`).
- **Squad (ticket 05):** never joined → tsnet never starts: no listener, no goroutine, no timer,
  no traffic. Joined → event-driven only: friends come from tsnet's IPN bus, shares travel on
  open SSE streams only when they change, no keep-alives of our own; the only timer is the
  reconnect backoff (1 s → 60 s) while a listed friend doesn't answer. Measured 2026-10-07 on
  Linux (the real app binary, page closed; Windows numbers still to take):
  | | CPU, idle | Memory (RSS) | Goroutines |
  |---|---|---|---|
  | 2.6.1 before ticket 05 | 0 ticks in 30 s | 40 MB (28 MB private) | 19 |
  | ticket 05, never joined | 0 ticks in 30 s | 52 MB (29 MB private; +11 MB are the bigger exe's mapped pages) | 18 |
  | ticket 05, joined, tsnet up, 2 friends connected (fake tailnet on 127.0.0.1) | 90 ms in 180 s = 0.05% of one core | 62 MB (36 MB private) | 99 |

---

## 8. Recipes

- **New API route:** add a method to `httpapi.Backend`, a line in the route table in `internal/httpapi/routes.go` and a thin handler; implement the method in `internal/app/backend.go`. Keep it on 127.0.0.1.
- **New live event:** add its name to `internal/events/names.go`; `hub.Deliver()` if it must reach saved data, else `hub.Broadcast()` (from `internal/app`); add the same name to `web/js/app/event-names.js` (a Go test checks the two lists) and a named handler to `HANDLER_BY_EVENT_NAME` in `web/js/app/live-events.js`, calling into the feature that owns it.
- **New server feature:** a package in `internal/features/<name>/` with `rules.go` (pure), its I/O in another file, `*_test.go` and a README; connect it in `internal/app/app.go` only.
- **New panel button:** markup with `data-act="x"` in the feature's `panel.js`, and `x: onXClicked` in that feature's actions table (e.g. `TASK_ROW_ACTIONS`); `panel/panel.js` routes clicks to it. The handler changes the saved data, then `save()` and `renderMapPage()` / `renderPanel()`.
- **New panel section:** a render function in the feature's `panel.js`, added to `TASKS_TAB_SECTIONS` in `panel/panel.js` in its place. **New map layer:** a name in `map/layers.js` (bottom to top), a render function in the feature's `map-layer.js`, called from `renderMapPage()`.
- **Toast with Undo:** `showToast(message, { label: "Undo", run: () => … })`. Snapshot with `snapshotCategories()`/`restoreCategories()` for category changes.
- **New map:** add the SVG to `assets/` and `embed.go` already embeds `assets/*.svg`. Add an entry to `assets/maps-config.json` (key, name, svg, transform, rotation, bounds, svgBounds, baseLayer, heightRange, layers, labels). These values come from tarkov.dev's maps data (the-hideout/tarkov-dev). Check that `SceneToMap`/`NameIDToMap` in `internal/gamedata/snapshot.go` map to the key.
- **Change splitting/categories:** edit `features/tasks/rules.js` / `categories.js` and add a case to `rules.test.js` / `categories.test.js` next to them (tasks are looked up by name in `testdata/golden/data-snapshot.json.gz`, via `tests/support/game-data.js`).
- **New roadmap feature:** a folder in `web/js/features/<name>/` with `README.md`, `rules.js`, `rules.test.js`, `map-layer.js`/`panel.js` and `<name>.css` (linked in `index.html`, in order); add a row to `docs/FEATURES.md`.

---

## 9. Testing

**Server:** `go test ./...`. Table-driven tests whose names read like the rules. The important ones:
- `internal/gamedata/convert_test.go`: the converter is JSON-equal to v2's output (golden files captured from the TypeScript server before the port) for the bundled snapshot, the mock files and the **real** json.tarkov.dev files of 2026-10-05.
- `internal/features/gamelog/gamelog_test.go`: the parser gives v2's events for synthetic samples and the owner's anonymised real session (`testdata/logs/real-session`); split writes, a shrinking file, a new session folder, no catch-up, UTF-8 cut between reads; the screenshot-key check.
- `internal/features/gps/rules_test.go`: positions for the owner's 102 real screenshot names (43 with a position) match v2.
- `internal/features/raid/raid_test.go`: mode matching, raid start/end, only that raid's GPS shots are deleted.
- `cmd/mock`: its own tests.
- `internal/features/squad` (ticket 05): the rules (rev stamping, tasks stripped, validation of
  peer data, backoff, caller checks); **three copies on the dev transport** in one test (a share
  reaches the others, updates propagate, an offline friend keeps their last share and `lastSeen`,
  a returning friend refreshes); and **real tsnet nodes on a fake tailnet** (`tsnet_test.go`:
  Tailscale's in-process control server and DERP on 127.0.0.1, checked to make no internet or DNS
  requests): join, share, untagged node refused, restart with the node key alone, Leave, signed
  out by the tailnet. `go test -short` skips the tsnet test, and so does Windows unless `STM_SQUAD_TSNET_TEST=1` (its UDP binding would make Windows Firewall ask about every new test binary). `internal/app/squad_test.go` covers
  the routes. Run `go test -race ./internal/features/squad ./internal/app` after squad changes.

**Page:** `npm test` (`node --test`): every `*.test.js` next to the rules it tests: `map/projection.test.js` (tarkov.dev vectors), `app/saved-data.test.js` (v1 → v2, missing fields), and `features/<name>/rules.test.js` (parts, categories, readiness and the Bring list, name matching, drawing, extracts, find-me, raid, picker, settings, AI Categorize, sub-tasks). Shared test data loading is in `tests/support/game-data.js`. `npm run typecheck` type-checks the page.

**Golden files** (`testdata/golden/`) were captured from the v2 TypeScript code before it was removed: converter outputs, the mock's raw documents, log events, GPS names. If a rule changes on purpose, regenerate the affected golden and say so in the commit.

**Offline end-to-end:** `go run ./cmd/mock` (port 7820) fakes json.tarkov.dev (the snapshot-based documents v2's mock served; `MOCK_DOCS=real` serves the real files in `testdata/jsontarkovdev`), OpenAI (accepted key `sk-test_1234567890abcdefghijkl`; vision returns preset rows, changeable via `POST /set-rows`; categorize moves keyed parts to "Key runs"), and the wiki. `POST /fail {"fail":true}` simulates a json.tarkov.dev outage; `GET /log` lists requests. Then run the app with:
```
STM_DATA_DIR=<scratch>  STM_LOGS_DIR=<scratch>\logs  STM_SCREENSHOTS_DIR=<scratch>\shots  STM_NO_BROWSER=1
STM_JSON_BASE=http://127.0.0.1:7820  STM_OPENAI_API=http://127.0.0.1:7820/v1  STM_WIKI_API=http://127.0.0.1:7820/wiki
```
Create `<scratch>\logs\log_2026.10.01_10-00-00_1.1.5.1\` containing empty `x push-notifications_000.log` and `x application_000.log` (the real names end like that), then **append** lines to simulate the game (real format, see `testdata/logs/real-session`):
```
2026-10-01 11:25:03.123|1.1.5.1.47510|Info|push-notifications|Got notification | ChatMessageReceived
{
  "message": { "type": 10, "templateId": "<taskId> description" }
}
2026-10-01 11:25:03.123|1.1.5.1.47510|Info|application|Session mode: Regular
2026-10-01 11:25:03.123|1.1.5.1.47510|Info|application|scene preset path:maps/city_preset.bundle rcid:x
2026-10-01 11:25:03.123|1.1.5.1.47510|Info|application|GameStarted:12.3 real:4.5
2026-10-01 11:25:03.123|1.1.5.1.47510|Info|application|PrepareSelectedProfileLocally ProfileId:0 AccountId:1
```
- Message `type` is 10 = started, 11 = failed, 12 = finished.
- GPS: create a file in the shots folder named `2026-10-01[14-05]_-120.53, 3.10, 210.77_0.00000, 0.70711, 0.00000, 0.70711 (0).png` (real names may add `_13.51` before ` (0)`).
- Scan: start a scan, then drop any images into the shots folder.

**Port parity (ticket 04):** before the TypeScript server was deleted, both servers ran side by side against the mock with the same inputs: static files byte-identical; `/api/data` JSON-equal; `/api/status` same shape and values; state round trip and `.bak`; the same SSE events in the same order for the same log lines and GPS file; the same pending queue and acks; settings; AI key, categorize, scan read/confirm/cancel and their errors (34 checks, all passing). Browser checks for tickets 01–04 (headless Edge via `puppeteer-core`, scratch scripts) passed against the Go server. Ticket 04b turns them into a permanent suite. The page keeps an SSE connection open, so wait for an element rather than for network idle.

**Browser smoke suite (ticket 04b, part 1):**
- **Where and how:** `tests/browser/`, run with `npm run test:browser` from PowerShell; Edge won't start from Git Bash. It needs Go, Node, `npm install` (playwright-core, pngjs) and Microsoft Edge.
- **What it checks:** it builds the app and `cmd/mock` from the working tree, and covers every scenario in ticket 04b plus the checks from tickets 01–03, including the 0-paint trace for the selection flash and the find-me pulse. It takes about 3 minutes.
- **Baselines:** `STM_E2E_RECORD=<dir>` records screenshots, each scenario's API requests and saved-data round trips. `node tests/browser/compare.mjs <before> <after>` diffs two recordings. The baseline of the 2.4.0 page is in `dist/04b-baseline/before/` (gitignored, so only on this PC).
- **More detail:** ports, env vars and the DOM hooks it relies on are in `tests/browser/README.md`.

---

## 10. Unverified: needs the owner in-game

Verified on the owner's PC since 2.3.0: folder detection (registry → `E:\Games\tarkov\Logs`; Documents via the Windows API); the real log formats and the order of raid lines; real screenshot names; live json.tarkov.dev data. Still open:
1. **Log events live:** accept a task → added within ~5 s; finish one → removed; PvE events ignored while the setting is PvP Season.
2. **GPS arrow direction:** two screenshots facing along a straight road. If it's off by 90° or 180°, fix the component order in `gps.YawFromQuaternion` or the correction in `arrowRotation`. Keep the projection itself untouched.
3. **Raid end:** the toast appears, `have` is 0, and only that raid's GPS shots are gone.
4. **Scan accuracy** with real screenshots and a real model (default `gpt-5.4-mini`), and that a full scan leaves exactly the in-game list.
5. **The Go exe on the owner's PC:** replace the exe, data and settings still there; one raid with logs, GPS, raid end and a scan.
6. **Squad on a real tailnet (ticket 05):** the setup in §3c, then two or more PCs join with the invite code and see each other online and each other's shares live; Leave deletes `squad-task-map-tailscale/`; deleting a machine in the admin console shows "Signed out…" on it; idle CPU and working set on Windows with tsnet up and 2 friends connected (Linux measurement in §7). Windows Firewall may ask once about the exe's network access when tsnet starts (UDP for direct connections; it works through Tailscale's relays either way).

---

## 11. Known gaps and quirks (not bugs the owner has reported; ask before changing behavior)

- **"Switch data" reloads the game data twice, by design (ticket 04e, decided 2026-10-07):** when there is no fresh saved copy for the new mode, the server sends two `data` events: `SetMode` (built-in snapshot, `fetchedAt` null, so the new mode shows at once) and then the finished download (`internal/gamedata/store.go`). The page reloads for each. Both carry a real change; waiting for the download instead would show the old mode's tasks under the new mode's name for the length of the download. With a fresh saved copy it's one reload.
- **Phantom tasks (reported by squadmates, not diagnosed):** tasks show that the player doesn't have. Suspects, from reading the code: (1) the v1 → v2 migration activates the whole v1 manual list, including tasks finished since; (2) `raid.ModeMatches()` accepts every log task event while the session mode is unknown, which is the case whenever the app starts after the game; (3) several open tabs each save the whole state, so a stale tab can restore a removed task; (4) a scan of a trader's available-tasks page, or a fuzzy match to the wrong name. The owner chose not to diagnose for now; a full scan now clears them. Each task entry's `source` and `addedAt` show which path added it.
- **Scan ignores the Reasoning setting:** `taskscan.Scan.Read` always sends `effort: "low"` for gpt-5/gpt-6/o-series models. SPEC §8 says to reuse the setting, defaulting to low.
- **Don't split vs moved parts:** a manual move stored on `<id>:<action>` doesn't apply once the task is unsplit (`<id>:*`); it falls back to the precedence default.
- GPS trail labels ("x min ago") overlap when zoomed far out.
- Item icons load from assets.tarkov.dev; offline they remove themselves (`onerror`).
- AI Categorize jobs live in server memory (`aicategorize.Jobs`); a restart drops a running job.
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
- **2.1.0 (ticket 01, Find me):** player marker in its own colour and ring shape with a "You" label; a new position (or 📍 Find me) pulses for ~20 s, then nothing animates (owner replaced the ticket's continuous radar with this); off-screen chip with distance; Find me and the chip centre without changing zoom; fainter trail. Includes the scan-replaces-list change.
- **2.2.0 (ticket 02, auto-center):** setting `autoCenter` (off by default) + ◎ Follow toolbar toggle: each new position centres the map at your zoom. With it off, only off-screen positions are brought into view (if Follow my position is on). The zoom-changing `centerOn()` is gone: nothing changes zoom automatically any more. A position that arrives mid-drag waits for the release (`afterUserLetsGo`).
- **2.3.0 (ticket 03, closest extract):** after each position, the closest marked extract (or, with none marked, the closest one the chips show; transits only when marked) gets a ring, a dashed line with "~N m" and a "Closest: …" link in the position bar. No runner-ups (owner). Code in `web/js/features/extracts/`. Also: the Follow toggle icon is ◎ (⌖ didn't render). Last Bun-only release before the Go port.
- **2.4.0 (ticket 04, Go backend):** the server is Go (`internal/`), one 12 MB exe (was ~89 MB), idle 0.000% CPU / 34 MB. Same routes, JSON, SSE events and data files (34-check parity run against the Bun server, JSON-equal converter on real data). The page is served unbundled (`/js/main.js`). New: one copy at a time per data folder; exe icon and version info; `cmd/mock` in Go; page tests on `node --test`. Found and fixed against the owner's real files first: a false "SysReq" screenshot-key warning (one working slot is enough) and a stale game-mode prompt (the game logs "Pve" then "PvpSeason" at start-up). Kill targets: "The Wedge" counts as a Scav kill (not in the boss list); left as is, raised with the owner. Bun uninstalled.
- **2.5.0 (ticket 04b, page reorganised by feature):** no behaviour change. The page's code moved from `web/js/*.js` and `web/js/logic/` into `app/`, `map/`, `panel/` and `features/<name>/` (README, `rules.js` + tests, `panel.js`, `map-layer.js`, `<name>.css`), with full names, small render functions, named handlers per feature instead of one big switch, named constants, `// @ts-check` with JSDoc types, one live-event router and event names checked against Go. CSS moved out of `index.html` into `web/css/base.css` and one file per feature. Checked with the browser suite: the same API requests in the same order, 0 changed pixels, the same saved data.
- **2.6.0 (ticket 04c):** Check for updates from GitHub Releases: signed `latest.json`, SHA-256 and size check, GitHub host allowlist, rename-and-replace with rollback, data backup before the first start of a new version, `cmd/release` for the owner, Settings → Updates on the page.
- **2.6.1 (tickets 04d, 04e):** the local API answers only the app's own page (Host check, Origin / Sec-Fetch-Site check on state-changing requests, JSON Content-Type on JSON routes). The Settings checkboxes are normal size again; deselecting (Esc, empty map, popup ×) also closes the task's row.
- **Roadmap (`docs/ROADMAP.md`):** tickets 01 → 10, one branch each. Progress is tracked in `docs/FEATURES.md` and below.

**References:**
- tarkov.dev: `the-hideout/tarkov-dev` (projection, map config), `the-hideout/tarkov-dev-svg-maps` (map art), `the-hideout/tarkov-api` (schema).
- TarkovMonitor: `tarkovtracker-org/TarkovMonitor` (GPL; formats only).
- json.tarkov.dev (data).
