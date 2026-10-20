# Handoff: verify and publish 2.11.0

For the **local Claude Code session on the owner's Windows PC**. Version 2.11.0 was built and tested in a Linux cloud session. **Your job:**
1. Check on Windows and in-game what Linux can't.
2. Report what you find.
3. With the owner's go-ahead, merge to `main` and publish.

Don't fix things on your own: if a check fails, stop, write it up on issue #31 (template in §5) and ask the owner.

## 0. What's in it
Branch **`release-2.11.0`**, version **2.11.0**, built on `main` = 2.10.0 (tag `v2.10.0`). One ticket:

**[#31](https://github.com/01Never/EFT-Squad-Task-Map/issues/31): The Lab, and a level picker** (owner's request, confirmed 2026-10-19)
- **The Lab is a normal map:** a card on the map picker (24 tasks in the PvP data), with tasks, extracts, loot, place names, your position and the squad.
  - Art: `assets/Labs.svg`, three WebP pictures stitched from tarkov.dev's tiles at zoom 4: 1st Level 761 KB, Second Level 416 KB, Technical 296 KB. That is 1.97 MB in the SVG.
  - Config: the `the-lab` entry in `assets/maps-config.json`, copied from tarkov.dev's `maps.json`.
  - No server change: the game log already mapped Labs to `the-lab`.
- **Level picker** (same toolbar control as the old floor dropdown; code in `web/js/features/levels/`, SPEC §7.4):
  - **Pick a level:** the map stays on it. A new screenshot moves your marker on the flat map but never changes the level. The owner's choice always wins.
  - **"All levels (follow me)":** each new GPS screenshot's height picks the level, using tarkov.dev's heights. Technical is below −0.9 m. Second Level is 3 m and up, inside its area. Everything else is the 1st Level.
- **Modular, by config only:**
  - `levelStyle: "overlay"`: today's floors drawn over the ground, the default for every existing map.
  - `levelStyle: "stacked"`: each level replaces the others; The Lab uses this.
  - `baseLevelName`: the name of the ground level in the picker.
  - No code names a map. Any map can switch by editing its config entry.
- **Other maps:**
  - They behave as before, starting on Ground.
  - They also get "All levels (follow me)".
  - Their level choice is now **remembered per map**. It used to reset to Ground each time the map opened.
- **Saved data:** optional `prefs[map].level`, written only when you pick a level. No version change, no migration needed.
- **Exe:** 30.0 → 32.0 MB (the art).

Release notes: `docs/release-notes/2.11.0.md`. History entry: `docs/HANDOFF.md` §12. The recipe to redo the art is in the same §12 entry.

## 1. What the cloud session already verified (Linux, headless Chromium)
- `go vet`, `go test ./...`, and `npm test` (304/304, 49 of them new) pass. `npm run typecheck` is clean.
- **Projection:** `tests/fixtures/projection-vectors.lab.json` holds 7 extracts and 5 loot containers from tarkov.dev's own map maths. They match within 0.05 SVG units, and the existing projection tests are unchanged.
- **No floor badge changed on any other map:** a run over 3,053,981 positions compared them against 2.10.0. Badge cases recorded from the old code are now in the tests.
- **Browser suite:** 93 tests; 90 pass, 2 skip (opt-in), 1 re-recorded.
  - The re-recorded one is `picker-counts-every-task`, because The Lab now has a card ("not shown on a map" went from 177 to 169).
  - The new `levels.e2e.mjs` passes 4/4. It covers: choosing Technical hides the other two pictures; a second-level screenshot keeps Technical; follow me switches to Second Level, then to Technical; the choice survives a reload; Customs works as before.
  - Idle paint on The Lab is 0.
- The owner has seen screenshots of the picker card, each level, and follow mode after an upstairs screenshot.

## 2. Get the build ready
```powershell
git fetch origin
git checkout release-2.11.0
git pull
go test ./...
npm test
npm run test:browser      # Edge; all green (skips are normal). squad-tailnet / icon perf tests are timing-sensitive: re-run a failed one alone.
go build -trimpath -ldflags "-s -w" -o dist/SquadTaskMap.exe .
```
- Check the exe's Properties → Details: **File version and Product version must read 2.11.0**. The `.syso` was regenerated on Linux. If it reads 2.10.0, run `go-winres make --arch amd64 --out rsrc`, rebuild, and commit the new `rsrc_windows_amd64.syso`.
- The exe should be about 32 MB.

## 3. Before touching the owner's real data
Nothing migrates in this release. As usual, use a scratch `STM_DATA_DIR` for your own tests, and close old tabs before the owner switches to the new exe.

## 4. Checks
**A. Without the game** (scratch data folder, scratch screenshots folder):
```powershell
$env:STM_DATA_DIR="$env:TEMP\stm-lab"; $env:STM_SCREENSHOTS_DIR="$env:TEMP\stm-lab-shots"; mkdir $env:STM_SCREENSHOTS_DIR -Force; .\dist\SquadTaskMap.exe
```
1. On the map picker, **The Lab** has a card with a picture and a task count. Open it: the art shows, and the picker says **All levels (follow me)**.
2. Choose each level from the dropdown. Only that level's picture shows, and the place names change with it.
3. Fake GPS screenshots, as the browser tests do. Create empty `.png` files in the scratch screenshots folder with these names; the content doesn't matter, only the name:
   - Second Level, inside its area: `2026-10-20[12-00]_-200.00, 4.00, -330.00_0.00000, 0.00000, 0.00000, 1.00000_1.00 (0).png`
   - Technical: `2026-10-20[12-01]_-200.00, -3.00, -330.00_0.00000, 0.00000, 0.00000, 1.00000_1.00 (0).png`
   - 1st Level: `2026-10-20[12-02]_-200.00, 1.00, -330.00_0.00000, 0.00000, 0.00000, 1.00000_1.00 (0).png`

   With **follow me**, each file switches the map to that level, and the position bar says "You (floor 2)", "You (B)" or no floor.

   With **Technical** chosen, the Second Level file moves the marker but the map stays on Technical.
4. Customs: the floor dropdown works as before, and now also lists "All levels (follow me)". A floor you pick is still picked after leaving the map and coming back.
5. Exe size and idle CPU on the Lab map: nothing new runs while idle.

**B. In-game (owner), a Labs raid:**
1. In follow me, screenshots on the 1st level, upstairs and in Technical switch to the right level.
   - Watch the stairs and **the hangar**, which is high but counted as 1st level.
   - Watch the Technical boundary, at −0.9 m.
2. With Technical chosen, a screenshot upstairs keeps Technical, and the marker sits at the right flat position.
3. Markers, extracts and your position line up with the art on every level.
4. With a squadmate: their position and their task markers show on The Lab too.

## 5. Report
Comment on issue #31, with the owner's OK:
```
Windows check, 2.11.0 (release-2.11.0 @ <commit>)
- [x]/[ ] <check>: <what happened>
Problems: <none / details, with screenshots or the screenshot file names used>
```
If tarkov.dev's height split is wrong somewhere, say where (position from the screenshot name, and the level it should be). The fix is a config change in `maps-config.json` extents; ask the owner before changing it.

## 6. Publish (only after the owner says go)
1. Open a PR `release-2.11.0` → `main` titled "2.11.0: The Lab, and a level picker that follows you", with `Closes #31` in the body. Merge it when it's green, then `git checkout main; git pull`.
2. Follow `docs/HANDOFF.md` §3b "Each release":
   ```powershell
   $env:STM_RELEASE_KEY = "$env:AppData\SquadTaskMap\release-private-key.txt"   # if not set already
   go run ./cmd/release -version 2.11.0 -notes docs/release-notes/2.11.0.md
   gh release create v2.11.0 dist/SquadTaskMap.exe dist/latest.json --title "2.11.0" --notes-file docs/release-notes/2.11.0.md
   ```
   - Attach **both** files.
   - Use `--prerelease` first if the owner wants the squad to wait.
3. Deliverables (§3 checklist):
   - the exe + `USER-GUIDE.md` zip
   - the source zip: `git archive --format=zip --prefix=squad-task-map-2.11.0-source/ -o squad-task-map-2.11.0-source.zip HEAD`
4. Tell the squad to click **Check for updates**.

## 7. Open questions for the owner (not blockers; ask, then note the answers on #31 or a new issue)
1. **"The Lab (dark)":** the game data has a separate map key, `the-lab-dark` (`laboratory_dark`), with 14 tasks. It isn't counted on The Lab card, and its GPS positions may not land on The Lab's art. Should it share The Lab's art and card? This needs a check of how the log names that map in a raid.
2. **Raw map keys in task rows:** "also on …" lists some maps by their key ("the-lab-dark, icebreaker") instead of a readable name. This is older than #31; it's a small separate ticket if the owner wants it.
3. **Other maps with full per-level art:** if tarkov.dev adds complete per-level pictures for another map, switching it to `"stacked"` is a config change plus art; see the §12 recipe.
4. Still open from earlier: **#28**, one marker at the average location for possible item spots.
