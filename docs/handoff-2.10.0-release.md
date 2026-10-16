# Handoff: verify and publish 2.10.0

For the **local Claude Code session on the owner's Windows PC**. Version 2.10.0 was built and tested in a Linux cloud session. **Your job:**
1. Check on Windows what Linux can't.
2. Report what you find.
3. With the owner's go-ahead, merge to `main` and publish.

Don't fix things on your own: if a check fails, stop, write it up on the issue (template in §5) and ask the owner.

## 0. What's in it
Branch **`release-next`**, version **2.10.0**, built on `main` = 2.9.0 (tag `v2.9.0`).

| Issue | What changed | Where |
|---|---|---|
| [#25](https://github.com/01Never/EFT-Squad-Task-Map/issues/25) | **AI Categorize chat removed**, page and server: `/api/ai/categorize`, `/api/ai/job`, the wiki fetching and `STM_WIKI_API`, and the Reasoning setting. Sorting into the default categories stays (it is rule-based: `actionOfObjective`), and so do Auto-sort, custom categories and moving by hand. The OpenAI key stays for Scan tasks and extracts. **A one-time reset** clears every `partCats` in every mode's list on first start; `catsResetAt` marks it done. | page: `web/js/features/tasks/categories.js` `resetPartCategoriesOnce`, `main.js`; server: `internal/httpapi`, `internal/app` |
| [#26](https://github.com/01Never/EFT-Squad-Task-Map/issues/26) | **Squadmates' tasks in your task list**: a colour box + name per visible friend on every row and popup (replaces "Also: …"). Friend-only tasks sit in their default categories after yours, **crosshatched**: you can select and pin them, but not tick, complete, add sub-tasks or move them; the rule functions refuse those too, not only the UI. "+N from squad" in the header; counts stay yours only. Each friend's ☰ Tasks switch is **on by default** (an explicit off is kept). | `web/js/features/squad/`, `web/js/features/tasks/` |
| [#27](https://github.com/01Never/EFT-Squad-Task-Map/issues/27) | **Squadmates on the map**: friend-only tasks use your own markers (category shape, colour, item icon, badges), **see-through** (0.5) and drawn under yours, and are clickable. **Friend-colour squares** sit at the bottom centre under each part's **main spot** (small, up to 4 then "+N"; opaque even on see-through markers). The old bottom-left dots and the friends' task-marker layer are gone. SPEC §7.3 and `CLAUDE.md` now list **three** see-through cases. | `web/js/map/markers.js`, `web/js/features/tasks/map-layer.js`, `web/js/features/squad/rules.js` (`squadSquaresOf`, `mainSpotIndex`, `squadMarkerLook`) |

Release notes: `docs/release-notes/2.10.0.md`. History entry: `docs/HANDOFF.md` §12.

**Saved data:** no version change (still v3).
- `aiOpen` is dropped on load.
- `catsResetAt` is new: absent means the reset hasn't run; `freshState()` sets it, so new users never reset.
- A pinned friend-only task is stored as an inactive entry (`active: false, pinned: true`) in that mode's list.

## 1. What the cloud session already verified (Linux, headless Chromium)
- `gofmt`, `go vet` and `go test ./...` are clean, and the removed AI routes return 404/405 (test). `npm test`: 235/235. `npm run typecheck` is clean.
- **Full browser suite on `release-next` with all three merged: 70 tests, 69 pass, 0 fail, 1 skip** (the `STM_E2E_STATE` test, which needs a real data file).
- **One flaky test was fixed.** `task-list.e2e.mjs` "switching game mode in Settings…" failed about 1 run in 3: the new mode's game data redraws the panel and could wipe the text being typed. The test now waits for that reload, and has passed 9 out of 9 runs since.
- `squad-tailnet.e2e.mjs` and the icon performance test are timing-sensitive under load. If one fails in the full suite, re-run that file alone before calling it a failure.
- **Squad browser tests** run three copies (Alice, Bob, Cara) on the dev transport. They cover:
  - colour boxes on rows, and crosshatched friend-only rows in the right default category
  - tick controls disabled on friend-only rows, and pinning one
  - ☰ Tasks on by default, and turning it off removes the friend's rows and markers
  - friend-only markers have the same shape and colour as yours, inner opacity 0.5, with exactly one square in the friend's colour under the main spot
  - shared tasks are opaque with the friend's square
  - clicking a friend-only marker selects it
  - no `.squad-dot` is left
- **One-time reset (browser test):**
  - an old file with moved parts and `aiOpen` loads with the moves cleared, every category kept, `aiOpen` gone and `catsResetAt` set
  - a later move by hand survives a reload
  - no request to `/api/ai/*` is made
- **The owner has already reviewed screenshots** of the squad list (crosshatch) and map markers (see-through plus squares), and chose small squares, see-through only, 4 squares then "+N", and the main spot only.

## 2. Get the build ready
```powershell
git fetch origin
git checkout release-next
git pull
go test ./...
npm test
npm run test:browser      # Edge; must be all green (1 skip is normal)
go build -trimpath -ldflags "-s -w" -o dist/SquadTaskMap.exe .
```
- Check the exe's Properties → Details: **File version and Product version must read 2.10.0**. The `.syso` was regenerated on Linux with `go-winres`. If it reads 2.9.0, run `go-winres make --arch amd64 --out rsrc`, rebuild, and commit the new `rsrc_windows_amd64.syso`.

## 3. Before touching the owner's real data
1. **Close every open Squad Task Map browser tab** and the running 2.9.0 copy. An old 2.9.0 tab saves without `catsResetAt`, which would make the category reset run again and undo hand moves made after updating.
2. **Copy the whole data folder** (next to the exe) to a dated backup.
3. Tell the owner: on first start, **every task goes back to its default category once**. Custom categories stay, but empty.

## 4. Checks on Windows and in-game
1. **First start:**
   - the task list is in the default categories
   - custom categories still exist, empty
   - the Tasks tab has no AI Categorize box
   - Settings → OpenAI has no Reasoning control
   - Scan tasks still works with the key
2. **A second start** doesn't reset again: move a task by hand, restart, and it stays where you put it.
3. **Squad, if a squadmate is available on the same game mode:**
   - Their tasks you don't have show crosshatched in the right categories, with their colour box. They can be selected and pinned, but not ticked.
   - On the map, their tasks are see-through versions of your markers, with their square under the main spot. Shared tasks are opaque with their square.
   - Turning their ☰ Tasks off removes all of it.
   - A friend still on 2.9.0 still connects.
4. **Squad on one PC, without a squadmate** (no Tailscale needed): run two copies with the dev transport and different scratch folders:
   ```powershell
   # Window 1
   $env:STM_DATA_DIR="$env:TEMP\stm-a"; $env:PORT="7801"; $env:STM_SQUAD_DEV_LISTEN="127.0.0.1:7901"; $env:STM_SQUAD_DEV_PEERS="127.0.0.1:7902"; .\dist\SquadTaskMap.exe
   # Window 2
   $env:STM_DATA_DIR="$env:TEMP\stm-b"; $env:PORT="7802"; $env:STM_SQUAD_DEV_LISTEN="127.0.0.1:7902"; $env:STM_SQUAD_DEV_PEERS="127.0.0.1:7901"; .\dist\SquadTaskMap.exe
   ```
   Then in each copy:
   1. Settings → Squad → Join with the key `tskey-auth-dev-test` (what the browser tests use with the dev transport).
   2. Give the two copies different names and colours.
   3. Add some different tasks to each.
   4. Turn on Share my tasks.
   5. Check the list and the map as in item 3, in Edge on Windows.
5. **Readability at normal zoom** (owner): the squares and the see-through markers are readable on a busy map (Customs, Streets).
6. **Idle CPU** with the map open while Tarkov runs: no worse than 2.9.0. No timers or animation were added; the AI chat's 1-second polling while it waited for an answer is gone.

## 5. Report
Comment on each issue (#25, #26, #27), with the owner's OK:
```
Windows check, 2.10.0 (release-next @ <commit>)
- [x]/[ ] <check>: <what happened>
Problems: <none / details, with screenshots>
```
If something fails, stop and ask the owner. The fix goes on `release-next` and the checks that touch it are re-run.

## 6. Publish (only after the owner says go)
1. Open a PR `release-next` → `main` titled "2.10.0: squadmates' tasks in your list and on the map; AI Categorize chat removed", with `Closes #25`, `Closes #26`, `Closes #27` in the body. Merge it once it's green, then `git checkout main; git pull`. (2.9.0 was merged straight onto `main`; either way is fine, as long as `main` ends up with exactly `release-next`.)
2. Follow `docs/HANDOFF.md` §3b "Each release":
   ```powershell
   $env:STM_RELEASE_KEY = "$env:AppData\SquadTaskMap\release-private-key.txt"   # if not set already
   go run ./cmd/release -version 2.10.0 -notes docs/release-notes/2.10.0.md
   gh release create v2.10.0 dist/SquadTaskMap.exe dist/latest.json --title "2.10.0" --notes-file docs/release-notes/2.10.0.md
   ```
   - The tool checks that the three versions match, runs the tests, builds and signs.
   - Attach **both** files.
   - Use `--prerelease` first if the owner wants the squad to wait.
   - Version comparison is numeric: 2.10.0 is newer than 2.9.0 (`updates/rules_test.go` covers it).
3. Deliverables (§3 checklist):
   - the exe + `USER-GUIDE.md` zip
   - the source zip: `git archive --format=zip --prefix=squad-task-map-2.10.0-source/ -o squad-task-map-2.10.0-source.zip HEAD`
4. Tell the squad to click **Check for updates**, and to close old tabs first. Their tasks go back to the default categories once.

## 7. Known notes and open items (not blockers)
- **Pinned friend-only tasks:** the "Pinned only" count and the "Clear pins" link count only your own tasks. A pinned friend-only task still shows under Pinned only, and Clear pins clears it. Ask the owner whether the count should include it.
- **Zoom for a friend-only task picked from the list:** it zooms to every spot of the part, including spots every friend has finished; the map hides those. Small follow-up if the owner wants them to match.
- **Close markers can cover each other's squares** (mostly clusters of possible item spots). #28 removes most of that.
- **Display bug:** in an opened row, the item tag ("journal · 4 possible spots") can overlap the end of the objective text. Small CSS follow-up.
- **#28** (one marker at the average location for possible item spots; click the task to reveal every spot) is open and not started. **#29** (stop splitting tasks) was closed as not planned; the owner is thinking of another approach.
- **Leftovers:**
  - The mock still has its fake categorize answer (`cmd/mock/openai.go`). The app no longer calls it, so it's harmless; remove it when convenient.
  - `tests/browser/harness.js` still normalises `/api/ai/job/` in its request log, also harmless.
  - The stored `openaiEffort` setting is still accepted by `PUT /api/ai/key` but unused.

## 8. Added by the local session: tickets 18 and 17
The cloud session built 2.10.0 from `main` without tickets 18 and 17, which were open as PRs #19 and #20. The owner asked for them to ship in this release, so the local session merged both into `release-next` (two merge commits) before publishing:
- **#18, default model `gpt-6-luna`:** kept for Scan tasks and the extract reader, both at Low reasoning, with the settings step 1→2 that moves a never-chosen `gpt-5.4-mini` to it. Its High reasoning for AI Categorize went away with #25.
- **#17, friends' positions:** a friend's last GPS position on the map you're on, faded after 5 minutes and gone after 30, a ◎ Pos switch per friend, and "Share my tasks" and "Share my position" on by default (settings step 2→3). The squad share carries both `mode` (#22) and `pos` (#17). Friend positions are their own layer, under your marker; #27's friend-only task markers are unchanged. SPEC §7.3 now lists four see-through cases.
- **In-game checks for these two:** `docs/HANDOFF.md` §10 items 15 (`gpt-6-luna` with a real key) and 16 (friends' positions on two PCs).
- **Open question on #17 (default used):** friends' positions show whatever game mode the friend is on, like drawings; only tasks follow the mode.
