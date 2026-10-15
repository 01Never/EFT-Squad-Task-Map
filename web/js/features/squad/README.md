# Squad (page side, ticket 05 part 2)

The server side (tsnet, the peer API, the cache, join/leave) is
[`internal/features/squad`](../../../../internal/features/squad/README.md); its README is the API
contract. This folder is everything the player sees: Settings → Squad, the friend chips, friends'
drawings and tasks on the map, who has each task (colour boxes), squadmates' tasks in your list,
badges, the filter and per-friend progress.

**What it does (player's view):** see the user guide's "Squad" section. In short: Join with an
invite code in Settings; a chip per friend in the task list (colour dot, name, "online" /
"last seen 2 h", **✎ Draw** and **☰ Tasks** switches); friends' lines in their colour under
yours; with a friend's tasks on (the default), a colour box and name per friend on every row they
have and in the popup, **Shared with squad**, "Mike 2/5 · Sam ✓" in the popup, and
(ticket 26) the tasks only friends have as **crosshatched rows of your own list**, in their
default category after your rows. On the map (ticket 27) those tasks are ordinary task markers,
see-through, and every task a friend has gets a small square in their colour under its main
spot. No position is shared.

**Where the data comes from:** `app.squad`, the server's squad view: loaded with `GET /api/squad`
at start-up, replaced by every `squad` live event (and by the answers of join / leave / profile).
Your choices per friend are in the saved data (below). The page never polls.

**The rules** (`rules.js`, tested in `rules.test.js`):
- **Friends are untrusted.** `safeFriendColor()` accepts only `#rrggbb` (else a neutral grey);
  `friendDisplayName()` cuts to 32 characters (not UTF-16 units), drops control, bidi and
  zero-width spaces, keeping the zero-width joiners emoji need ("(no name)" if nothing visible is left); every name is shown inside `<bdi>`; every name is
  `escapeHtml()`-ed where it goes into HTML; friend text is never used in a URL or in `innerHTML`
  unescaped. Every lookup keyed by friend data (task, objective and map ids, friend ids) uses own-property
  checks (`ownValue()`), so `toString` or `__proto__` find nothing; a friend whose data throws is
  skipped with one `console.warn` (`safe.js`). My share carries only 24-hex game ids. Stroke numbers are checked before they reach SVG attributes. Friends' strokes are
  drawn in the **friend's profile colour**, whatever colour the stroke has (owner's default).
- **Per friend:** drawings **on** and tasks **on** by default (`friendPrefsOf`; tasks were off
  by default before ticket 26, the owner chose on). A saved `tasks: false` is kept.
- **Shown friends for tasks** = tasks switch on **and** they share tasks (`tasks` not null)
  **and** their tasks are for the game mode you're shown (`friendTasksOf`, ticket 22: each mode
  is its own character). A share whose `mode` is absent or "" (a copy from before ticket 22)
  counts as yours, as before. Everything about tasks (boxes, dots, filter, progress, squadmates'
  rows) uses only those. A friend on another mode keeps their drawings on your map; their
  ☰ Tasks is greyed out with the title "Mike's tasks are for PvE" (`friendTasksButtonTitle`).
- **Who has it** (`friendBoxes`, ticket 26): every row, yours or a squadmate's, gets a colour box
  (`safeFriendColor`) and name (`friendDisplayName`, in `<bdi>`, escaped) for each shown friend
  who has the task active (`friendsAlsoDoing`), in the friends' order; so does the popup. This
  replaced the "Also: Mike, Sam" text (`alsoText` stays as the plain-text form).
- **Progress on a part** (`friendPartProgress`): "✓" when done, "2/5" when the part's one required
  objective counts (kills, items), else "objectives done/required".
- **Squadmates' tasks in your list** (`friendOnlyRowsOnMap`, ticket 26): tasks a shown friend has
  that are not active on your list (of the mode you're shown) and exist in your game data
  (`friendsOwnTasksOnMap`) become rows (`notMine: true`), one per part on this map that is still
  open for at least one of those friends (`openPartsOnMap`). Each part is split by kind of work
  as a new task would be, and sits in the category the default rules give it
  (`tasks/categories.js defaultCategoryOfPart`; your own moves and Don't split never apply). In
  each category they come after your rows; category and map-picker counts stay yours only, the
  header adds "+N from squad" (`tasks/rules.js countSquadOnlyTasks`). You can select them (flash,
  zoom, popup), read them and **pin** them (`tasks/rules.js togglePinnedTask`: a
  `blankTaskEntry()` with `active: false, pinned: true` in your list, shown under Pinned only).
  You can't tick, count, remove, move or add sub-tasks: the controls are disabled or hidden
  ("Not on your task list") and the rule functions refuse a task that isn't on your list
  (`tickObjective`, `removeTaskFromList`, `movePartTo`, `resetPartCategory`, `addSubTask`).
  Never in readiness or the Bring list. A pinned one that no shown friend has any more keeps its
  pin and has no row.
- **On the map** (ticket 27; drawn by `tasks/map-layer.js`, the rules here):
  - A squadmate's task you don't have is drawn **exactly like your own** markers (category
    shape and colour or item icon, size, floor and split badges, zone), **see-through**
    (`squadMarkerLook().isSeeThrough`, the same 50% as not ready; SPEC §7.3's third case), with
    a solid, faded zone outline, no "!", **under your own** markers. Clicking one selects it
    like its row (flash and popup). It uses the same rows, so category visibility, Pinned only
    and Shared with squad hide and show it exactly like its row.
  - Its spots: an objective counts as done only when every shown friend who has the task did it
    (`squadTicksOfTask`: lowest count; only game-id keys), so a spot shows while anyone needs it.
  - **Squares** (`squadSquaresOf`): one small square per shown friend who has the task
    (`friendsAlsoDoing`), in chip order, `safeFriendColor`, thin black outline, bottom centre;
    up to 4 (`MAX_SQUAD_SQUARES_ON_MARKER`), then "+N". Your own tasks and squadmates' alike.
    Only on each part's **main spot** (`mainSpotIndex`: the first exact spot; with only possible
    spots, the one nearest their average), so a part shows its squares once. The squares sit
    outside the faded group (`map/markers.js`), so they stay opaque.
- **"Shared with squad"** hides, in the list and on the map, every task no shown friend has
  (`isHiddenBySharedOnlyFilter`, via `friends.js: isHiddenBySquadFilter`); squadmates' rows are
  never hidden by it (a friend has them by definition). It only applies while
  at least one shown friend shares tasks (`isSharedOnlyFilterInEffect`); with nobody like that it
  would hide every task you have, so it does nothing and its chip is greyed out (disabled, never
  shown as on, the title says why). Your saved choice is kept and applies again once a shown
  friend shares. Off by default. (2.8.1: in 2.8.0 a saved "on" with only a friend who shared no
  tasks emptied every list and map.)
- **My share** (`buildMyShare`): `mode` (the game mode you're shown), all drawings (strokes cut
  to `{c, w, pts}`, anything the server would refuse left out) and, only while "Share my tasks"
  is on, `{ticks, pct}` for every active task of that mode's list (`pct` = the whole task's
  progress). Nothing else leaves the saved data. Switching game mode (Settings or Switch data)
  sends the share again.
- A friend switching game mode is a task change (and redraws their chip).
- **What changed** (`describeSquadChange`): compares two views so only that is redrawn.

**Flow:**
```
any save() → share-sync.scheduleShareUpdate → (1 s, only when joined) → buildMyShare →
  if the content changed: PUT /api/squad/share                    (the only timer in this feature)
server "squad" event → app/live-events.js → live-event.js onSquadChanged →
  describeSquadChange → friend's new lines: renderFriendDrawingsOf (that friend only)
                      → friend's changed tasks (toggle on): renderMapPage
                      → online / last seen / name: chips only (renderSquadChipsInPlace)
                      → status line: the Settings box, in place
Settings → Join → POST /api/squad/join (up to 90 s) → applySquadView → forced share send
Settings → ☑ Share my tasks → PUT /api/squad/profile → forced share send (the server keeps no
  tasks while sharing is off, so it has none to add itself)
Settings → Leave (confirm) → POST /api/squad/leave → friends gone from the page
```

**Saved data / settings:** the page's saved data gets an optional block
`squad: { friends: { "<player id>": { drawings, tasks } }, sharedOnly }`. **It's absent in every
file from before 2.7.0 and is only created when you change a switch**, so older files load and
save back unchanged and everything reads its defaults (`friendPrefsOf`, `isSharedOnlyFilterOn`);
a block missing a field also reads the defaults. That is this field's migration; tests:
`rules.test.js` ("a saved file from before the squad…", "a squad block that lost a field…",
"a ☰ Tasks switched off and saved before ticket 26 stays off…"). No `SAVED_DATA_VERSION` change.
Ticket 26 changed only the default of `tasks` (to on): a saved `true` or `false` reads as before.
A pinned squadmate's task is an ordinary task entry with `active: false` (a shape the saved data
already had), so it needs no migration either. Your name, colour, "Share my tasks" and "joined" live on the server
(`squad-task-map-settings.json`), never the invite code. The choices are kept when you leave
(they're by friend id, so rejoining the same squad restores them).

**Light:** no polling; the only timer is the 1 s share debounce. A friend's update redraws only
what it changed (their `<g>` of lines, the chips, or the page once for changed tasks). Friends'
lines are plain SVG polylines (no animation). Squadmates' markers and the squares are static
SVG drawn once per render with your markers, in the same layer and screen-size system (`.sc`,
`applyView`); nothing new animates and there are no new timers. Layer order (`map/layers.js`):
friends' drawings sit **under** your drawings; squadmates' task markers are drawn first in the
task-marker layer, so they sit **under** yours.

**Files:**
- `rules.js`: the rules above. `rules.test.js`: their tests.
- `friends.js`: which friends are shown, read from `app.squad` and the saved choices; the boxes
  for a task (`friendBoxesForTask`), the squadmates' rows on a map (`friendOnlyPartsOnMap`) and
  the ticks their markers are drawn with (`squadTicksForTask`).
- `panel.js`: the chips, "Shared with squad", the colour boxes on rows and in the popup, the
  progress line, and their click handlers.
- `map-layer.js`: friends' drawings layer. (Squadmates' task markers: `tasks/map-layer.js`.)
- `share-sync.js`: building and sending my share (debounced, only on change).
- `settings-section.js`: Settings → Squad (join, profile, share tasks, leave).
- `live-event.js`: the `squad` event and the redraw choice.
- `squad.css`.
- Wiring: `app/live-events.js`, `app/saving.js` (schedule the share), `main.js` (load the view,
  first share), `panel/panel.js` (sections and clicks), `map/map-page.js` and `map/layers.js`,
  `map/markers.js` (squares, see-through), `features/tasks/{panel,popup,task-list,category-panel,map-layer,
  selection,objective-line}.js` (boxes, squadmates' rows and their read-only details, popup
  lines, filter, badge colours, selecting a squadmate's row and its flash),
  `features/settings/panel.js`.

**Tests:** `npm test` (rules; ticket 26: default category, boxes, per map, ☰ Tasks off or another
mode, pin as an inactive entry and Pinned only, a pin without a friend, counts, the filter;
ticket 27: squares in chip order, 4 then "+N", main spot, see-through, squad ticks, filters).
`tests/browser/squad.e2e.mjs` runs three real copies on the dev transport (Alice, Bob, Cara):
drawing and undo travel, B's switch hides A's lines, task sharing on in A and off in B, ☰ Tasks
on by default, colour boxes, badges, A's tasks B doesn't have as crosshatched rows in their
default category (select, disabled ticks, pin, Pinned only, A's ☰ Tasks off removes them),
A's tasks on B's map as see-through markers of the category's shape and colour with A's square
under each part's main spot, a shared task fully opaque with one square, clicking one selects it,
filter, popup progress, a friend going offline ("last seen") and coming back, Leave. **Needs the owner:** a real tailnet with 2+ PCs (see the
server README and HANDOFF §3c).
