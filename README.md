# Squad Task Map

**A Tarkov task map that runs on your own PC and keeps itself in sync with the game.**

Squad Task Map is a small Windows program for Escape from Tarkov. It shows the tasks you actually have on each map, split by kind of work (boss hunts, kills, placing, retrieving…), with what you need to bring. It follows the game while you play: it reads Tarkov's log files and screenshot names, so accepted and finished tasks update by themselves and your position shows on the map.

- One `.exe`, about 28 MB. Nothing to install, no account.
- The map page opens in your browser at `http://127.0.0.1:7777` and only listens on your own PC.
- It's built to stay light next to a CPU-bound game: idle CPU is practically zero.

![Customs with nine tasks, your position and the closest extract](docs/images/map-and-tasks.png)

## Download

Get the latest `SquadTaskMap.exe` from **[Releases](https://github.com/01Never/EFT-Squad-Task-Map/releases/latest)**. Put it in its own folder (for example `Documents\SquadTaskMap`) and double-click it.

Windows SmartScreen may say "Windows protected your PC" the first time, because the program isn't code-signed. Click **More info → Run anyway**.

## The pages

Three steps, like the game's own menus: pick a game mode, then a map, then work on the map. The links in the top bar (`PvP Season / Maps / Customs`) take you back a step at any time.

**1. Game mode** (the home page). In Tarkov, PvE, PvP and PvP Season are separate characters, so each has its own task list. Each card shows how many tasks that mode has, which one you used last, and which mode the game is in right now.

![The game mode page: PvE, PvP and PvP Season cards with their task counts](docs/images/game-mode.png)

**2. Maps.** Every map, with how many of that mode's tasks are on it. **Scan tasks** is here too.

![The map picker for PvP Season: every map with how many of your tasks are on it](docs/images/map-picker.png)

**3. A map.** Your task markers, extracts and place names on the left; your tasks, the Bring list and the map's settings in the panel on the right.

![Customs in PvP Season: task markers on the map and the task panel](docs/images/map-customs.png)

On a phone the map sits above the list, and a single "‹ Maps" link replaces the trail at the top.

<img src="docs/images/phone-map.png" alt="Customs on a phone: the map above the task list, with a ‹ Maps link" width="300">

## What it does

### Your tasks, per map
Each game mode keeps its own task list. On a map, see a marker for every objective of the tasks you have, grouped into categories (boss hunts, kills, placing, retrieving…) that you can rename, recolour and reorder. Tasks you accept or finish in-game are added or removed within seconds, from the game's log files, in the list of the mode you're playing. Where you have to place something, the marker shows the item's icon.

Click a marker or a row to select a task: its spots flash on the map, and the popup and the list show every objective with ticks and counters, the wiki link, sub-tasks and pins.

![A selected task with its popup and details](docs/images/task-selected.png)

### Where you are, and your way out
Tarkov puts your position and facing in each screenshot's file name. Take a screenshot in raid and your marker appears with a short pulse; an off-screen pointer brings you back, and **Follow** keeps the map centred on you. The closest of your extracts gets a ring and a thin line with the distance. Open the in-game extract list (double-tap O) before that screenshot and, with an OpenAI key, the app reads it and marks your extracts for you.

![Your position and the closest extract](docs/images/find-me-closest-extract.png)

### Bring list
The keys, items to place and gear the tasks on the map need. Set how many you have; spots you can't do yet fade and get a "!".

<img src="docs/images/bring-list.png" alt="The Bring list" width="420">

### Loot spots
Safes, weapon boxes, PC blocks, jackets, filing cabinets and notable loose loot from tarkov.dev, per type or with one **High value** click. Small and secondary to your task markers.

![Customs with the High value loot spots on](docs/images/loot.png)

### Squad
Join friends with an invite code: a private Tailscale network is built into the exe, nothing else to install. See each other's drawings live, each other's last position in a raid, and each other's tasks with "Also: Alice" and progress on the tasks you share.

![A friend's drawing in their colour, and "Also: Alice" on a shared task](docs/images/squad.png)

### And more
- **Scan your task list:** screenshot the in-game Tasks screen, in the menus or in a raid, and an OpenAI vision model reads it, so your list matches the game exactly (optional, your own API key).
- **AI Categorize:** sort tasks by plain-English instructions, checked against each task's wiki page (optional). The default AI model is `gpt-6-luna`; you can pick another in Settings (see the [user guide](docs/USER-GUIDE.md#ai-categorize-openai)).
- **Draw** on the map, **pin** tasks, add **sub-tasks**, and switch between game modes (PvP, PvE, PvP Season), each with its own task list.
- **Check for updates** in Settings: signed releases from this repo, installed with one click.

The full manual is the **[user guide](docs/USER-GUIDE.md)**: setup, every feature, settings, privacy, and the files the app keeps next to the exe.

## Privacy

The app contacts GitHub only when you click Check for updates. If you join a squad, your drawings, your last in-raid position and your active tasks (the last two are on by default and can be switched off in Settings → Squad) go directly to your friends' copies over a private Tailscale network; Tailscale relays traffic when two PCs can't connect directly but can't read it. Never joined, nothing of this runs. Everything else stays on your PC except downloads of game data (json.tarkov.dev), item icons (assets.tarkov.dev), wiki pages for AI Categorize, and, only if you add a key, requests to api.openai.com (the task scan's screenshots, AI Categorize, and **the first in-raid screenshot of each raid** so your extracts can be marked for you; that one can be turned off in Settings). Your OpenAI key stays in the settings file on your PC and is sent nowhere else. The app deletes only screenshots you confirmed in a scan, and the GPS screenshots of the raid that just ended.

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
- The Labyrinth's map art: the map images from [tarkov.dev](https://tarkov.dev) (the-hideout/tarkov-dev, MIT project), stitched from their map tiles.
- Map projection, palette and Bender font: the [tarkov.dev](https://github.com/the-hideout/tarkov-dev) project (MIT).
- Game data: tarkov.dev (community).
- Log and screenshot formats learned from TarkovMonitor (GPL-3.0); no code copied.
- Not affiliated with Battlestate Games.
