# Squad Task Map

**A Tarkov task map that runs on your own PC and keeps itself in sync with the game.**

Squad Task Map is a small Windows program for Escape from Tarkov. It shows the tasks you actually have on each map, split by kind of work (boss hunts, kills, placing, retrieving…), with what you need to bring. It follows the game while you play: it reads Tarkov's log files and screenshot names, so accepted and finished tasks update by themselves and your position shows on the map.

- One `.exe`, about 28 MB. Nothing to install, no account.
- The map page opens in your browser at `http://127.0.0.1:7777` and only listens on your own PC.
- It's built to stay light next to a CPU-bound game: idle CPU is practically zero.

## Download

Get the latest `SquadTaskMap.exe` from **[Releases](https://github.com/01Never/EFT-Squad-Task-Map/releases/latest)**. Put it in its own folder (for example `Documents\SquadTaskMap`) and double-click it.

Windows SmartScreen may say "Windows protected your PC" the first time, because the program isn't code-signed. Click **More info → Run anyway**.

## What it does

| | |
|---|---|
| **Your tasks, per map** | Markers for every objective of the tasks you have, grouped into categories you can rename, recolour and reorder. |
| **Synced from the game** | Tasks you accept or finish in-game are added or removed within seconds, from the game's log files. |
| **Your extracts, marked for you** | Open the in-game extract list (double-tap O) and take a screenshot: an OpenAI vision model reads it and marks your extracts on the map (optional, uses your own API key). |
| **Scan your task list** | Screenshot the in-game Tasks screen and an OpenAI vision model reads it, so your list matches the game exactly (optional, uses your own API key). |
| **Find me** | Your position and facing come from Tarkov's screenshot file names: a stand-out marker, a pulse when it updates, an off-screen pointer, optional auto-centre. |
| **Closest extract** | The nearest of the extracts you have this raid, with a line and a straight-line distance. |
| **Loot spots** | Safes, weapon boxes, PC blocks, jackets, filing cabinets and notable loose loot from tarkov.dev, toggled per type, with a "High value" preset. Small and secondary to your task markers. |
| **My keys** | Your usual keys per map: the doors and trunks they open light up on the map, with the tasks that use each key and the loot likely behind it. Keys on the list count as had for tasks, raid after raid. |
| **Bring list** | The keys, items to place and gear the tasks on the map need, with "have" counts that fade spots you can't do yet. |
| **Squad** | Join friends with an invite code (private Tailscale network built into the exe, nothing else to install) and see each other's drawings live and, if you both choose, each other's tasks with "Also: Mike" badges and key lists ("Mike has this key"). Optional. |
| **AI Categorize** | Sort tasks by plain-English instructions, checked against each task's wiki page (optional). |

The full manual is the **[user guide](docs/USER-GUIDE.md)**: setup, every feature, settings, privacy, and the files the app keeps next to the exe.

## Privacy

The app contacts GitHub only when you click Check for updates. If you join a squad, your drawings (and your tasks, only if you turn that on) go directly to your friends' copies over a private Tailscale network; Tailscale relays traffic when two PCs can't connect directly but can't read it. Never joined, nothing of this runs. Everything else stays on your PC except downloads of game data (json.tarkov.dev), item icons (assets.tarkov.dev), wiki pages for AI Categorize, and, only if you add a key, requests to api.openai.com (the task scan's screenshots, AI Categorize, and **the first in-raid screenshot of each raid** so your extracts can be marked for you; that one can be turned off in Settings). Your OpenAI key stays in the settings file on your PC and is sent nowhere else. The app deletes only screenshots you confirmed in a scan, and the GPS screenshots of the raid that just ended.

## Building from source

The server is Go and the page is plain JavaScript modules with no bundler. You need Go 1.27+, and Node 24+ for the page tests.

```powershell
go run .                    # run from source; page edits show on reload
go test ./...               # server tests
npm test                    # page logic tests
npm run test:browser        # end-to-end browser suite (see tests/browser/README.md)
go build -trimpath -ldflags "-s -w" -o dist/SquadTaskMap.exe .
```

The icon and version info come from `rsrc_windows_amd64.syso`, made from `winres/` with `go-winres make --arch amd64 --out rsrc`.

**Offline development:** `go run ./cmd/mock` serves stand-ins for json.tarkov.dev, OpenAI and the wiki on port 7820. Point the app at it with `STM_JSON_BASE=http://127.0.0.1:7820`, `STM_OPENAI_API=http://127.0.0.1:7820/v1` and `STM_WIKI_API=http://127.0.0.1:7820/wiki`. Use a scratch `STM_DATA_DIR` so your real data isn't touched. Other variables: `STM_LOGS_DIR`, `STM_SCREENSHOTS_DIR`, `STM_NO_BROWSER=1`, `PORT`, `STM_ASSETS_DIR`.

### Where to start reading

| Path | What |
|---|---|
| `internal/app/app.go` | How every part connects. Read this first. |
| `internal/features/<name>/` | One Go package per feature, with `rules.go` and a README. |
| `web/js/` | The page. `web/js/features/<name>/` holds the newer features. |
| `cmd/mock/` | Offline stand-ins for the web services. |
| `docs/FEATURES.md` | Every feature with its Go package and page folder. |
| `docs/ROADMAP.md` | The tickets being built, in order. |
| `docs/CODE-STYLE.md` | How code is written here. |
| `docs/HANDOFF.md`, `docs/SPEC.md` | Developer handoff and the v2 design. |
| `.claude/agents/` | Role briefs for the Claude Code agents that work on this repo. |

## Credits

- Map art: Shebuka and contributors, [the-hideout/tarkov-dev-svg-maps](https://github.com/the-hideout/tarkov-dev-svg-maps) (CC BY-NC-SA 4.0; non-commercial use only).
- Map projection, palette and Bender font: the [tarkov.dev](https://github.com/the-hideout/tarkov-dev) project (MIT).
- Game data: tarkov.dev (community).
- Log and screenshot formats learned from TarkovMonitor (GPL-3.0); no code copied.
- Not affiliated with Battlestate Games.
