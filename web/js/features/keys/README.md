# My keys (ticket 09)

**What it does (player's view):** a **My keys** section in the task list ("My keys (5)", closed
until you open it) keeps the keys you usually bring to this map. Add a key by typing part of its
name (this map's keys, or **all keys**: a key that opens nothing here says so). Each key shows
its picture, its name and what it opens here ("2 doors", "1 trunk"); click the name to fly to its
doors, **×** to remove it (Undo), **Copy from…** another map's list (only the keys that matter
here), **Clear** (Undo). On the map, every door and trunk your keys open shows a tile in the
"your keys" colour with the key's picture, its floor badge and ⚡ when it needs power; the door's
outline where the data has one. **All locked doors** adds the other doors, dimmed. Tap a door:
the key, the lock, the tasks that use the key, friends who have it, and the loot nearby
(approximate, ringed on the map while the popup is open). Keys on a map's list count as had for
that map's tasks, raid after raid. When a raid starts on a map you have keys for, the toast says
"Bring your 5 keys for Customs" (**Show list** opens the list). With the squad (ticket 05) and
"Share my keys" on, friends see your keys and you see theirs.

**Where the data comes from:**
- Locks: ticket 08's `GET /api/loot/<map>` (`locks`: key id, type, power, position, and `ol`,
  `top`, `bottom` for the few that have an outline), loaded through `features/loot/loot-data.js`
  only when needed (you have keys on the map, a friend shares keys, the section is open, or a
  popup is open), once per map and game data. Key names come from the answer's `items`, or from
  the tasks' `objs[].keys`.
- Keys that matter on a map: each key with a lock there plus each key a task there needs
  (`objs[].keys`, every task in the game data, not only yours).
- Pictures: ticket 07's `/icons/<id>.webp` (door keys are known items).
- Friends' keys: the `keys` of their squad share (`app.squad`), only when they share them.

**The rules** (`rules.js`, tested in `rules.test.js`):
- **Saved:** `keyring: {"<map key>": ["<key item id>", …]}`. Absent until you add a key (like
  `squad`, `taskIcons` and `prefs[map].loot`), so older files load and save back unchanged; no
  version change. `cleanKeyring()` (run by `fillMissingFields`) keeps only map keys that are short
  lower-case words (not `constructor`/`prototype`; `__proto__` has underscores) and 24-hex key ids,
  each once, ≤ 200 keys a map, ≤ 64 maps, and drops empty lists. Every lookup is an own-property
  lookup. **Not reset at raid end** (`raid/rules.js resetAfterRaid` doesn't touch it).
- **Readiness** (owner's default): a key on the open map's list counts as had on that map only
  (`readiness/rules.js isOnKeyList`, `hasRequirement`); see `features/readiness/README.md`.
- **The placeholder key** (QA of ticket 08, default chosen by the owner): tarkov.dev names the
  "Factory emergency exit key" (`5448ba0b4bdc2d02308b456c`) for 3 locks on Factory, where it's
  right, and for locks on Customs (3), Interchange (13), Streets (6) and Ground Zero (2), where it
  looks like a placeholder for an unknown key. Off Factory those locks are "Unknown key (data
  incomplete)" (a grey "?" tile), shown only under **All locked doors**, never counted as doors the
  key opens, never in the picker's counts (`PLACEHOLDER_KEY_ID`, `isPlaceholderLock`). **Revisit**
  when tarkov.dev fills them in: delete the constant and the two checks.
- **Doors drawn** (`doorsToDraw`): status `mine` (a key on your list), `other` (a key you don't
  have) or `unknown` (the placeholder). Drawn: yours always; the others with All locked doors; an
  `other` door a friend's key opens also without it (to carry their dot). Doors that aren't yours
  are drawn at 45% opacity: an exception to "markers are fully opaque" (SPEC §7.3, noted in
  `CLAUDE.md`).
- **Outlines:** only 10 of 283 locks have one, all on Factory and Ground Zero, and they're door
  footprints (0.5–1 m), not rooms. Drawn when there is one; otherwise only the marker. The page
  never draws a room.
- **Loot behind a door** (`lootNearDoor`): ticket 08's containers and loose spots within
  `LOOT_BEHIND_DOOR_RADIUS_METERS` = 8 m on the ground (x, z) and within
  `SAME_FLOOR_MAX_HEIGHT_DIFFERENCE_METERS` = 1.5 m in height (owner's default: 8 m, same floor).
  The height, not the floor badge: in the real data the badges split a room at a floor boundary
  (Customs dorm 314's door reads "3rd floor", its shelves' loot "2nd floor"); a lock's height is
  the middle of the door, about a metre above its floor, and a storey is about 3 m. Checked on two
  known doors (tests): Dorm room 114 → its PC block, 2 safes, medcase and 2 loose spots; the
  marked room (314) → 4 loose spots and a PMC body, not the 2nd floor's safe 3.5 m below. Shown as
  "Nearby loot, approximate".
- **Keycards for extracts and power** (owner's default): only what the locks data has. The real
  data has no lock needing power and no extract keycards, so the ⚡ badge is ready but unseen.
- **Copy from another map** (`copyKeyList`): adds the other list's keys that matter here, after
  yours; the rest are left out and the toast counts them. Undo restores the list.
- **Search** (`searchKeys`): every word of the search in the name. **All keys** (`allKnownKeys`):
  also every key any task needs and every key on any map's locks (every map's locks are loaded
  once for it).
- **Friends** (`friendKeyList`, `friendsWithKey`): their share is untrusted: own-property
  lookups, 24-hex ids only, names through `friendDisplayName` and `escapeHtml`, colours through
  `safeFriendColor`. Up to 3 dots a door.
- **Reminder** (`bringKeysReminder`): "Bring your 5 keys for Customs" ("your key" for one), only
  when the raid's map has a list.

**Flow:**
```
search → panel.js onKeyResultClicked → addKeyToList → save → renderMapPage
  → readiness (openMapKeyList), the panel, and map-layer.js renderKeyDoors
renderKeyDoors → loot-data.js lootOfMap → GET /api/loot/<map> (once) → doorsToDraw → placed doors
  → outlines (all) + markers near the view (spotsNearView) → pan/zoom → map/view.js applyView
  → redrawKeyDoorsWhenViewSettles (150 ms after the view stops) → redraw
tap a door → map/input.js → onDoorTapped → #keypop + rings on lootNearDoor (closes the loot popup)
raidStart event → app/live-events.js → live-event.js remindKeysAtRaidStart → toast → Show list
squad event with a friend's new keys → squad/live-event.js (keysChanged) → renderMapPage
Settings → ☑ Share my keys → PUT /api/squad/profile {shareKeys} → my share with `keys`
```

**Performance** (must-have; measured like ticket 08: Streets, every task active, headless
Chromium with software rendering, 1600×900, 2 rounds of a 120-step pan and a 40-notch zoom
in/out; `tests/browser/perf-keys.measure.mjs`). Frame interval in ms (mean / p95) and layout +
style time per frame, 2 runs each:

| | pan | zoom | layout per frame | doors drawn |
|---|---|---|---|---|
| doors off | 16.7–16.8 / 16.7–16.8 | 16.6–16.8 / 16.7 | 0.8–1.9 ms | 0 |
| All locked doors (every lock on Streets) | 16.8–16.9 / 16.7–16.8 | 16.6–16.7 / 16.7 | 0.9–1.7 ms | 63 |

Nothing is animated. Markers are cached pictures (`marker-images.js`) plus the key's icon, kept at
screen size like every `.sc` group; only doors in and near the view are drawn (ticket 08's
`spotsNearView`), redrawn once per gesture. Idle with every door shown: 0 Paint and 0 Layout in a
3 s Chrome trace (browser suite). With no key on the map, no friend sharing keys, the toggle off
and no popup open, nothing is loaded or drawn.

**Saved data / settings:** `keyring` (above). In memory only: the section's open state
(`app.keysSectionOpen`), the search (`app.keySearchText`, `app.keySearchAll`) and All locked doors
(`app.allDoorsShown`, off when the page loads). Settings file: `squad.shareKeys` (server).

**Files:** `rules.js`: the rules above; `key-lists.js`: the open map's list, the keys that matter
on it and friends' keys, read from `app`; `panel.js`: the My keys section and its handlers;
`map-layer.js`: doors, outlines, the popup, the rings, flying to a key's doors;
`marker-images.js`: the door tile, the "?" tile and the ⚡ badge; `live-event.js`: the raid-start
reminder; `keys.css`. Wiring: `map/layers.js` (`keyDoors` above loot), `map/map-page.js`,
`map/view.js`, `map/input.js`, `panel/panel.js`, `app/live-events.js`, `app/saved-data.js`,
`features/readiness/{rules,panel}.js`, `features/tasks/{panel,objective-line,map-layer}.js`,
`features/squad/{rules,share-sync,settings-section,live-event}.js`. Server:
`internal/features/squad` (the share's `keys`, "Share my keys").

**Tests:** `rules.test.js` (saved lists and their cleaning, the migration of older files, add /
remove / Undo / clear, not reset at raid end, Customs' keys and counts, the placeholder on
Customs vs Factory, doors drawn, search, all keys, copy, loot behind Dorm 114 and the marked room,
friends' keys read safely, the reminder); `readiness/rules.test.js` (ready with the key list,
after raid end, the Bring list); `squad/rules.test.js` (the share's `keys` only when on; key
changes); Go: `internal/features/squad/rules_test.go`, `internal/app/squad_test.go`;
`tests/browser/keys.e2e.mjs` (every acceptance check, squad sharing with two copies on the dev
transport, the idle trace). **Needs the owner in-game:** set up your usual keys for one map: do
the highlighted doors match where the keys work, and is the "loot nearby" roughly right (tune the
8 m / 1.5 m after that)? On Windows with a real GPU, does Streets with All locked doors pan as
smoothly as without?
