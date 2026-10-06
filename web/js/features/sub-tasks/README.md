# Sub-tasks

**What it does (player's view):** your own notes under a task ("bring a flashlight", "stash is
behind the blue door"), each with a done box. A note can be pinned on a map with a floor badge:
"Pin" (or "Move pin"), then click the map. Pins are drawn like the task's markers, smaller, with a
white dot; a done one gets a tick.

**Where the data comes from:** the saved data (`subs`). Nothing from the game.

**The rules** (`rules.js`):
- A new sub-task isn't done and isn't pinned (`newSubTask()`); text up to `SUB_TASK_MAX_LENGTH` = 140.
- Floor badges: ground ("G"), 2, 3, 4, 5, B (`SUB_TASK_FLOOR_OPTIONS`).
- Seen from the open map, a pin is "here", "elsewhere" (then the note says "pinned on Customs") or
  "none" (`pinPlace()`).
- A pin shows only while its task has a part shown on the map, and takes that part's category look
  (`map-layer.js subTaskMarkerItems()`).
- Selecting a task also zooms to its pins on this map (`subTaskPinPoints()`).

**Flow:** "Pin" → `panel.js onPinClicked()` → map mode "place" (hint at the bottom, Esc cancels) →
a click on the map → `map/input.js` → `placeSubTaskPinAt()` (game position, 2 decimals) → save →
`renderMapPage()`.

**Saved data / settings:** `subs[{id, task, text, done, map, x, z, f}]`. No settings.

**Files:**
- `rules.js`: new sub-task, unpinning, where a pin is.
- `panel.js`: the "Sub-tasks" box of an open task row; its handlers.
- `map-layer.js`: the pins as marker items; placing a pin.
- `sub-tasks.css`: styles.

**Tests:** `rules.test.js` (a new sub-task, here / elsewhere / none, unpinning). Not covered by the
browser suite; checked by hand in 04b. **Needs an in-game check:** nothing.
