# Game log (`internal/features/gamelog`)

**What it does (player's view):** accept a task in Tarkov and it's on your list within about
5 seconds ("Added from the game: …"); finish or fail one and it quietly leaves the list. The top
bar shows "● In raid: <map>" while you're in a raid. When the game says it's in a different game
mode from the data you picked, the bar offers "Switch data". When the game's screenshot key can't
work for GPS, you get a warning (a toast, and a line in Settings under the screenshots folder).

This package only reads the logs and says what happened. What the app does about it is in
`internal/app/app.go` (`onLogEvent`), `raid` and `events`.

**Where the data comes from:** Tarkov writes one folder of logs per game session inside its `Logs`
folder (found by `internal/gamefolders`, or set in Settings), e.g.
`log_2026.10.04_22-11-56_1.1.5.1.47510\`. Two of its files matter:
- `… application_000.log`: game mode, map loading, raid start, back in the menus, matchmaking
  cancelled, the control settings.
- `… push-notifications_000.log`: what the game server pushes: chat messages (task started,
  finished, failed) and "match over".

An entry is a header line, sometimes followed by a JSON block:
```
2026-10-04 22:12:05.947|1.1.5.1.47510|Info|application|Session mode: Pve
2026-10-04 23:38:56.663|1.1.5.1.47510|Info|push-notifications|Got notification | ChatMessageReceived
{
  "type": "new_message",
  "message": { "type": 10, "templateId": "665eec1f5e47a79f8605565a description", … }
}
```
Some game versions add a time zone after the time (`11:25:03.123 -05:00|`); both forms are read.
The formats were checked against the owner's real logs from 2026-10-04, kept (ids and tokens
redacted) in `testdata/logs/real-session/`. TarkovMonitor (GPL) was read for the formats only.

**The rules:**

*Cutting text into entries* (`SplitEntries`):
- An entry starts at a line that begins with `YYYY-MM-DD HH:MM:SS.mmm`, an optional time zone,
  and `|`. The lines up to the next header belong to it.
- A JSON block starts at a line beginning with `{` and ends at the first line beginning with `}`.
- The last entry of a read is held back (the "rest", put in front of the next read) while it may
  still be being written: no newline at the end yet, or a JSON block with no closing `}` line.
- Text before the first header is the tail of an entry we never saw the start of: ignored.
- `Control settings:` writes its whole JSON on one line (`{"InvertedXAxis":…}`), so no line starts
  with `}`. When it's the last entry so far it waits for the next entry to start. In the real log
  that's "Session mode", 3 seconds later. v2 did the same.

*What an entry means* (`EventsFrom`). One entry can give several events; most give none.

| The log says | Event | Notes |
|---|---|---|
| `Got notification \| ChatMessageReceived` with JSON `message.type` 10, 11 or 12 | `task`: started (10), failed (11), finished (12) | The task id is the first word of `message.templateId` (`"<id> description"`, `"<id> successMessageText"`) and must be 24 hex characters, like tarkov.dev ids. Other chat messages (type 7 in the real log: rewards) are ignored. |
| `Got notification \| UserMatchOver` | `raidLeft` | The server says the match is over. |
| `Session mode: <name>` | `mode` | `Pve`/`PVE` → `pve`; `Regular`/`PVP` → `regular`; `PvpSeason`/`Seasonal`/`SZN` → `pvp-season` (`ResolveMode`, any case). Unknown names give no event. |
| `scene preset path:maps/<name>.bundle` | `mapLoading` | The map being loaded, e.g. `maps/rezerv_base_preset.bundle`. |
| `TRACE-NetworkGameCreate profileStatus … Location: <nameId>,` | `mapLoaded` | e.g. `RezervBase`, `Sandbox_high`. |
| `application\|GameStarted` | `raidStart` | Carries the entry's date. |
| `SelectProfile ProfileId:`, `…SelectedProfile ProfileId:` (also `CompleteSelectedProfile`), `PrepareSelectedProfileLocally ProfileId:` | `profileSelected` | Back in the menus. The real log writes them in groups: 5 after each raid, 2 at start-up, 2 after a cancelled matchmaking. TarkovMonitor treats them as raid end; `raid` decides. |
| `Network game matching aborted` / `cancelled` | `matchingAborted` | Matchmaking was cancelled: no raid on the loading map. |
| `Control settings:` with JSON | `keybind` | See "Screenshot key" below. |

*Screenshot key* (`ScreenshotKeyCheck`): find the key binding named `MakeScreenshot`. Each binding
has two slots (`variants`). A slot works when it's an axis, or when it has at least one key and
none of its keys is `SysReq` (Print Screen: Tarkov doesn't receive it). **One working slot is
enough** → ok. Otherwise, if a slot holds `SysReq`, the warning is "Tarkov's screenshot key is bound
in a way that doesn't work (SysReq)…"; if nothing is bound, "No screenshot key is bound…".

**Two problems found against the owner's real logs (2026-10-04):**
- *False SysReq warning.* The owner's binding is `SysReq` + `KeypadEnter`. v2 only looked at the
  first slot that had a key, saw `SysReq`, and warned although `KeypadEnter` works. Fixed in
  `ScreenshotKeyCheck` (and in v2's `server/logparse.ts`): any working slot is enough. The test
  case "one working slot is enough" uses the owner's binding.
- *Two "Session mode" lines at start-up.* The real log has `Session mode: Pve`, then 22 seconds
  later `Session mode: PvpSeason`. Both events are passed on in order and the last one counts: the
  server keeps the latest (`raid.SetSessionMode`). The page used to raise "Game says PvE · Switch
  data" on the first line and never clear it when the second, matching line came. Fixed on the
  page (`web/js/live.js`, the `mode` handler): a mode that matches the data you picked now clears
  the prompt. Task events in those 22 seconds are checked against "PvE"; none are expected that
  early.

*Watching the files* (`watcher.go`):
- `pollInterval` = 5 s: compare each file's size with how far it was read, and read only the new
  bytes. A size check costs almost nothing while Tarkov runs (the same approach as TarkovMonitor;
  CLAUDE.md: no faster timers).
- `folderRescanEvery` = 6 polls (30 s): look for a newer session folder (the game was restarted) and
  for new files in the current one (a rotated `…_001.log`).
- The newest session folder is the last subfolder in name order: `log_YYYY.MM.DD_HH-MM-SS_…` sorts
  by time.
- Files followed: names ending in `.log` that contain `notifications` or `application` (any case).
- **No catch-up.** At start-up the existing files are read from their end: nothing that happened
  before the app started is replayed. A session folder that appears while the app runs, and new
  files in the current one, are read from their start.
  - So if you start the app after the game, it never sees that session's `Session mode` and
    `Control settings` lines: the session mode stays unknown (task events then count whatever the
    mode; see `raid`), and the screenshot key isn't checked.
- `maxBytesPerRead` = 4 MB per file per poll; anything more is read on the next poll.
- A file that got smaller than what was read (replaced or truncated) is read again from its start.
- A UTF-8 character cut in half at the end of a read is held back until the next read
  (`decodeUTF8Stream`), so names like "Kraków" never break.
- `maxIncompleteEntry` = 1,000,000 characters: a held-back "unfinished entry" that long is junk and
  is dropped.
- `missingFolderRetry` = 60 s: when the Logs folder you set (or that was found) doesn't exist yet,
  check again once a minute. When no folder is known at all, there's nothing to retry; Settings
  says "Couldn't find Tarkov's Logs folder — set it in Settings".
- Status, shown in Settings → Game logs folder: `ok`, `message` ("Watching", "Logs folder not
  found", …), `dir`, and `folder` (the session folder being read).

**Flow:**
```
Tarkov writes a line
  → (within 5 s) Watcher.Poll → readNewBytesLocked → Feed → SplitEntries → EventsFrom
  → app.onLogEvent (internal/app/app.go), one event at a time, in log order:
      task             → onTaskChanged: raid.ModeMatches + gameData.TaskExists
                         → hub.Deliver "task" → live.js: activate() + toast, or finish() quietly
      mode             → raid.SetSessionMode → hub.Broadcast "mode" → live.js: "Switch data" prompt
      mapLoading       → gameData.MapFromScene → raid.MapLoading → Broadcast "raidMap" → nav bar
      mapLoaded        → gameData.MapFromNameID → raid.MapLoaded (no event)
      raidStart        → raid.Start, gps trail cleared → Broadcast "raidStart" → live.js: "● In raid"
      raidLeft,
      profileSelected  → raid.ShouldEndOnMenuReturn → app.endRaid → Deliver "raidEnd"
      matchingAborted  → raid.MatchingAborted (no event)
      keybind          → onScreenshotKeyChecked → Broadcast "keybind" → live.js: toast if not ok
```
The events are handed over from the polling goroutine, after the watcher has released its lock.

**Saved data / settings:** nothing of its own. The app passes in the `logsPath` setting (empty =
found by `gamefolders`) and restarts the watcher when it changes. `STM_LOGS_DIR` overrides the
detected folder (tests and the offline mock setup).

**Files:**
- `rules.go`: the parser. `SplitEntries`, `EventsFrom`, `ResolveMode`, `ScreenshotKeyCheck`. Plain
  functions over text, no file access.
- `watcher.go`: `Watcher`. Finds the newest session folder, polls the files, reads new bytes and
  feeds the parser. `Start`, `Stop`, `Status`; `Poll` and `Feed` are exposed for tests.
- `gamelog_test.go`: the tests.

**Tests** (`gamelog_test.go`):
- `TestParserMatchesTheV2GoldenEvents`: the Go parser gives exactly the events v2's TypeScript
  parser gave (`testdata/golden/log-events.json`) for
  - the owner's real session (`testdata/logs/real-session/`): 7 task events, raids on Reserve,
    Ground Zero (`sandbox_high`) and Lighthouse, a cancelled matchmaking, the two Session mode
    lines, the `SysReq` + `KeypadEnter` binding (ok);
  - `testdata/logs/synthetic.log`: every event kind and all three screenshot-key outcomes.
- `TestTaskMessagesBecomeTaskEvents`: types 10 and 12 become started and finished.
- `TestAnEntryCutInsideItsJSONWaitsForTheRest`.
- `TestScreenshotKeyCheck`: the owner's binding is ok; SysReq alone warns; nothing bound warns;
  a normal key is ok.
- `TestWatcherStartsAtTheEndReadsNewBytesAndFollowsANewSession`: old lines aren't replayed; new
  bytes are read; a new session folder is picked up on the 6th poll and read from its start.
- `TestWatcherHandlesSplitWritesAndAShrinkingFile`.
- `TestAUTF8CharacterCutBetweenReadsIsKeptWhole`.

Not covered by tests yet: the missing-folder retry, the 4 MB read cap, rotated files in the same
session.

**Needs an in-game check** (HANDOFF §10.2): accept a task → on the list within about 5 s; finish
one → gone; with the setting on PvP Season, PvE task events are ignored; raid start and end; no
screenshot-key warning with the owner's binding; starting the app after the game.
