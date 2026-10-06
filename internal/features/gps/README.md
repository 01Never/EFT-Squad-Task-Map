# GPS: your position from screenshot names (`internal/features/gps`)

**What it does (player's view):** press your screenshot key in a raid and, about a second later,
your position and facing show on the map, with a trail of your last 5 positions. Drawing the
marker, the pulse, the off-screen chip and auto-center is the page's job: see
`web/js/features/find-me/README.md`.

**Where the data comes from:** during a raid, Tarkov puts your position and rotation into each
screenshot's **file name**. Only the name is read, never the picture. Real names from the owner's
screenshots folder (`testdata/screenshots/names.txt`):
```
2026-09-23[18-47]_-67.89, 7.79, -153.62_-0.02779, -0.75464, 0.03203, -0.65477_13.51 (5).png
2026-10-04[15-44] (0).png          ← taken in the menus: no position
2026-09-30[21-12]_25.35 (0).png    ← no position either
```
The shape is `date[HH-MM]_x, y, z_qx, qy, qz, qw[_extra] (n).ext`: the position in game units
(metres) and the rotation as a quaternion. The map isn't in the name; it comes from the game log
(`raid.CurrentMap`).

**The rules:**
- **A position name** (`ParseFileName`): `YYYY-MM-DD[HH-MM]`, an optional `_`, then
  `x, y, z_qx, qy, qz, qw`, then ` (n)` and `.png`, `.jpg`, `.jpeg` or `.bmp` (any case).
  - `x`, `y`, `z` need digits on both sides of the dot (`-67.89`); the quaternion's numbers may
    leave out the leading zero (`-.5`).
  - Anything after the seventh number is ignored, like the `_13.51` in the owner's names.
  - All seven numbers must be real numbers; otherwise the file has no position.
  - Any other picture (menus, the task list for a scan) has no position and goes to the task scan.
- **Axes:** `x` and `z` are the map's ground plane; `y` is height (the page uses it for the floor
  badge).
- **Heading** (`YawFromQuaternion`), in degrees: the file's components are taken in the order
  TarkovMonitor uses (its yaw function receives them as x, z, y, w), which is what tarkov.dev's map
  expects for its player arrow. Written with the file's names:
  `atan2(2·(qw·qy + qx·qz), 1 − 2·(qy² + qz²))`. No rotation (0, 0, 0, 1) faces 0°.
  Not yet confirmed in-game (HANDOFF §10.3). If the arrow is off by 90° or 180°, fix the component
  order here or the correction in the page's `arrowRotation`; never touch the projection.
- **Trail** (`NextTrail`): when a new position arrives, the previous one joins the trail if it was
  on the same map (two unknown maps count as the same), and only the last `TrailLength` = 5 are
  kept. On a different map the trail starts over. A raid start clears the trail but keeps the last
  position; a raid end clears both.
- **Time** (`t`): when the app saw the screenshot, in ms. The name only has minutes.
- `IsImageFile` (`.png`, `.jpg`, `.jpeg`, `.bmp`) is what the screenshots watcher looks at at all.
  `IsGPSFileName` is checked again at raid end before a file is deleted.

**Flow:**
```
screenshot file → screenshots.Watcher (OS file notification, settled ~0.8 s)
  → app.onScreenshot (internal/app/app.go) → gps.ParseFileName
      no position → taskscan.OnScreenshot
      position    → raid.NoteGPSShot(name) → raid.CurrentMap() → gps.Tracker.Update(fix, map)
                    → hub.Broadcast "gps" {gps: {map, x, y, z, yaw, t}, trail: [{x, z, t}, …]}
                    → live.js → find-me: onNewPosition() → renderPlayer() → renderClosestExtract()
                      → moveViewForNewPosition()
```
`/api/status` also returns `gps` and `trail`, so a page opened later shows the last position.

**Saved data / settings:** nothing saved; the last position and the trail live in memory. The
page's `followPosition` and `autoCenter` settings decide what the page does with a position (see
the find-me README).

**Files:**
- `rules.go`: `ParseFileName`, `IsGPSFileName`, `IsImageFile`, `YawFromQuaternion`.
- `tracker.go`: `Position`, `TrailPoint`, `NextTrail`, and `Tracker` (`Update`, `ClearTrail`,
  `Clear`, `Current`).
- `rules_test.go`: the tests.

**Tests** (`rules_test.go`):
- `TestScreenshotNamesMatchTheV2Results`: 102 names (the owner's 98 real ones, 43 of them with a
  position, plus 4 made up) give exactly v2's results (`testdata/golden/gps-names.json`): same
  x, y, z, and the same heading to within 1e-9.
- `TestPositionAndHeadingFromAName`, `TestMenuScreenshotsHaveNoPosition`,
  `TestTheIdentityRotationFacesZeroDegrees`.

Not covered by tests yet: `NextTrail` and `Tracker` (5 kept, reset on a map change).

**Needs an in-game check** (HANDOFF §10.3): take two screenshots facing along a straight road and
check the arrow points that way.
