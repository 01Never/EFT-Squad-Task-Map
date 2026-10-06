# Tasks

**What it does (player's view):** your active tasks, sorted into categories (Boss hunts, PMC
kills, Mark, …) in the panel and drawn as markers on the map. A task with different kinds of work
is split into parts ("◫ part 1/2"), each in its own category. You can open a row to see its
objectives and tick them, pin tasks, move a part to another category, keep a task whole ("Don't
split"), add a task by name, remove one, and edit, reorder or delete categories. Clicking a row or
a marker selects the part: the row gets a white outline, its markers grow and flash, the popup
shows it.

**Where the data comes from:** the tasks themselves from the game data (`/api/data`, made by
`internal/gamedata` from json.tarkov.dev); your list, ticks, pins and category choices from the
saved data (`tasks`, `ticks`, `cats`, `collapsed`, `pinnedOnly`). Tasks are added by a scan
(`features/scan`), by the game log (event `task`), or by name.

**The rules** (`rules.js`, `categories.js`):
- Kind of work per objective (`actionOfObjective()`): kills are a boss hunt (a boss name in the
  targets or text), PMC kills (PMC/USEC/BEAR) or Scav kills; mark, plant, retrieve (find a quest
  item), go (visit, extract, use); hand-ins, builds, levels are "offmap".
- Splitting (`partsOfTask()`): one part per kind of work, in task order. A "hand over" joins the
  part that picks the item up; "survive and extract" joins the part before it. A task stays whole
  when it says "(In one raid)", when you ticked Don't split, or when it has one kind of work. A
  whole task takes the first kind in `WHOLE_TASK_ACTION_ORDER` (boss > pmc > scav > plant > mark >
  retrieve > go). Keys: `<task id>:*` whole, `<task id>:<kind>` split.
- Category of a part (`categoryOfPart()`): your choice for the part, else your v1 choice for the
  whole task (`"*"`), else the built-in category for its kind, else Unsorted. Only parts you moved
  are stored, so "Auto-sort" only re-creates deleted built-ins; "Re-sort everything" forgets every
  choice. Both have Undo (`snapshotCategories()` / `restoreCategories()`).
- Ticks (`tickCount()`, `isObjectiveDone()`): a saved `true` or a count; objectives with a count
  over 1 get − n/N +. A part is done (and leaves the map) when its required (non-optional)
  objectives are done; progress is the average of ticks / target.
- A task finished or failed in the game leaves the list quietly, unpinned, ticks cleared,
  categories and sub-tasks kept (`finishTaskEntry()`). A task a scan doesn't show is forgotten
  completely (`forgetTask()`).
- New categories go just before Unsorted and take the next colour of `NEW_CATEGORY_COLORS` and the
  next marker shape.

**Flow:**
- A click in the list: `panel/panel.js` (router) → `TASK_ROW_ACTIONS` / `CATEGORY_ACTIONS` here →
  change the saved data → `save()` → `renderMapPage()` (or `renderPanel()` when only the list changes).
- Ticking: `objective-line.js onTickBoxChanged()` → `task-list.js setTick()` (also takes a marker
  out of the bag, see `features/readiness`) → save → redraw.
- Game log: event `task` → `app/live-events.js onTaskChangedInGame()` → `activateTask()` /
  `finishTask()` → save → redraw.
- Selecting: a row → `selection.js selectPartFromList()` (zooms to its spots); a marker →
  `map/input.js` → `selectPartFromMarker()` (scrolls the list).

**Saved data / settings:** `tasks{id: {active, source, addedAt, gamePct, scannedAt, noSplit,
pinned, partCats}}`, `ticks`, `cats`, `collapsed`, `pinnedOnly`. No settings.

**Files:**
- `rules.js`: kind of work, splitting, maps, ticks and progress, adding/finishing/forgetting.
- `categories.js`: the built-in categories and every category change.
- `task-list.js`: your list as the page reads it (active tasks, parts on a map, `setTick()`).
- `panel.js`: a task row and its open details, Add a task by name, pins; their handlers.
- `category-panel.js`: list tools, categories with their ⋯ menu, Done lists; their handlers.
- `objective-line.js`: an objective line with its tick control (list and popup).
- `map-layer.js`: markers and zones of the shown parts, the selected part's flash.
- `popup.js`: the popup for the selected part.
- `selection.js`: selecting and deselecting a part.
- `tasks.css`: styles.

**Tests:** `rules.test.js` (kinds of kills, splitting on real tasks, glue rules, "(In one raid)",
Don't split, progress, finishing and forgetting) and `categories.test.js` (default category,
moved part, deleted built-in, re-sort and undo). The browser suite (`tests/browser/task-list.e2e.mjs`)
covers adding by name, ticking, pins, Move to, Re-sort + Undo, Don't split and selection.
**Needs an in-game check:** nothing new in 04b.
