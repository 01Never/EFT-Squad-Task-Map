# Handoff: verify and publish 2.9.0

This is for the **local Claude Code session on the owner's Windows PC**. Version 2.9.0 was built and tested in a Linux cloud session. **Your job:**
1. Check on Windows and in-game what Linux can't.
2. Report what you find.
3. With the owner's go-ahead, merge to `main` and publish the release.

Don't fix things on your own: if a check fails, stop, write it up on the issue (template at the end) and ask the owner.

## 0. What's in it
Branch **`release-2.9.0`**, version **2.9.0**. It contains three GitHub issues:

| Issue | What changed | Where |
|---|---|---|
| [#21](https://github.com/01Never/EFT-Squad-Task-Map/issues/21) | While Scan tasks is capturing, **every** new screenshot goes to the scan, even with a position in its name. This covers screenshots taken in a raid, or while the game wrongly thinks it's in one. Such a shot also moves your marker. It is not a raid GPS shot, so it's never deleted at raid end and never causes a false "Raid over". | `internal/app/screenshot_routing.go`, `app.onScreenshot` |
| [#22](https://github.com/01Never/EFT-Squad-Task-Map/issues/22) | **One task list per game mode** (saved data v3, details below). Task and raid-end events from the log carry the mode they happened in and go to that mode's list. The squad share has a `mode` field, and friends' tasks show only in the same mode. | `web/js/app/saved-data.js`, `current-list.js`, `internal/storage/state.go`, `internal/features/raid/rules.go`, squad |
| [#23](https://github.com/01Never/EFT-Squad-Task-Map/issues/23) | The home page is a **game mode select** page (`#/`), then `#/<mode>/maps`, then `#/<mode>/map/<key>`. Breadcrumbs like `PvE / Maps / Customs` lead back, and phones get a "‹ Maps" link. Old `#/map/<key>` links redirect. | `web/js/app/addresses.js`, `routing.js`, `web/js/features/mode-select/` |
| QA fix | The server refuses saved data with a lower version than the file on disk. Without it, a 2.8.x tab left open after the update would save over the migrated v3 file and turn it back into v2. | `internal/storage/state.go` `WriteStateText` |

**Saved data v3:**
- `modes: { regular, pve, "pvp-season" }` holds `tasks`, `ticks`, `used`, `have` and `subs` for each mode. Everything else stays shared.
- On first start, the 2.8.x list moves into the mode Settings has. The other two modes start empty.
- The server first keeps a one-time copy of the old file, `squad-task-map-data.v2-backup.json`.

Release notes: `docs/release-notes/2.9.0.md`. In-game checks: `docs/HANDOFF.md` §10, items 7–14.

## 1. What the cloud session already verified (Linux, headless Chromium)
- `gofmt`, `go vet`, `go test ./...` (including `-race` on app, squad and storage), `npm test` (210/210) and `npm run typecheck` are all clean. The Windows cross-build succeeds (about 30 MB).
- **Browser suite:**
  - Full suite before the QA fix: 68 pass, 0 fail, 1 skip. The skip is the `STM_E2E_STATE` test, which only runs with a real data file.
  - After the QA fix: the saved-data, task-list and mode-select files passed four runs in a row. One earlier run of those files had a single failure that I didn't capture and couldn't reproduce.
  - **The cloud session's final full-suite run after the QA fix is summarized at the end of this file.**
- `squad-tailnet.e2e.mjs` is timing-sensitive under load. It went 4/4 green alone on both `main` and the release. One failure under load is not a regression.
- **Migration tested on scratch data folders with the real page:**
  - The rich v2 fixture, a large 54-task v2 file, a partial v2 file and a v1 file, each with Settings at `pvp-season`, `pve`, or no `gameMode`.
  - Every task, tick, sub-task, category and drawing kept, under the right mode.
  - Backups match the original byte for byte, and a second start doesn't touch them.
- **Simulated against the offline mock:**
  - Session-mode lines.
  - A PvE task event while PvP Season is shown: it lands only in the PvE list, with the toast "Added from the game (PvE list): …".
  - A PvE raid end: only PvE's bag counts reset.
  - A scan with a position-named shot, in a raid and in a "stuck" raid: captured, the marker moves, the file is not deleted at raid end, and no false "Raid over".
  - The mode cards and "Game is in this mode".
- The stale 2.8.1 tab case (QA script) is now fixed: the file stays v3.

## 2. Get the build ready
```powershell
git fetch origin
git checkout release-2.9.0
git pull
go test ./...
npm test
npm run test:browser      # Edge; must be all green (1 skip is normal)
go build -trimpath -ldflags "-s -w" -o dist/SquadTaskMap.exe .
```
Then:
- Check the exe's Properties → Details. **File version and Product version must read 2.9.0.** The `.syso` was regenerated on Linux with `go-winres`. If it reads 2.8.1, run `go-winres make --arch amd64 --out rsrc`, rebuild, and commit the new `rsrc_windows_amd64.syso`.
- If `squad-tailnet.e2e.mjs` fails once, re-run that file alone before calling it a failure (see §1).

## 3. Before touching the owner's real data
This release migrates the owner's real `squad-task-map-data.json`. Before the owner starts 2.9.0 on it:
1. **Close every open Squad Task Map browser tab** and the running 2.8.1 copy.
2. **Copy the whole data folder** (next to the exe) to a dated backup, e.g. `SquadTaskMap-data-backup-2026-10-14`. The app makes its own `.v2-backup.json`, but a full copy also covers settings, the squad file and the icon cache.
3. Note which mode Settings has (Settings → Game mode). **The existing list goes under that mode.** If the owner's current list is really their PvP Season list, Settings must say PvP Season before the first start.

## 4. Checks on Windows and in-game
Work through `docs/HANDOFF.md` §10 items 7–14 with the owner. In short:
1. **First start (item 10):**
   - The old list shows under the mode Settings had, and the other two cards on the Game mode page show 0 tasks.
   - `squad-task-map-data.v2-backup.json` exists. After a restart its modified time is unchanged.
2. **Game mode page (13) and crumbs (14):**
   - The app opens on the PvE / PvP / PvP Season cards.
   - The card of the mode the game is in says "Game is in this mode", and it moves when the owner switches mode in the game.
   - Opening a card switches Settings. `PvE / Maps / Customs` crumbs and the browser's Back button work.
   - An old bookmark `#/map/customs` still opens Customs.
   - At phone width (Edge dev tools), the "‹ Maps" link shows.
3. **Per-mode lists (9):**
   - Switch between modes; each keeps its own list.
   - With the page on PvP Season, accept or finish a task in a **PvE** raid. It lands in the PvE list (toast "(PvE list)"), and PvP Season is unchanged.
4. **Scan in a raid (7), the owner's original bug:**
   - Press Scan tasks in a raid, open the in-game Tasks screen and take screenshots. They appear as thumbnails and the marker moves.
   - Leave the raid. The toast shows no deleted count for them and the files are still there.
   - Done, then Confirm. Only then are they deleted, and only the shown mode's list changes.
5. **Scan in the menus (8):** works as before.
6. **Raid end (11):** after a raid, that mode's Bring counts are 0 and the other modes' are untouched.
7. **Squad (12)**, if a squadmate is available:
   - Friend on a different mode: no tasks from them, but drawings show.
   - Same mode: their tasks show.
   - A friend still on 2.8.1 still connects; their tasks show as before.
8. **Stale tab guard:**
   - Start 2.8.1 with a scratch data folder (`$env:STM_DATA_DIR`) and keep its tab open.
   - Close 2.8.1, start 2.9.0 on the same scratch folder, and open a new tab.
   - Tick something in the **old** tab. The scratch `squad-task-map-data.json` must still say `"version": 3`. The old tab can't save and shows its saving error.
9. **Idle CPU** with the map open while Tarkov runs: no worse than 2.8.1 (nothing in this release adds timers or animation).

## 5. Report
Comment on each issue (#21, #22, #23), with the owner's OK:
```
In-game check on Windows, 2.9.0 (release-2.9.0 @ <commit>)
- [x]/[ ] <check>: <what happened>
Problems: <none / details, with screenshots or log lines>
```
If something fails, stop here and ask the owner. The fix goes on `release-2.9.0` and the checks that touch it are re-run.

## 6. Publish (only after the owner says go)
1. Open a PR `release-2.9.0` → `main` titled "2.9.0: scan in raid, one task list per game mode, game mode home page", with `Closes #21`, `Closes #22`, `Closes #23` in the body. Merge it once CI (if any) is green. Then `git checkout main; git pull`.
2. Follow `docs/HANDOFF.md` §3b "Each release":
   ```powershell
   $env:STM_RELEASE_KEY = "$env:AppData\SquadTaskMap\release-private-key.txt"   # if not set already
   go run ./cmd/release -version 2.9.0 -notes docs/release-notes/2.9.0.md
   gh release create v2.9.0 dist/SquadTaskMap.exe dist/latest.json --title "2.9.0" --notes-file docs/release-notes/2.9.0.md
   ```
   - The tool checks that the three versions match, runs the tests, builds and signs.
   - Attach **both** files.
   - Consider `--prerelease` first if the owner wants the squad to wait (HANDOFF §3b "Test versions").
3. The §3 checklist deliverables:
   - the exe + `USER-GUIDE.md` zip
   - the source zip: `git archive --format=zip --prefix=squad-task-map-2.9.0-source/ -o squad-task-map-2.9.0-source.zip HEAD`
4. Tell the squad to click **Check for updates**. Tell them:
   - Their current list goes under the game mode their Settings shows. They should set the right mode **before** updating.
   - They should close old tabs first.

## 7. Known notes (not blockers)
- Going back to 2.8.x after updating breaks the list: 2.8.x reads a v3 file as v1. The release notes say so and point to `squad-task-map-data.v2-backup.json`.
- `TaskExists` checks the shown mode's game data. tarkov.dev uses the same task ids in every mode, so this only matters for a task that exists in one mode only.
- While the session mode is unknown (the app started after the game wrote it), log events go to the Settings mode's list. This is the "phantom tasks" suspect, HANDOFF §11.
- The mode card's task count counts every active entry. The picker drops tasks missing from the current game data, so the numbers can differ slightly.

## Final full browser-suite run (cloud, after the QA fix)
Pending when this was first pushed; see the next commit.
