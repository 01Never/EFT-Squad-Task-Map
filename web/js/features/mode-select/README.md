# Mode select

**What it does (player's view):** the start page. Like the game's "Select profile and mode" screen:
a card each for **PvE**, **PvP** and **PvP Season** (the game's order). A card shows the mode's
name, "Regular" or "Seasonal", how many active tasks its list has, "Last used" on the mode in
Settings, and "Game is in this mode" when the game's log says so. Click a card for that mode's map
picker, then a map. The breadcrumbs in the top bar (`PvE / Maps / Customs`) lead back; on a phone
one "‹ previous step" link does.

**Where the data comes from:** `app.saved.modes[mode]` (each mode's own list, saved data v3), the
Settings `gameMode`, and `app.status.raid.sessionMode` (the mode the game log reported).

**The rules** (`rules.js`): `modeCards()` builds the three cards. Active tasks are the list's
entries with `active` set (the picker's count also drops tasks missing from the game data in use).

**Addresses and crumbs** (`app/addresses.js`, tested in `app/addresses.test.js`):
- `#/` this page; `#/<mode>/maps` the picker; `#/<mode>/map/<key>` a map. `<mode>` is `regular`,
  `pve` or `pvp-season`.
- Old `#/map/<key>` is replaced (no extra history entry) by `#/<Settings mode>/map/<key>`. An unknown
  mode goes to `#/`; a known mode with an unknown map to `#/<mode>/maps`.
- `crumbsFor()` says what the trail reads on each page; `app/crumbs.js` draws `#crumbs` and the
  narrow-screen `#crumbback` link.

**Flow:** the address → `app/routing.js showPageForAddress()`. When the address's mode isn't the
Settings mode, routing shows "Switching to PvE…", saves the mode (`app/switch-mode.js`, the same
code as the top bar's "Switch data", which also sends the squad the new list), then shows the page.
"Switch data" and a Settings mode change call `followGameMode()`: the same page in the new mode.
A `mode` event from the log redraws this page so "Game is in this mode" stays right.

**Saved data / settings:** none of its own; opening a mode's page saves `gameMode`.

**Files:**
- `rules.js`: the cards.
- `panel.js`: the page.
- `mode-select.css`: styles (the frame and heading reuse `picker.css`).

**Tests:** `rules.test.js` (order, counts per mode, Last used, Game is in this mode). The browser
suite's `mode-select.e2e.mjs` walks mode → maps → map, the crumbs, back button, the old address,
the fallbacks, Switch data and the phone back link. **Needs an in-game check:** "Game is in this
mode" while Tarkov is running in each mode.
