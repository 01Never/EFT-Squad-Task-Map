# Squad (page side, ticket 05 part 2)

The server side (tsnet, the peer API, the cache, join/leave) is
[`internal/features/squad`](../../../../internal/features/squad/README.md); its README is the API
contract. This folder is everything the player sees: Settings → Squad, the friend chips, friends'
drawings and tasks on the map, "Also: …", badges, the filter and per-friend progress.

**What it does (player's view):** see the user guide's "Squad" section. In short: Join with an
invite code in Settings; a chip per friend in the task list (colour dot, name, "online" /
"last seen 2 h", **✎ Draw** and **☰ Tasks** switches); friends' lines in their colour under
yours; with a friend's tasks on, "Also: Mike, Sam" on rows and in the popup, friend-colour dots at
the bottom left of the marker, **Shared with squad**, "Mike 2/5 · Sam ✓" in the popup, and a
"Friends' tasks" block with smaller markers for tasks you don't have. No position is shared.

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
- **Per friend:** drawings **on**, tasks **off** by default (`friendPrefsOf`).
- **Shown friends for tasks** = tasks switch on **and** they share tasks (`tasks` not null).
  Everything about tasks (Also, dots, filter, progress, Friends' tasks) uses only those.
- **Also:** a task you have active that a shown friend has active too (`friendsAlsoDoing`,
  `alsoText`). Dots: up to 3 friend colours (`friends.js: squadColorsForTask`).
- **Progress on a part** (`friendPartProgress`): "✓" when done, "2/5" when the part's one required
  objective counts (kills, items), else "objectives done/required".
- **Friends' other tasks** (`friendsOwnTasksOnMap`, `openPartsOnMap`): the friend's tasks that
  are not active on your list, exist in your game data and have something on this map; markers
  only for the parts still open for them. Read-only: never in your list, readiness, Bring list,
  selection, ticks or saved data.
- **"Shared with squad"** hides, in the list and on the map, every task no shown friend has
  (`friends.js: isHiddenBySquadFilter`).
- **My share** (`buildMyShare`): all drawings (strokes cut to `{c, w, pts}`, anything the server
  would refuse left out) and, only while "Share my tasks" is on, `{ticks, pct}` for every active
  task (`pct` = the whole task's progress); only while "Share my keys" is on (ticket 09), the
  cleaned `keyring` (`keys/rules.js shareableKeyring`). Nothing else leaves the saved data.
- **Friends' keys** (ticket 09) are read in `features/keys` (`friendKeyList`: own-property lookups,
  24-hex ids only): a dot on the doors they can open, "Mike has this key" in the door popup,
  "Sam has it" on a task's key. A change in a friend's key list (`keysChanged`) redraws the page once.
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
Settings → ☑ Share my keys (ticket 09) → PUT /api/squad/profile {shareKeys} → forced share send
Settings → Leave (confirm) → POST /api/squad/leave → friends gone from the page
```

**Saved data / settings:** the page's saved data gets an optional block
`squad: { friends: { "<player id>": { drawings, tasks } }, sharedOnly }`. **It's absent in every
file from before 2.7.0 and is only created when you change a switch**, so older files load and
save back unchanged and everything reads its defaults (`friendPrefsOf`, `isSharedOnlyFilterOn`);
a block missing a field also reads the defaults. That is this field's migration; tests:
`rules.test.js` ("a saved file from before the squad…", "a squad block that lost a field…"). No
`SAVED_DATA_VERSION` change. Your name, colour, "Share my tasks" and "joined" live on the server
(`squad-task-map-settings.json`), never the invite code. The choices are kept when you leave
(they're by friend id, so rejoining the same squad restores them).

**Light:** no polling; the only timer is the 1 s share debounce. A friend's update redraws only
what it changed (their `<g>` of lines, the chips, or the page once for changed tasks). Friends'
lines are plain SVG polylines (no animation); their task markers are in the same screen-size
layer system as yours (`.sc`, `applyView`). Layer order (`map/layers.js`): friends' drawings sit
**under** your drawings; friends' task markers sit **under** your task markers (so a friend
never hides your own marker; CODE-STYLE listed squad above task markers, this is the small
deviation).

**Files:**
- `rules.js`: the rules above. `rules.test.js`: their tests.
- `friends.js`: which friends are shown, read from `app.squad` and the saved choices.
- `panel.js`: the chips, "Shared with squad", "Also:" on rows and in the popup, progress line,
  the "Friends' tasks" block, and their click handlers.
- `map-layer.js`: friends' drawings layer and friends' task markers.
- `share-sync.js`: building and sending my share (debounced, only on change).
- `settings-section.js`: Settings → Squad (join, profile, share tasks, leave).
- `live-event.js`: the `squad` event and the redraw choice.
- `squad.css`.
- Wiring: `app/live-events.js`, `app/saving.js` (schedule the share), `main.js` (load the view,
  first share), `panel/panel.js` (sections and clicks), `map/map-page.js` and `map/layers.js`,
  `map/markers.js` (badge dots), `features/tasks/{panel,popup,task-list,category-panel,map-layer}.js`
  (the "Also:" line, popup lines, filter, badge colours), `features/settings/panel.js`.

**Tests:** `npm test` (rules). `tests/browser/squad.e2e.mjs` runs three real copies on the dev
transport (Alice, Bob, Cara): drawing and undo travel, B's switch hides A's lines, task sharing on
in A and off in B, badges, filter, popup progress, Friends' tasks, a friend going offline
("last seen") and coming back, Leave. **Needs the owner:** a real tailnet with 2+ PCs (see the
server README and HANDOFF §3c).
