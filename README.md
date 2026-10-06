# Squad Task Map v2 (local edition)

A single program that runs a Tarkov task map on your own PC. Nothing to install.

It shows the tasks you actually have on each map, split by kind of work, with what you need to bring. It keeps itself up to date from the game: it reads the game's log files (tasks you accept or finish) and your screenshots (your position, and your task list when you scan it).

## Run it
1. Unzip into its own folder, e.g. `Documents\SquadTaskMap`.
2. Double-click **SquadTaskMap.exe**. A console window opens and your browser goes to `http://127.0.0.1:7777`.
   - The first time, Windows SmartScreen may say "Windows protected your PC", because the program isn't code-signed. Click **More info → Run anyway**.
3. Keep the console window open while you play. Close it to stop.

The site only listens on your own PC (127.0.0.1). Nobody else on your network can open it.

### Upgrading from v1
Put the new exe in the same folder as the old one, next to your `squad-task-map-data.json`. On first start:
- A copy of your old file is saved as `squad-task-map-data.v1-backup.json`.
- Tasks on your manual list become your active tasks.
- Your own categories (and AI-made ones) are kept, with their tasks. The old built-in categories are replaced by the new defaults (below).
- Sub-tasks, drawings and per-map settings are kept.
- TarkovTracker is gone; its token in `squad-task-map-settings.json` is ignored.

A banner suggests running **Scan tasks** once, so the list matches exactly what you have in-game.

## Where your tasks come from
1. **Scan tasks** (button on the map picker and in the panel). Needs an OpenAI key (see below).
   1. Click **📷 Scan tasks**. The app starts watching your screenshots folder.
   2. In Tarkov, open **Tasks** and press your screenshot key on each page, scrolling between shots. STORY, SIDE and OPERATIONAL all work.
   3. Back in the app, the captured shots show as thumbnails (× drops one). Click **Done**.
   4. The model reads the task names; the app matches them to the game data and shows a review: new tasks (with how many land on each map), hand-in-only tasks, tasks already on your list, and names it couldn't match (type the right name, or leave blank to skip).
   5. **Update list & delete screenshots** makes your list match the scan: new tasks are added, and any task on your list that isn't in the screenshots is removed completely (its categories, pin, ticks and sub-tasks go too). Then it deletes those screenshot files. **Capture every page**, or tasks on a missed page are dropped. If a screenshot couldn't be read, or no task names were recognised, nothing is removed and the button says **Add tasks** instead. **Cancel** changes nothing and deletes nothing.
2. **The game's logs.** While the app runs, a task you accept in-game is added within about 5 seconds. A task you finish or fail is removed quietly. Only events from the game mode you picked in Settings count. Events that happen while the app is closed are not caught up; scan again to catch up.
3. **Add a task by name** (search box in the panel).

**Remove task** in a task's details takes it off by hand.

## Parts and categories
Tasks that mix kinds of work are split into **parts**, and each part goes in its own category. For example, Dandies is "kills" (Scav / any kills) plus "placing" (Plant / stash). A split row shows **◫ part 1/2**. Tasks marked "(In one raid)" are never split, and **Don't split** in a task's details keeps one whole.

Default categories: **Boss hunts, PMC kills, Scav / any kills, Mark, Plant / stash, Retrieve, Scout & extract, Unsorted.** New parts land in their default automatically.
- **Move to** in a part's details puts it somewhere else. That choice sticks.
- **⇅ Auto-sort → Auto-sort** re-creates any default category you deleted and sorts the parts you haven't moved.
- **⇅ Auto-sort → Re-sort everything** also undoes your moves and AI choices (asks first; Undo right after).
- You can still create, rename, recolour and delete categories, and click a heading to show or hide its tasks on the map.

## Finding things on the map
- Click a marker and its task opens in the list, outlined in white and scrolled into view. Click a task in the list and the map zooms to it.
- The selected task's markers keep flashing (a white ring) until you pick another task, click an empty spot on the map, close the popup or press **Esc**.
- **Hide ▸** (top of the list) gives the map the whole window, handy with the map on half the screen. **◂ Tasks** (top-right of the map) brings the list back. The map keeps its zoom either way. Clicking a marker while the list is hidden still shows the task in the popup.

## Ticking things off
Each objective has a checkbox, or −/+ for counted ones (kills, items). Ticks are yours: the game doesn't tick them. A finished part drops off the map and goes to the category's **Done** list.

## Bring list and the "!"
The **Bring list** tab lists what the tasks currently shown on the map need: keys, items to place (markers, items to stash), gear to wear or use, and found-in-raid items (info only, including hand-in-only tasks). Set **have** for each with −/+ or by typing.
- A task's spot is "possible" when you have at least 1 of each thing it still needs. With 2 markers and 5 spots to mark, all 5 count as possible.
- When you have none of something, those spots get a **"!"** and fade, and their zones get dotted borders.
- Ticking a marker or placed-item objective takes 1 off "have" (unticking gives it back).
- All counts reset to 0 after each raid. **Reset counts** clears them by hand.

## Pins and extracts
- **📌** on a task row or map popup pins the task. **Pinned only** (panel and map toolbar) shows only pinned tasks everywhere, bring list included. **Clear pins** unpins all. Finished tasks unpin themselves.
- Extracts show faded. Click one on the map to mark it solid (an extract you have this raid); click again to unmark. Marked extracts decide the **closest extract** (see Your position). Marks clear after each raid (or **Clear marked**). The PMC / Scav / Shared / Transit chips choose which kinds show.

## Your position (GPS)
During a raid, Tarkov puts your position and facing in each screenshot's **file name**. When a new one appears, the app switches to the raid's map (setting **Follow my position**, on by default), draws your marker with a short trail, and brings it into view if it's off-screen (your zoom stays). The app reads the file name only, never the picture.

- **Your marker** is a coloured disc with a heading arrow inside a ring, labelled **You**, drawn above everything else. No task or extract uses its colour or shape.
- **Each new position pulses** with big expanding rings for about 20 seconds, so you spot the update. Then the marker sits still (no animation runs after that).
- **📍 Find me** (map toolbar) centres the map on you without changing the zoom, and pulses again. The **Show** button in the position bar does the same. Find me is greyed out until there's a position on this map.
- **When you're off-screen,** a chip on the edge of the map points toward you with the distance ("You · 240 m", straight line from the middle of the view). Click it to centre on you, keeping the zoom.
- The trail of your last few positions is drawn small and faint, so it doesn't compete with the marker.
- **Closest extract:** after each GPS screenshot, the closest of *your* extracts gets a ring, a dashed line from you with the distance ("~180 m", straight line, not the walking distance), and a "Closest: …" link in the position bar; click it to centre on that extract (zoom stays). "Your" extracts are the ones you marked on this map. With none marked, it picks the closest one the chips show and says "Closest shown"; transits only count once you mark them.

When the raid ends, the app deletes that raid's GPS screenshots, resets your bring-list counts and clears extract marks.

You need a **screenshot key** bound in Tarkov's control settings. The app warns you if none is.

## Settings (⚙, top-right)
- **Game mode:** PvP, PvE or PvP Season. Picks the task data and which log events count. If the game reports a different mode, the top bar offers to switch.
- **Game logs folder:** found automatically from the launcher's install entry or Steam. Paste it if not, e.g. `C:\Battlestate Games\EFT\Logs`.
- **Screenshots folder:** `Documents\Escape From Tarkov\Screenshots`, found automatically even if OneDrive moved Documents.
- **Follow my position:** switch to the raid's map when a GPS screenshot comes in.
- **Center the map on me when I take a screenshot:** off by default. When on, every new position pans the map so you're in the middle, keeping your zoom, like a minimap. Same as **◎ Follow** on the map toolbar. If you're dragging the map when a screenshot comes in, it waits until you let go.
- **Game data:** where it came from and **Update game data now**.
- **OpenAI:** key, model and reasoning level.

## AI Categorize (OpenAI)
The **🤖 AI Categorize** box in the panel sorts parts by your instructions, e.g. "Make a Key runs category for parts that need a key on this map". It checks each task's objectives and its wiki page, proposes moves with reasons, and you pick which to apply. **Undo** reverts an applied batch.

**Setup:** **Add OpenAI key** and paste a key from platform.openai.com/api-keys (the account needs API credit). The default model is `gpt-5.4-mini`; Reasoning sets how hard it thinks.

## Privacy and cost
- Everything stays on your PC except:
  - Game data downloads from **json.tarkov.dev**.
  - Wiki pages from **escapefromtarkov.fandom.com** (AI Categorize).
  - Item icons from **assets.tarkov.dev**.
  - Requests to **api.openai.com**: each scanned screenshot (shrunk to 2048 px), and for AI Categorize, task data plus wiki excerpts.
- OpenAI is billed to your key's account. A scan costs roughly 1–2k input tokens per screenshot; an AI Categorize request roughly 5–30k.
- The OpenAI key is stored in plain text in `squad-task-map-settings.json` next to the exe, and only sent to api.openai.com.
- The app deletes only two kinds of files: screenshots you confirmed in a scan, and GPS screenshots from the raid that just ended.

## Light on your PC
While idle the program uses about 0.2% of one CPU core and about 100 MB of memory. It checks the two log files every 5 seconds by comparing their size and reads only new lines (the same approach as TarkovMonitor). It watches the screenshots folder with the system's file-change events instead of polling. The page in your browser runs nothing in the background and updates only when something happens. The one exception is the flashing ring on a selected task: it's animated so the graphics card moves it without redrawing the map, and it stops when nothing is selected. Game data is checked once an hour and downloaded at most once a day.

## Files next to the exe
| File | What |
|---|---|
| `squad-task-map-data.json` | Your tasks, categories, ticks, pins, drawings (with a `.bak` of the previous save) |
| `squad-task-map-settings.json` | Settings and OpenAI key |
| `squad-task-map-gamedata-<mode>.json` | Downloaded game data per mode |
| `squad-task-map-pending.json` | Game events waiting for the page (usually empty) |
| `squad-task-map-wikicache.json` | Wiki pages, kept 7 days |
| `squad-task-map-data.v1-backup.json` | Your v1 file, from the upgrade |

To back up or move to another PC, copy `squad-task-map-data.json` (and the settings file if you want the key).

## Credits
- Map art: Shebuka and contributors, the-hideout/tarkov-dev-svg-maps (CC BY-NC-SA 4.0; non-commercial use only).
- Map projection, palette and Bender font: the tarkov.dev project (the-hideout/tarkov-dev, MIT).
- Game data: tarkov.dev (community).
- Log and screenshot formats learned from TarkovMonitor (GPL-3.0); no code copied.
- Not affiliated with Battlestate Games.

## Building from source
Install Bun (https://bun.sh), then in this folder:
- `bun run dev`: build the page and run the server.
- `bun test`: unit tests.
- `bun run build`: Windows exe at `dist/SquadTaskMap.exe`.

The page is written as ES modules in `web/js/`, bundled to one `web/dist/app.js` with Bun's bundler, and embedded in the exe with `import … with { type: "text" }`, like the map SVGs and fonts. That keeps the exe a single file, and the bundle step is the same on every OS.

**Offline development:** `bun tests/mock-server.ts` serves stand-ins for json.tarkov.dev, OpenAI and the wiki on port 7820. Point the app at it with `STM_JSON_BASE=http://127.0.0.1:7820`, `STM_OPENAI_API=http://127.0.0.1:7820/v1`, `STM_WIKI_API=http://127.0.0.1:7820/wiki`. Other variables: `STM_DATA_DIR`, `STM_LOGS_DIR`, `STM_SCREENSHOTS_DIR`, `STM_NO_BROWSER=1`, `PORT`.
