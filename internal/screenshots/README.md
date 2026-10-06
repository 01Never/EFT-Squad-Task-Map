# Screenshots folder (`internal/screenshots`)

**What it's for:** watching Tarkov's screenshots folder (`Documents\Escape From Tarkov\Screenshots`
by default, or the folder in Settings) and handing each new or removed picture to the app, which
passes it on to GPS or the task scan. It uses the operating system's file notifications (fsnotify,
which is `ReadDirectoryChangesW` on Windows): nothing is polled. It also reads a picture (for the
scan) and deletes one when a feature asks.

**What it deliberately doesn't do:**
- Decide what a picture means. The app asks `gps` (position in the name?) and otherwise
  `taskscan`.
- Delete anything on its own. Only two callers exist: `raid` (that raid's GPS shots, at raid end)
  and `taskscan` (the shots you confirmed in a scan), the two deletions CLAUDE.md allows.
- Look at subfolders or at files the app's `isImage` rejects (`gps.IsImageFile`: `.png`, `.jpg`,
  `.jpeg`, `.bmp`).

**The rules / limits:**
- **Settling.** The game writes a picture in pieces. After the last notification for a file, wait
  `settleDelay` = 400 ms and note its size; wait another 400 ms and hand it on once the size didn't
  change. Each new notification for the file restarts the wait. So a picture arrives about 0.8 s
  after the game finishes writing it. (v2 waited 400 ms once and didn't compare sizes.)
- A file that's gone when it settles is handed on with `Exists: false`; the scan then drops it from
  its list. That includes the app's own deletions.
- **Missing folder.** The folder only appears after your first screenshot. When it doesn't exist,
  the status says "Screenshots folder not found yet (it appears after your first screenshot)" and
  it looks again every `missingFolderRetry` = 60 s. When no folder is known at all: "Screenshots
  folder unknown — set it in Settings", with no retry.
- **Safe names.** `ReadFile` and `DeleteFile` take a plain file name only (no `/`, `\`, `.` or
  `..`) and work inside the watched folder, so a request can never reach another folder.
- **Status** (Settings → Screenshots folder): `ok`, `message`, `dir`. Scan tasks won't start unless
  `ok`.
- Goroutines: one reads the notifications until `Stop`; while the folder is missing, one checks
  once a minute instead. Each settling file has a timer; `Stop` cancels them.

**Flow:** `the game writes a .png → fsnotify event → scheduleSettle (400 ms) → settle (size
unchanged after another 400 ms) → onSettled(File) → app.onScreenshot → gps.ParseFileName → GPS
(raid + gps) or taskscan.OnScreenshot`.

**Settings:** `screenshotsPath` (empty = found by `gamefolders`); changing it restarts the watch.
`STM_SCREENSHOTS_DIR` overrides the detected folder (tests).

**Files:** `watcher.go`: `Watcher` (`Start`, `Stop`, `Status`, `Dir`, `ReadFile`, `DeleteFile`)
and the settling timers.

**Tests:** `watcher_test.go`: a new picture is handed on once after it settles, also when written in two steps; a removed file reports as removed; read and delete refuse anything but a picture's own name in the folder (including "..." and ". .", which Windows would read as the folder itself: found by the tests and fixed in ticket 04); a missing folder reports why; the missing-folder retry only restarts its own watch. **Needs a Windows check:** notifications arrive for the owner's real
folder (Documents may be on OneDrive), and a GPS shot reaches the map in about a second.
