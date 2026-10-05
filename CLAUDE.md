# Instructions for Claude Code

Project: **Squad Task Map, local edition.** It's a Windows desktop helper for Escape from Tarkov: a Bun server that serves a map web page on 127.0.0.1 and compiles to one `.exe`. The owner is building **v2**. The full plan is in `SPEC.md`; read all of it before changing code.

## How to work
- Build **one milestone at a time**, in the order of SPEC §14. Stop after each one and report:
  - what changed
  - how you verified it
  - which checks need the owner in-game
  - any open question from SPEC §15 where you used the default
- **Don't change behavior the spec doesn't ask for.** If something seems wrong or missing, ask.
- Before writing types for game data, **fetch the real json.tarkov.dev files** and inspect them (SPEC §4.1). Do the same for the game's log files and screenshot names: read the owner's real ones on this PC (SPEC §9–10), and ask before reading folders outside this project.
- TarkovMonitor is **GPL-3.0**. Read it for formats and behavior, but don't copy its code.
- Keep the **projection** (`makeProj`) exact. It's verified; any refactor must keep its tests passing.
- Never delete files outside this project except the two cases the spec allows: confirmed scan screenshots, and GPS screenshots from the raid that just ended.
- API keys stay server-side and are only sent to api.openai.com.

## Environment
- Windows, PowerShell, VS Code. Bun is the runtime, bundler and test runner.
- Run: `bun run dev` (bundles `web/js/` to `web/dist/app.js`, then runs `server/main.ts`). Set `$env:STM_NO_BROWSER=1` to skip opening a browser and `$env:STM_DATA_DIR` for a scratch data folder.
- Test: `bun test` (unit tests in `tests/`).
- Build: `bun run build` → `dist/SquadTaskMap.exe`.
- Use a scratch `STM_DATA_DIR` while developing, so the owner's real `squad-task-map-data.json` isn't touched.
- Offline stand-ins: `bun tests/mock-server.ts` (port 7820) fakes json.tarkov.dev, OpenAI and the wiki. Point the app at it with `STM_JSON_BASE`, `STM_OPENAI_API`, `STM_WIKI_API`; `STM_LOGS_DIR` and `STM_SCREENSHOTS_DIR` override the game folders.

## Layout
- `server/`: `main.ts` (routes, raid state), `gamedata.ts` (download/cache/fallback), `convert.ts` (json.tarkov.dev → internal format), `logs.ts` + `logparse.ts` (log watcher), `screens.ts` + `gpsname.ts` (screenshots: scan capture, GPS), `ai.ts` (OpenAI), `store.ts`, `events.ts` (SSE + pending queue), `paths.ts`.
- `web/js/logic/`: DOM-free logic with tests (projection, parts, readiness, state/migration, matching, simplify).
- `web/js/`: UI modules (map, panel, ai, scan, settings, live, picker, store, util).
- `assets/`: map SVGs, `maps-config.json`, bundled game-data snapshot, fonts.

## Lightweight rules (the owner plays a CPU-bound game)
- No polling in the page. Live updates come over SSE.
- The only continuous animation is the selected-task flash: HTML rings over the map (`#fx`), animated with CSS `transform`/`opacity` only so the compositor runs it without repainting the map SVG. Don't animate SVG attributes or anything that repaints the map.
- Server timers: log poll 5 s (size check, read only new bytes), folder rescan 30 s, game-data check hourly. Screenshots use `fs.watch`. Don't add faster timers.

## Conventions
- Pure logic in DOM-free modules with `bun test` coverage. UI in `web/js/`.
- Styling follows tarkov.dev (see existing CSS variables in `web/index.html`). Markers are fully opaque except the two cases in SPEC §7.3.
- Saved-state changes need a migration (SPEC §5.3, §12).
