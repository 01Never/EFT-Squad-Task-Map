# Readiness and the Bring list

**What it does (player's view):** each objective shows what it needs you to carry (🔑 keys,
🎒 items to place, 🎽 gear), yellow when you have none. A task you're not ready for shows **!**
in the list, and its markers fade to half opacity with a "!" badge and a dotted zone. The
**Bring list** tab lists everything needed for what's shown on the map, where you set how many
of each you carry. Placing a marker or item (ticking it) takes one off; counts reset after each raid.

**Where the data comes from:** the objectives' `keys`, `marker`, `items` and `gear` in the game
data (`/api/data`); your bag counts in the saved data (`have`, plus `used`: what each ticked
objective took).

**The rules** (`rules.js`):
- Requirements of an objective (`requirementsOf()`): every key group is needed (any key of a group
  will do); "mark" needs its marker (MS2000 when the data names none); "plantItem" needs the item
  (any of the alternatives) × its count; gear needs the weapon (any one), the things to wear and
  the weapon mods (any one set).
- Things to wear: up to `MAX_SINGLE_ITEMS_ALL_NEEDED` = 4 single items are all needed (armor +
  helmet); anything else is "any one outfit". The data doesn't say which; this split matched every
  task checked in v2.
- Possible = at least one of everything it still needs (`isObjectivePossible()`,
  `isPartPossible()`). Example: 2 markers and 5 marker spots → all 5 spots are possible.
- Ticking a marker or plant objective takes one from the bag if there is one, and remembers it in
  `used`; unticking gives back only what that tick took (`updateBagForTick()`).
- Bag keys (`requirementKey()`): the item id, or `any:<hash>` for a set of alternatives (the same
  whatever their order).
- The Bring list (`bringList()`): keys, items to place and gear for the objectives of the parts
  shown on the map (visible categories, not done, pinned if Pinned only); keys and gear need 1,
  items to place add up the remaining counts. "Find in raid" lists found-in-raid items for
  hand-ins of the shown tasks and of your tasks that aren't on any map. The tab's number counts
  keys, items and gear you have none of (`countMissing()`).

**Flow:** − / + or a typed count → `panel/panel.js` → `onBagStepClicked()` /
`onBagCountChanged()` → `stepBagCount()` / `setBagCount()` → save → `renderMapPage()` (the "!",
the fading and the tab number follow). Raid end: event `raidEnd` → `features/raid resetAfterRaid()`
empties `have` and `used`.

**Saved data / settings:** `have`, `used`, `panelTab` ("bring"). No settings.

**Files:**
- `rules.js`: requirements, possible or not, the bag, the Bring list.
- `panel.js`: the Bring list tab, the requirement tags on objective lines, the bag handlers.
- `readiness.css`: Bring list styles.

**Tests:** `rules.test.js` covers markers (possible with one, used up by ticking, given back only
when taken), single items vs outfits, adding up markers across tasks, a key once, found-in-raid
items once, and order-free keys. The browser suite checks "tick a marker → have goes down, untick
gives it back". **Needs an in-game check:** nothing new in 04b.
