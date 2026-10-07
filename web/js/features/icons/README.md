# Item icons on task markers (`web/js/features/icons/`)

The server side (download once, keep in `squad-task-map-icons/`, serve `/icons/<id>.webp`) is in
`internal/features/icons/README.md`.

**What it does (player's view):** where a task has you **place** something, the marker shows that
item instead of the category shape: the MS2000 on a "mark" spot, the camera or item on a "plant"
spot (Dandies' stashed items), a quest item on a quest-item spot. The icon sits in a rounded tile
whose **border keeps the category colour**. If other items would also do, a small "+" sits on the
tile's right edge. **⚙ Settings → Task markers** switches between item icons (default) and shapes.
The Bring list's thumbnails use the same pictures.

**Where the data comes from:** the objective in the game data (`/api/data`):
- `mark` → `marker` (`{id, name}`; MS2000 unless the data names another);
- `plantItem` → `items[0]` (`items.length > 1` means alternatives → "+");
- `plantQuestItem` → `qiId` (the quest item's id, added by the converter in ticket 07; `qi` stays
  the name). Game data converted before that has no `qiId`: those markers keep their shape until
  the next game-data download.
Everything else (visit, kill, hand-in, extract, gear…) keeps its shape. Only exact spots get an
icon (not "the item may be here" spots, not sub-task pins, not friends' markers).

**The rules** (`rules.js`):
- `markerIconItem(objective)`: the item above, or `null` for "keep the shape" (also when the id
  isn't 24 lower-case hex digits).
- `itemIconUrl(id)` is `/icons/<id>.webp`: this app, never assets.tarkov.dev from the browser.
- `showsItemIcons(saved)`: `saved.taskIcons !== false`.
- Drawing (`web/js/map/markers.js`, `drawItemIconSpot`): the tile is the shape's size plus 3 SVG
  units (a 64 px icon stays readable), drawn where the shape would be, so the badges keep their
  corners (! top left, floor top right, split bottom right, squad dots bottom left). Not-ready
  fading, selection scale and flash, popup and tap area are the marker's, unchanged. Nothing is
  animated.
- **Failure:** when the picture can't load (`error` event), the tile is replaced by the category
  shape and the address is remembered for the session, so redraws go straight to the shape. No
  broken image is ever shown. A failed load is not retried until the page is reloaded (and the
  server won't retry for 10 minutes).

**Flow:** `tasks/map-layer.js` `partMarkerItems` → `iconItemOfSpot` → `MarkerItem.iconItem` →
`map/markers.js` `drawMarker` → `<image href="/icons/<id>.webp">` → server (disk, or one download).

**Saved data / settings:** `taskIcons` in the page's saved data: `false` = shapes only; absent (the
default, and every file saved before the setting) = item icons. Like `squad` (ticket 05), the field
is written only when you change it, so older files load and save back unchanged (format version
stays 2; no migration step is needed, and `rules.test.js` checks that new, older and v1 files show
icons and gain no field). Set from the Settings dialog's Save (`settings/panel.js`).

**Files:**
- `rules.js`: the rules above.
- `rules.test.js`: tests (real tasks: A Fuel Matter, Dandies, Break the Deal, Health Care Privacy).
- Drawing: `web/js/map/markers.js`. Marker items: `web/js/features/tasks/map-layer.js`.

**Tests:** which objectives get which item; quest item with and without `qiId`; every other
objective keeps its shape; ids and addresses; the setting's default and migration. In the
browser suite (`tests/browser`): icon markers on Reserve and Streets, the fallback when icons are
missing, shapes mode. **Needs the owner:** are the tiles the right size on your screen, and do
the real quest items on assets.tarkov.dev have icons (this cloud session couldn't reach it)?
