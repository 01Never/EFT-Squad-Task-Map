# Levels (the level picker, follow me)

**What it does (player's view):** on a map with floors, the dropdown at the end of the map
toolbar picks what the map shows: **All levels (follow me)**, the base level by name ("Ground";
The Lab: "1st Level"), or one floor ("2nd Floor", "Technical"…). A chosen level stays whatever
your screenshots say; your marker still moves and keeps its real floor badge. With follow me,
each new GPS screenshot's height decides the level and the map switches to it. The choice is
remembered per map. On The Lab each level is a complete picture and only that one shows; on the
other maps a floor is drawn over the ground, as before.

**Where the data comes from:** the map's entry in `assets/maps-config.json` (from tarkov.dev's
`maps.json`): `baseLayer`, `layers` (`name`, `svgLayer`, `extents` = height ranges with optional
area bounds), `svgGroups`, and two fields of our own (ticket 31):
- `levelStyle`: `"overlay"` (default: the base art always shows, a floor is drawn on top) or
  `"stacked"` (each level, the base included, is its own picture; exactly one shows).
- `baseLevelName`: the base level's name in the picker (default `"Ground"`).

Any map gets this by config only: nothing in the code names a map.

**The rules** (`rules.js`):
- `levelOfPosition(config, x, y, z)`: the first layer whose height range contains y (bottom
  included, top not) and, when the range has areas, whose areas contain (x, z); null = the base
  level (also without a height). `map/projection.js` `floorBadge()` is the badge of that layer.
  The Lab: below -0.9 m → Technical; 3 m and up inside the second level's area → Second Level;
  everything else (the hangar too) → 1st level.
- `levelPickerOptions(config)`: follow me, the base level, then every layer with a picture
  (`svgLayer`). No pictures (Woods, Reserve…) → no picker.
- `defaultLevelChoice(config)`: stacked → `"follow"`; overlay → `"base"` (what every map did
  before). `savedLevelChoice(prefs, config)`: `prefs[map].level` when it's still an option, else
  the default.
- `levelToShow(choice, lastPosition, config)`: a chosen level always wins; follow me → your
  position's level, the base level without a position or for a layer without a picture
  (Customs' "4th Floor").
- `visibleGroups(config, levelShown)`: overlay → the base groups (and groups kept with them,
  e.g. `First_Floor`) plus the level's group; stacked → only the level's groups.
- `layerOfLevelShown(config, levelShown)`: the layer for place names
  (`map/place-names.js isPlaceNameShown`).

**Flow:**
- Opening a map → `map/map-page.js openMap()` → `renderLevelPicker()` (the dropdown with the saved
  choice) → `showLevelForChoice()` → `.lyr` groups get `off` unless in `visibleGroups()`.
- A pick → `onLevelPicked()` → `prefs[map].level`, `save()` → `showLevelForChoice()` → place names.
- `gps` event → `app/live-events.js onPositionReceived()` → `followLevelOfNewPosition()` (changes
  only with follow me) → place names; then your marker as before.
- Any redraw (`renderMapPage()`, e.g. raid end clearing your position) → `showLevelForChoice()`;
  it only touches the art when the level changes. No timers.

**Saved data / settings:** `prefs[mapKey].level` (`"follow"`, `"base"` or a layer's `svgLayer`),
written only when you pick; absent = the map's default. `fillMissingFields()` drops a damaged
value. No version change. No settings.

**Files:** `rules.js`: the rules above; `map-layer.js`: the dropdown, showing the groups, the
handlers; `rules.test.js`: the tests. (No CSS: the dropdown uses the toolbar's styles, and
hidden groups use `map/map.css` `.lyr.off`.)

**Tests:** `rules.test.js` (The Lab's three levels and the second level's area, follow me,
a chosen level never changing, stacked vs overlay groups on The Lab and Customs, a made-up
stacked map, place names, defaults and saved choices); `map/projection.test.js` (floor badges
unchanged on the existing maps, The Lab's badges, its art lining up with tarkov.dev's tiles);
browser `tests/browser/levels.e2e.mjs` and The Lab's case in `paint.e2e.mjs`. **Needs the owner
in-game:** that The Lab's heights split the levels where the game does (tarkov.dev's numbers),
on stairs and in the hangar.
