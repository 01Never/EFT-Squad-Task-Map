# Raid (`internal/features/raid`)

**What it does (player's view):** the top bar shows "● In raid: <map>" while you're in a raid, and
your GPS positions land on that raid's map. Back in the menus after a raid, a toast says "Raid
over: bag counts and extract marks reset, N GPS screenshots deleted": what you're carrying (`have`,
`used`), your extract marks and your trail are reset, and the GPS screenshots you took in that raid
are deleted. It also decides whether a task event from the log counts, by game mode.

**Where the data comes from:** the `gamelog` events (application log: `scene preset path`,
`NetworkGameCreate … Location`, `GameStarted`, the profile lines, matchmaking cancelled,
`Session mode`; push-notifications log: `UserMatchOver`), and, from the app, the name of every GPS
screenshot that appears while the app runs (`NoteGPSShot`).

**The rules:**
- **Which map.** `MapLoading` takes the map being loaded from the scene path
  (`maps/rezerv_base_preset.bundle` → `reserve`, via `gamedata.MapFromScene`). `MapLoaded`
  (`Location: RezervBase`, via `gamedata.MapFromNameID`) is used only when the scene path didn't
  name a map. `MatchingAborted` forgets the loading map: in the real log the owner queued for
  Lighthouse, cancelled, and queued again.
- **Raid start** (`Start`, on `GameStarted`): the raid is active and its map is the loading map
  (which can be unknown). The app also clears the GPS trail. The start time is recorded but not
  used yet (v2 didn't use it either).
- **The map for a new position** (`CurrentMap`): the raid's map, else the loading map, else unknown
  (null: the page then shows the position on whatever map is open).
- **Raid end** (`EndsOnMenuReturn`): a profile-select line or `UserMatchOver` ends the raid **only
  if a raid is active or GPS screenshots were taken since the last raid end**. Why:
  - the same profile lines also appear right after the game starts, before any raid;
  - they come in groups (5 after each raid in the real log): the first one ends the raid, the rest
    find nothing to end;
  - if the app was started mid-raid (it missed `GameStarted`), the GPS screenshots still get
    cleaned up.
  `UserMatchOver` (push-notifications log) can arrive before the profile lines (20 s earlier in the
  real log); whichever is read first ends the raid.
- **At raid end** (`End`): delete that raid's GPS screenshots, and only those:
  - only names this tracker saw being created while the app ran (`NoteGPSShot`);
  - each one checked again to be GPS-named (`gps.IsGPSFileName`);
  - deleted through `screenshots.DeleteFile`, which accepts only plain file names inside the
    screenshots folder.
  Screenshots from the menus, from before the app started, or from an earlier raid are never
  touched. This is one of the two deletions CLAUDE.md allows. Then the raid's map, the loading map
  and the shot list are cleared, and the app *delivers* `raidEnd` with the map and the number of
  files deleted. Delivered means queued until the page confirms it, so the reset happens even if
  the page was closed at that moment.
- **Game mode** (`ModeMatches`): a task event from the log counts only when the game's latest
  `Session mode` equals the game mode chosen in Settings (`gameMode`, default `regular`). The latest
  line wins (the game writes two at start-up: `Pve`, then `PvpSeason`). While the session mode is
  unknown, because the app started after the game wrote it, every task event counts, as in v2.
  That gap is one suspect for the "phantom tasks" squadmates reported (HANDOFF §11); it's kept
  until the owner decides. The session mode isn't reset at raid end.
- **Status** (part of `/api/status`): `active`, `map` (the raid's map, else the loading one),
  `sessionMode` (null until the log says).

**Flow:**
```
"scene preset path:maps/<x>.bundle" → gamelog (mapLoading) → app.onLogEvent → gameData.MapFromScene
  → raid.MapLoading → Broadcast "raidMap" → live.js: map name kept for the nav bar
"TRACE-NetworkGameCreate … Location: <nameId>" → (mapLoaded) → raid.MapLoaded (no event)
"Network game matching cancelled" → (matchingAborted) → raid.MatchingAborted (no event)
"GameStarted" → (raidStart) → raid.Start → gps trail cleared → Broadcast "raidStart" {map}
  → live.js: trail cleared, "● In raid: <map>", switches to that map if Follow my position is on
GPS screenshot → screenshots watcher → app.onScreenshot → raid.NoteGPSShot + raid.CurrentMap
  → gps.Tracker.Update → Broadcast "gps"
profile line / "UserMatchOver" → (profileSelected / raidLeft) → raid.ShouldEndOnMenuReturn
  → app.endRaid → raid.End(gps.IsGPSFileName, screenshots.DeleteFile)
  → hub.Deliver "raidEnd" {map, deleted} → gps position cleared
  → live.js: have, used, extract marks and trail reset, saved, toast
"Session mode: X" → (mode) → raid.SetSessionMode → Broadcast "mode"
"ChatMessageReceived" type 10/11/12 → (task) → raid.ModeMatches(session mode, setting)
  and gameData.TaskExists → Deliver "task"
```

**Saved data / settings:** nothing saved; the raid state lives in memory. Restarting the app
forgets the current raid and its shot list, so shots taken before the restart are never deleted
automatically. Reads the `gameMode` setting (through the app) for `ModeMatches`. What gets reset
at raid end (`have`, `used`, `prefs[map].extMarked`) is the page's saved data, reset by the page.

**Files:**
- `rules.go`: the rules as plain functions: `ModeMatches`, `EndsOnMenuReturn`.
- `raid.go`: `Tracker`, one method per log event (`SetSessionMode`, `MapLoading`, `MapLoaded`,
  `MatchingAborted`, `Start`, `NoteGPSShot`, `CurrentMap`, `ShouldEndOnMenuReturn`, `End`,
  `Status`). A mutex guards it: log events and screenshots arrive on different goroutines.
- `raid_test.go`: the tests.

**Tests** (`raid_test.go`):
- `TestTaskEventsCountOnlyInTheChosenGameMode`: same mode counts; PvE events don't touch the PvP
  Season list; unknown session mode counts (as v2).
- `TestARaidTakesTheLoadingMapAndEndsBackInTheMenus`: the profile line before any raid doesn't end
  anything; the scene path's map wins over the nameId; back in the menus ends the raid.
- `TestCancelledMatchmakingForgetsTheLoadingMap`.
- `TestRaidEndDeletesOnlyThatRaidsGPSShots`: a shot seen twice is deleted once, a non-GPS name is
  never deleted, and the next raid starts with an empty list.

**Needs an in-game check** (HANDOFF §10.4): after a raid the toast appears, `have` is 0, and only
that raid's GPS screenshots are gone; the map is right on each map (including Ground Zero 21+,
`sandbox_high`); queue, cancel and queue again shows the right map.
