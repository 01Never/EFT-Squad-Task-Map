# Tasks

**What it does (player's view):** your active tasks, sorted into categories (Boss hunts, PMC
kills, Mark, …) in the panel and drawn as markers on the map. A task with different kinds of work
is split into parts ("◫ part 1/2"), each in its own category. You can open a row to see its
objectives and tick them, pin tasks, move a part to another category, keep a task whole ("Don't
split"), add a task by name, remove one, and edit, reorder or delete categories. Clicking a row or
a marker selects the part: the row gets a white outline, its markers grow and flash, the popup
shows it. In a squad (ticket 26), squadmates' tasks you don't have are rows of the same list,
crosshatched, after yours in each category: you can select, read and pin them, not work them
(rules in `features/squad`).

**Where the data comes from:** the tasks themselves from the game data (`/api/data`, made by
`internal/gamedata` from json.tarkov.dev); your list, ticks, pins and category choices from the
saved data (`tasks` and `ticks` of the shown game mode's list, and the shared `cats`,
`collapsed`, `pinnedOnly`). Each game mode (PvP, PvE, PvP Season) is its own character with its
own list (ticket 22); the page shows the list of the mode in Settings, read and changed only
through `app/current-list.js currentList()`. Tasks are added by a scan (`features/scan`), by the
game log (event `task`), or by name.

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
- A game-log task event changes the list of the game mode it happened in, even when another mode
  is shown; an event without a mode (queued by an older version) or with an unknown one goes to
  the shown list (`applyTaskEventFromGame()`, ticket 22).
- Categories are shared by every game mode; a part's category choice belongs to its mode's list.
  Deleting a category clears it from every list; "Re-sort everything" re-sorts the shown list.
- New categories go just before Unsorted and take the next colour of `NEW_CATEGORY_COLORS` and the
  next marker shape.
- **Only a task on your list can be worked** (`isTaskOnMyList()`: active in the shown list;
  ticket 26). `tickObjective()`, `removeTaskFromList()`, `movePartTo()`, `resetPartCategory()`
  and `sub-tasks/rules.js addSubTask()` refuse any other task, so a squadmate's task you don't
  have can't be ticked, counted, removed, moved or given sub-tasks, whatever the page sends; its
  controls are disabled or hidden with the title "Not on your task list"
  (`NOT_ON_YOUR_LIST_TITLE`). Pinning works for any task (`togglePinnedTask()`): a task that
  isn't on your list gets a `blankTaskEntry()` with `active: false` that only holds the pin.
- Rows: `isRowListed()` (not done; pinned under "Pinned only"), `countMyOpenTasks()` (the header's
  number: never squadmates' rows) and `countSquadOnlyTasks()` ("+N from squad").
- `defaultCategoryOfPart()`: the built-in for the part's kind, else Unsorted, ignoring any choice
  (`categoryOfPart()` uses it when there is no choice; squadmates' rows always use it).

**Flow:**
- A click in the list: `panel/panel.js` (router) → `TASK_ROW_ACTIONS` / `CATEGORY_ACTIONS` here →
  change the saved data → `save()` → `renderMapPage()` (or `renderPanel()` when only the list changes).
- Ticking: `objective-line.js onTickBoxChanged()` → `task-list.js setTick()` (also takes a marker
  out of the bag, see `features/readiness`) → save → redraw.
- Game log: event `task` (`{taskId, status, mode}`) → `app/live-events.js onTaskChangedInGame()`
  → `applyTaskEventFromGame()` on `modes[mode]` → save → redraw.
- Selecting: a row → `selection.js selectPartFromList()` (zooms to its spots); a marker →
  `map/input.js` → `selectPartFromMarker()` (scrolls the list). Rows are looked up in
  `task-list.js listedPartsOnMap()` (yours, then squadmates' from `squad/friends.js
  friendOnlyPartsOnMap()`); counts, readiness, the Bring list and your markers use
  `partsOnMap()` (yours only). A selected squadmate's part has no markers of yours, so
  `map-layer.js` flashes every spot of the part.

**Saved data / settings:** per game mode `modes[mode].tasks{id: {active, source, addedAt,
gamePct, scannedAt, noSplit, pinned, partCats}}` and `modes[mode].ticks`; shared `cats`,
`collapsed`, `pinnedOnly`. Reads the setting `gameMode` (which list is shown).

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
Don't split, progress, finishing and forgetting, game-log events going to their mode's list;
ticket 26: ticking, removing and finishing refused for a task not on your list, a pin on one,
listed rows) and `categories.test.js` (default category, moved part, deleted built-in, re-sort
and undo, choices per game mode, deleting a category in every list; moving refused for a task
not on your list). `app/current-list.test.js`: switching mode
shows the other list and leaves both intact. The browser suite (`tests/browser/task-list.e2e.mjs`)
covers adding by name, ticking, pins, Move to, Re-sort + Undo, Don't split and selection.
**Needs an in-game check:** nothing new in 04b.
