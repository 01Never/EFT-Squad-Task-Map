# Map picker

**What it does (player's view):** the start page: a card per map with a small picture and how many
of your tasks have work left there, 📷 Scan tasks, a banner after moving from v1 (or when your
list is empty), and a folded list of your tasks that aren't on any map card.

**Where the data comes from:** the maps in `assets/maps-config.json` (`/api/config`), the map art
(`/maps/<file>`), your active tasks and ticks.

**The rules** (`rules.js`):
- A card counts your tasks with a part on that map that isn't done (`countTasksPerMap()`).
- Not on a card (`tasksNotOnAMapCard()`): hand-in and build tasks with nothing on a map (sorted by
  name), and tasks only on maps this app has no art for (Labs, Labyrinth). Their found-in-raid
  items still appear in every map's Bring list.

**Flow:** the address `#/` (or an unknown map) → `app/routing.js` → `showPicker()`. Each card's
picture loads the map art once (`map/map-art.js`) and keeps only its base layer.

**Saved data / settings:** clears `showScanBanner` (Dismiss). No settings.

**Files:**
- `rules.js`: the counts and the tasks without a card.
- `panel.js`: the picker page.
- `picker.css`: styles.

**Tests:** `rules.test.js` (a count per map, done parts don't count, hand-ins vs other maps). The
browser suite checks the counts on every map and the "not shown on a map" list. **Needs an
in-game check:** nothing.
