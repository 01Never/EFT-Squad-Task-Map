# Squad Task Map: user guide

A single program that runs a Tarkov task map on your own PC. Nothing to install.

It shows the tasks you actually have on each map, split by kind of work, with what you need to bring. It keeps itself up to date from the game: it reads the game's log files (tasks you accept or finish) and your screenshots (your position, and your task list when you scan it).

## Run it
1. Unzip into its own folder, e.g. `Documents\SquadTaskMap`.
2. Double-click **SquadTaskMap.exe**. A console window opens and your browser goes to `http://127.0.0.1:7777`.
   - The first time, Windows SmartScreen may say "Windows protected your PC", because the program isn't code-signed. Click **More info → Run anyway**.
3. Keep the console window open while you play. Close it to stop.
   - Starting it again while it runs just opens the page of the running copy.

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
- Keys on the map's **My keys** list (next section) count as had on that map, raid after raid: their
  line says **On your key list ✓** instead of a count.

## Pins and extracts
- **📌** on a task row or map popup pins the task. **Pinned only** (panel and map toolbar) shows only pinned tasks everywhere, bring list included. **Clear pins** unpins all. Finished tasks unpin themselves.
- Extracts show faded. Click one on the map to mark it solid (an extract you have this raid); click again to unmark. Marked extracts decide the **closest extract** (see Your position). Marks clear after each raid (or **Clear marked**). The PMC / Scav / Shared / Transit chips choose which kinds show.

## Loot spots
For planning loot and Scav runs, the **Loot** section of the task list (click its heading to open
it) shows where containers and notable loose loot spawn, from tarkov.dev's map data.
- One chip per container type on this map (Safe, Weapon box, PC block, Jacket, Drawer = filing
  cabinet…) and one for **Loose loot** (keys, valuables, intel, electronics and similar), each with
  how many there are. Click a chip to show or hide those spots.
- **★ High value** shows safes, weapon boxes, PC blocks, tech supply crates, medcases, jackets,
  drawers and loose loot in one click (click it again to hide them). **None** hides all loot.
- Your choices are kept per map.
- On the map, loot shows as small dark tiles with a sign (**$** safe, **W** weapon box, **PC**,
  **J** jacket, **D** drawer, **L** loose loot…) and a floor badge like task markers. Where spots
  crowd together they share a round bubble with a count: click it to zoom in until they split.
  Click a spot to see what it is, its floor, and what can spawn there.
- Loot never selects a task and doesn't change the "!", the Bring list or your pins.
- The spots come with the game data download. With the built-in data (first start without
  internet) the section says so until the data is downloaded.

## My keys (the doors your keys open)
Most players bring the same keys to a map every raid. The **My keys** section of the task list
(click its heading; it shows how many keys, e.g. "My keys (5)") keeps that list per map.
- **Add key:** type part of a key's name ("dorm 314"). The search covers this map's keys: every
  key with a lock here and every key a task here needs, each with what it opens here
  ("2 doors", "1 trunk"). Tick **all keys** to find any key; one that opens nothing on this map
  says so.
- Each key on your list shows its picture, its name and what it opens here. Click the name to
  fly to its doors; **×** removes it (with **Undo**). **Copy from…** adds another map's keys that
  matter here (the rest are left out, and the message says how many). **Clear** empties the list
  (with Undo). The list is kept until you change it: **raid end doesn't reset it**.
- **On the map**, every door and trunk your keys open shows a tile in blue-violet with the key's
  picture, a floor badge, and ⚡ when it needs the power on. Where tarkov.dev has the door's
  outline (only a few doors on Factory and Ground Zero) it's drawn too. That's the door, never the
  room: the data has no room walls.
- **Click a door** for the key, the lock (door or trunk, floor, power), the tasks here that use the
  key, and the **loot nearby, approximate**: the loot spots within 8 m on the same floor, ringed on
  the map while the popup is open. A door whose key isn't on your list has **+ Add to my keys**.
- **All locked doors** also shows the doors for keys you don't have, dimmed, to help you decide
  which keys are worth bringing. Some doors on Customs, Interchange, Streets and Ground Zero show
  a **?** and "Unknown key (data incomplete)": tarkov.dev names a placeholder key for them.
- **Tasks:** a key on this map's list counts as had for the tasks here, so they don't show **!**
  for it, raid after raid, without touching the Bring list counts.
- **When a raid starts** on a map you have keys for, a message says "Bring your 5 keys for
  Customs"; **Show list** opens the list.

## Your position (GPS)
During a raid, Tarkov puts your position and facing in each screenshot's **file name**. When a new one appears, the app switches to the raid's map (setting **Follow my position**, on by default), draws your marker with a short trail, and brings it into view if it's off-screen (your zoom stays). The app reads the file name only, never the picture.

- **Your marker** is a coloured disc with a heading arrow inside a ring, labelled **You**, drawn above everything else. No task or extract uses its colour or shape.
- **Each new position pulses** with big expanding rings for about 20 seconds, so you spot the update. Then the marker sits still (no animation runs after that).
- **📍 Find me** (map toolbar) centres the map on you without changing the zoom, and pulses again. The **Show** button in the position bar does the same. Find me is greyed out until there's a position on this map.
- **When you're off-screen,** a chip on the edge of the map points toward you with the distance ("You · 240 m", straight line from the middle of the view). Click it to centre on you, keeping the zoom.
- The trail of your last few positions is drawn small and faint, so it doesn't compete with the marker.
- **Closest extract:** after each GPS screenshot, the closest of *your* extracts gets a ring, a dashed line from you with the distance ("~180 m", straight line, not the walking distance), and a "Closest: …" link in the position bar; click it to centre on that extract (zoom stays). "Your" extracts are the ones you marked on this map. With none marked, it picks the closest one the chips show and says "Closest shown"; transits only count once you mark them.

**Your extracts, read from a screenshot (needs an OpenAI key):** at the start of a raid, open Tarkov's extract list (double-tap **O**) and take a screenshot. A few seconds later the app marks your extracts on the map, as if you had clicked them: they turn solid, get an **AI** tag in the panel's list, and a toast says "Marked 4 extracts from your screenshot (1 not recognised: …)". Names it couldn't match are listed so you can mark them by hand. Requirement text (e.g. "Requires paracord") shows in the panel and when you hover the extract. Click a marked extract to unmark it, or mark more yourself. If the first screenshot doesn't show the list, the next ones are tried, up to 3 per raid; once a list is read, no more are sent. Marks clear at raid end. Turn it off in Settings.

When the raid ends, the app deletes that raid's GPS screenshots, resets your bring-list counts and clears extract marks.

You need a **screenshot key** bound in Tarkov's control settings. The app warns you if none is.

## Settings (⚙, top-right)
- **Game mode:** PvP, PvE or PvP Season. Picks the task data and which log events count. If the game reports a different mode, the top bar offers to switch.
- **Game logs folder:** found automatically from the launcher's install entry or Steam. Paste it if not, e.g. `C:\Battlestate Games\EFT\Logs`.
- **Screenshots folder:** `Documents\Escape From Tarkov\Screenshots`, found automatically even if OneDrive moved Documents.
- **Follow my position:** switch to the raid's map when a GPS screenshot comes in.
- **Center the map on me when I take a screenshot:** off by default. When on, every new position pans the map so you're in the middle, keeping your zoom, like a minimap. Same as **◎ Follow** on the map toolbar. If you're dragging the map when a screenshot comes in, it waits until you let go.
- **Task markers:** **Item icons** (default) or **Category shapes only**. With icons, a spot where you place something shows that item (an MS2000 marker, a camera, a quest item, the item to stash) in a tile with the category colour as its border. If an icon can't be loaded, the marker shows its shape instead.
- **Game data:** where it came from and **Update game data now**.
- **OpenAI:** key, model and reasoning level.
- **Read my extracts from my first raid screenshot:** only shown once you have an OpenAI key. On by default (after a one-time notice that explains what is sent). Untick it to stop sending that screenshot. See "Your extracts, read from a screenshot" below.
- **Updates:** the version you're on and **Check for updates** (see "Updating" below).

## Squad (see your friends' drawings and tasks)
Friends who run the app can see each other's **drawings** live and, if each chooses, each other's **tasks**. There is no website and no server: the copies connect directly over a private network built into the program. Your squad leader sets that up once (next section); you only paste an invite code.

**Join:** ⚙ Settings → **Squad**, paste the invite code, **Join**. It can take up to a minute and a half; if it fails the reason is shown. Once joined you see the status ("Connected · 3 of 4 friends online"), and can set **your name** and **your colour** (friends see your drawings in that colour) and turn **Share my tasks** and **Share my keys** on. Both are **off** by default. **Leave squad** (after a confirm) logs this PC out of the squad network and forgets your friends' data.

**Keys:** when a friend shares their keys, the doors their keys open show a dot in their colour (dimmed when you don't have the key yourself), the door's popup says "Mike has this key", and a task's key says "Sam has it" (in the task's details and on the Bring list).

**In the task list:** a **Squad** box with a chip per friend: a colour dot, their name, "online" or "last seen 2 h", and two switches:
- **✎ Draw**: show that friend's drawings on the map, in their colour, under your own. On by default. They are read-only.
- **☰ Tasks**: show that friend's tasks (only if they share them). Off by default.

With a friend's tasks on:
- A task you both have shows **Also: Mike, Sam** in the list and in the map popup, a small dot in each friend's colour at the bottom left of its markers, and each friend's progress in the popup ("Mike 2/5 · Sam ✓").
- **👥 Shared with squad** shows only those tasks, in the list and on the map.
- Tasks a friend has and you don't appear in a **Friends' tasks** block at the bottom of the list, and as smaller markers in their colour. They are only for looking: they never change your list, your Bring list or what is ready.

A friend who is offline still shows what they last shared, with "last seen". No position is shared: your friends never see where you are in a raid.

## Setting up a squad (once, for the squad leader)
The squad runs on a free **Tailscale** account (the Personal plan; non-commercial use). Friends install nothing extra.
1. Create a free Tailscale account at tailscale.com.
2. In **Access controls**, define the tag and allow squad copies to reach each other on port 7777 only:
   ```json
   {
     "tagOwners": { "tag:stm": ["autogroup:admin"] },
     "grants": [ { "src": ["tag:stm"], "dst": ["tag:stm"], "ip": ["tcp:7777"] } ]
   }
   ```
   Keep whatever else your policy has. If it uses `acls` instead of `grants`, the same rule is `{"action": "accept", "src": ["tag:stm"], "dst": ["tag:stm:7777"]}`.
3. **Settings → Keys → Generate auth key**: **reusable**, **pre-approved**, tag **`tag:stm`**, expiry 90 days or less. That key (`tskey-auth-…`) is your squad's **invite code**. Send it privately (a Discord DM), never in a public channel.
4. Each friend pastes it into **Settings → Squad → Join**. Devices stay joined after the key expires; a new key is only needed for new people. In the admin console's **Machines** list, check that **key expiry is disabled** for the squad machines, so nobody is logged out later.
5. To remove someone, delete their machine in the admin console. Their copy then says "Signed out of the squad network" until they leave and join again with a new code.

## Updating
When the owner publishes a new version, you update from inside the app. **Nothing happens unless you click:** the app never checks, downloads or installs by itself.
1. **⚙ Settings → Updates → Check for updates.** It says "You're up to date", or "2.7.0 is available" with what's new and the download size. After a check that found something, a small dot shows on **⚙ Settings** until you've updated.
2. **Download and restart**, then confirm. A progress bar shows the download (**Cancel** stops it and deletes the partial file).
3. The app checks the file is really the owner's (signature, size and SHA-256), makes a backup copy of your saved data, swaps the exe in and restarts. The page reloads by itself and shows **Updated to 2.7.0** with the release notes, once.

If something goes wrong (no internet, GitHub unreachable, no release yet, "This update isn't from the owner; not installed", a read-only folder) the message says so and **your current version keeps running with your data untouched**. If the folder can't be written to, the message links to the release page so you can download it by hand. If you run the program from source with `go run`, the check works but **Download and restart** is off ("Updates only apply to the built exe").

**Going back:** the old exe stays next to the new one as `SquadTaskMap.previous.exe`; close the app, rename the two files and start it. Your data before each update is kept as `squad-task-map-data.before-<version>.json` (the newest three).

## AI Categorize (OpenAI)
The **🤖 AI Categorize** box in the panel sorts parts by your instructions, e.g. "Make a Key runs category for parts that need a key on this map". It checks each task's objectives and its wiki page, proposes moves with reasons, and you pick which to apply. **Undo** reverts an applied batch.

**Setup:** **Add OpenAI key** and paste a key from platform.openai.com/api-keys (the account needs API credit). The default model is `gpt-5.4-mini`; Reasoning sets how hard it thinks.

## Privacy and cost
- Everything stays on your PC except:
  - Game data downloads from **json.tarkov.dev**.
  - Wiki pages from **escapefromtarkov.fandom.com** (AI Categorize).
  - Item icons from **assets.tarkov.dev**: the app downloads each icon once (on the first view) into `squad-task-map-icons/` and shows it from there afterwards; your browser never contacts assets.tarkov.dev itself. Only the 24-character item id is sent.
  - **github.com**, only when you click **Check for updates** (or Download and restart). The app contacts GitHub only when you click Check for updates.
  - Requests to **api.openai.com**: each scanned screenshot (shrunk to 2048 px); **the first in-raid screenshot of each raid** (also shrunk to 2048 px; up to 3 if the extract list wasn't on the first), so your extracts can be marked for you (Settings: "Read my extracts from my first raid screenshot", only with a key, you can turn it off); and for AI Categorize, task data plus wiki excerpts.
- OpenAI is billed to your key's account. A scan costs roughly 1–2k input tokens per screenshot; reading your extracts about 1–2k per raid; an AI Categorize request roughly 5–30k.
- The OpenAI key is stored in plain text in `squad-task-map-settings.json` next to the exe, and only sent to api.openai.com.
- **Squad (only if you join one):** your friends' copies get your **drawings** (all maps, every line) and your name and colour; your **active tasks with their ticks and progress** only if you turn **Share my tasks** on. Nothing else is shared: not your OpenAI key, folders, screenshots, settings, Bring list counts, categories, or your position. Only copies in your squad can connect (the network accepts only machines you let in with the invite code), and what a friend sends is only ever shown as drawings and text; it can't change your data. The data is encrypted between PCs. Tailscale can see that your PC is on its network and how it connects (it relays traffic through its own servers when two PCs can't connect directly, but it can't read it); log uploads to Tailscale are switched off in this program. If you never join a squad, none of this runs and nothing is sent.
- The program on 127.0.0.1 only answers its own page: only the app's own page can use it; other websites open in your browser can't.
- The app deletes only two kinds of files: screenshots you confirmed in a scan, and GPS screenshots from the raid that just ended.

## Light on your PC
While idle the program uses practically no CPU (measured 0.00% of one core over 2 minutes with the page open) and about 35 MB of memory. It checks the two log files every 5 seconds by comparing their size and reads only new lines (the same approach as TarkovMonitor). It watches the screenshots folder with the system's file-change events instead of polling. The page in your browser runs nothing in the background and updates only when something happens. The one exception is the flashing ring on a selected task: it's animated so the graphics card moves it without redrawing the map, and it stops when nothing is selected. Game data is checked once an hour and downloaded at most once a day.

## Files next to the exe
| File | What |
|---|---|
| `squad-task-map-data.json` | Your tasks, categories, ticks, pins, drawings (with a `.bak` of the previous save) |
| `squad-task-map-settings.json` | Settings and OpenAI key (including whether to read your extracts from the first raid screenshot) |
| `squad-task-map-gamedata-<mode>.json` | Downloaded game data per mode |
| `squad-task-map-pending.json` | Game events waiting for the page (usually empty) |
| `squad-task-map-wikicache.json` | Wiki pages, kept 7 days |
| `squad-task-map-icons/` | Item icons (one small `<id>.webp` each), downloaded once from assets.tarkov.dev. Safe to delete: they download again when needed |
| `squad-task-map-data.v1-backup.json` | Your v1 file, from the upgrade |
| `squad-task-map-data.before-<version>.json` | Your saved data as it was just before updating to that version (newest 3 kept) |
| `squad-task-map-squad.json` | Squad: your last share, and your friends' last shares with "last seen" (cleared by Leave squad) |
| `squad-task-map-tailscale/` | Squad network: this PC's key for the private network. **Keep it private.** Deleted by Leave squad |
| `SquadTaskMap.previous.exe` | The version you had before the last update, as a way back |

To back up or move to another PC, copy `squad-task-map-data.json` (and the settings file if you want the key).

## Credits
- Map art: Shebuka and contributors, the-hideout/tarkov-dev-svg-maps (CC BY-NC-SA 4.0; non-commercial use only).
- Map projection, palette and Bender font: the tarkov.dev project (the-hideout/tarkov-dev, MIT).
- Game data: tarkov.dev (community).
- Log and screenshot formats learned from TarkovMonitor (GPL-3.0); no code copied.
- Not affiliated with Battlestate Games.

Building from source and contributing: see the [README](../README.md).
