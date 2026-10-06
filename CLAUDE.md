# Instructions for Claude Code

Project: **Squad Task Map, local edition.** It's a Windows desktop helper for Escape from Tarkov: a Go server that serves a map web page on 127.0.0.1 and compiles to one `.exe`. v2 is described in `docs/SPEC.md`; the work now follows `docs/ROADMAP.md` (tickets) and `docs/CODE-STYLE.md` (how code is written). Read `docs/HANDOFF.md` first.

## How to work
- Build **one ticket at a time**, in the order of `docs/ROADMAP.md`, one commit per ticket. Report after each one:
  - what changed
  - how you verified it
  - which checks need the owner in-game
  - any open question where you used the default
- **Don't change behavior the spec or ticket doesn't ask for.** If something seems wrong or missing, ask.
- Before writing types for game data, **fetch the real json.tarkov.dev files** and inspect them. Do the same for the game's log files and screenshot names: read the owner's real ones on this PC, and ask before reading folders outside this project. (Real samples, anonymised, are in `testdata/`.)
- TarkovMonitor is **GPL-3.0**. Read it for formats and behavior, but don't copy its code.
- Keep the **projection** (`makeProj`) exact. It's verified; any refactor must keep its tests passing.
- Never delete files outside this project except the two cases the spec allows: confirmed scan screenshots, and GPS screenshots from the raid that just ended.
- API keys stay server-side and are only sent to api.openai.com.

## Environment
- Windows, PowerShell, VS Code. Go 1.27 and Node 24 are portable installs in `E:\coding\toolchains` (`go\bin`, `node`), on the user PATH.
- Run: `go run .` (serves the page files from disk, so edits show on reload). Set `$env:STM_NO_BROWSER=1` to skip opening a browser and `$env:STM_DATA_DIR` for a scratch data folder.
- Test: `go test ./...` (server) and `npm test` (page logic, `node --test`).
- Build: `go build -trimpath -ldflags "-s -w" -o dist/SquadTaskMap.exe .` (icon and version info from `rsrc_windows_amd64.syso`, made from `winres/`).
- Use a scratch `STM_DATA_DIR` while developing, so the owner's real `squad-task-map-data.json` isn't touched.
- Offline stand-ins: `go run ./cmd/mock` (port 7820) fakes json.tarkov.dev, OpenAI and the wiki. Point the app at it with `STM_JSON_BASE`, `STM_OPENAI_API`, `STM_WIKI_API`; `STM_LOGS_DIR` and `STM_SCREENSHOTS_DIR` override the game folders.

## Layout
- Root: only `README.md` (GitHub landing page), `CLAUDE.md`, the Go entry files and build files. Docs live in `docs/` (`USER-GUIDE.md` is the player manual).
- `main.go`, `embed.go` (files built into the exe), `internal/app` (creates and connects every feature: read first).
- `internal/features/<name>/` (gamelog, raid, gps, taskscan, aicategorize, updates, …): one folder per feature, `rules.go` for the logic, a README each.
- `internal/` infrastructure: `httpapi` (routes), `events` (SSE + pending queue), `storage` (files next to the exe), `gamedata` (download/cache/convert), `gamefolders`, `screenshots`, `openai`.
- `web/js/`: `main.js` (start-up), `app/` (saved data, API, live-event router, types), `map/` (view, projection, layer order), `panel/` (panel shell), `features/<name>/` (`rules.js` + `*.test.js`, `panel.js`, `map-layer.js`, CSS, README). `web/css/base.css` holds the shared colour variables.
- `assets/`: map SVGs, `maps-config.json`, bundled game-data snapshot, fonts. `testdata/`: fixtures and v2 golden outputs. `cmd/mock`: offline stand-ins.
- `docs/FEATURES.md`: every feature with its Go package and page folder.

## Lightweight rules (the owner plays a CPU-bound game)
- No polling in the page. Live updates come over SSE.
- Continuous animation only as HTML over the map (`#fx` selection flash, `#findme-fx` pulse), animated with CSS `transform`/`opacity` only so the compositor runs it without repainting the map SVG. Don't animate SVG attributes or anything that repaints the map.
- Server timers: log poll 5 s (size check, read only new bytes), folder rescan 30 s, game-data check hourly. Screenshots use OS file notifications. Don't add faster timers.

## Conventions
- Follow `docs/CODE-STYLE.md`: readable over concise, rules separate from I/O, a README per feature, tests that read like the rules.
- Pure logic in DOM-free modules with tests (`node --test` for JS, `go test` for Go). UI in `web/js/`.
- Styling follows tarkov.dev (see existing CSS variables in `web/index.html`). Markers are fully opaque except the two cases in SPEC §7.3.
- Saved-state changes need a migration (SPEC §5.3, §12).

## Working with agents
- The main session is the **product manager**: it turns a ticket into a brief, hands it to an agent in `.claude/agents/`, reviews the report and diff, and only then merges to `main`.
- `backend-engineer` (Go: `internal/`, `cmd/`), `frontend-engineer` (`web/`), `qa-tester` (all test layers, `tests/browser/`, verdict before merge), `docs-writer` (README, user guide, handoff).
- Well-scoped work (one feature, clear acceptance checks) goes to a fast model (Sonnet). Behaviour-preserving refactors and security-sensitive code (self-update, signing) stay on the default model.
- Each agent works in its own git worktree on its own branch, commits early and keeps updating, so an interrupted agent loses nothing.
