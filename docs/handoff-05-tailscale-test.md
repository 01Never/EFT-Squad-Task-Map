# Handoff: test ticket 05 (squad) on a real Tailscale network

For the **local Claude Code session on the owner's Windows PC**. Ticket 05 ([issue #3](https://github.com/01Never/EFT-Squad-Task-Map/issues/3)) was built and tested in a Linux cloud session, against a fake Tailscale control server and a localhost "dev transport". This step checks what only a real tailnet and Windows can show. **Your job is to test and report, not to fix.** Write the results as a comment on issue #3 (template at the end); the cloud session fixes what you find and makes the 2.7.0 release.

## 0. What's being tested
- Branch **`claude/lucid-bardeen-7flotk`** (not `main` yet), version **2.7.0**.
- New: Settings → Squad (Join with an invite code, name and colour, Share my tasks, Leave), the Squad chips in the panel, friends' drawings in their colour, "Also: …" on shared tasks, marker dots, the Shared with squad filter, Friends' tasks.
- How it works: `internal/features/squad/README.md`. Owner setup: `docs/USER-GUIDE.md` → "Setting up a squad", and `docs/HANDOFF.md` §3c.

## 1. Get the build ready
```powershell
git fetch origin
git checkout claude/lucid-bardeen-7flotk
git pull
go test ./...
npm test
npm run test:browser      # Edge; about 4 minutes; must be all green (1 skip is normal)
go build -trimpath -ldflags "-s -w" -o dist/SquadTaskMap.exe .
```
Note the exe size (expected about 28 MB).

**Never use the owner's real data folder for these tests.** Every copy below gets its own scratch folder.

## 2. Tailscale setup (the owner does this in the browser)
Follow `docs/USER-GUIDE.md` → "Setting up a squad": a squad-only Tailscale account, the access-control policy (`tag:stm`, port 7777 only), and a **reusable, tagged `tag:stm`, non-ephemeral** auth key. Check the policy saves without errors (Tailscale validates it). Keep the key out of chat logs and commits.

## 3. Test A: two copies on this PC, real tailnet
Two copies on one PC each run their own Tailscale node, so the real tailnet can be tested before involving a squadmate. In two PowerShell windows:
```powershell
# Window 1
$env:STM_DATA_DIR="$env:TEMP\stm-squad-a"; $env:PORT="7801"; .\dist\SquadTaskMap.exe
# Window 2
$env:STM_DATA_DIR="$env:TEMP\stm-squad-b"; $env:PORT="7802"; .\dist\SquadTaskMap.exe
```
Then in each page (http://127.0.0.1:7801 and :7802): Settings → Squad → paste the key → Join. Give them different names and colours.

Check and note:
1. How long Join takes, and whether **Windows Firewall** asks about SquadTaskMap.exe (what it asks, what you clicked).
2. Both show "Connected · 1 of 1 friends online".
3. In the Tailscale admin console → Machines: two machines named `stm-<id>`, tagged `tag:stm`, "Expiry disabled".
4. **Drawing:** draw in A → appears in B in A's colour within about a second. Undo in A → gone in B. B's Draw toggle hides it.
5. **Tasks:** add the same task in both. Share my tasks on in A, off in B. In B, turn on A's Tasks toggle: "Also: <A>" on the row and popup, dots on the markers, the filter. A sees nothing of B's tasks.
6. **Offline:** close window 2 → A shows B "last seen …". Start it again → B reconnects by itself (no new Join) and its data refreshes.
7. **Files:** each scratch folder has `squad-task-map-tailscale\` and `squad-task-map-squad.json`. Check **`%LocalAppData%\Tailscale`** and **`C:\ProgramData\Tailscale`** were **not** created by the app (note if they existed before). Search both scratch folders for the auth key text: it must not appear anywhere.
8. **Leave** in B → B's `squad-task-map-tailscale\` is deleted, its chips are gone. In the admin console, **what happens to B's machine** (removed, or still listed as logged out)? This matters for the next check.
9. **Rejoin** B with the same key. Expected: B comes back as a **new** machine `stm-<new id>` (Leave gives the copy a fresh player id), and A sees B online again (as a new friend, the old entry offline) **without anything done in the admin console**. Note whether B's old machine is still listed (logged out) or gone.
10. **Removed by the owner:** delete A's machine in the admin console → A shows "Signed out…" (or similar). Note the exact text.
11. **Idle cost:** with both connected and nothing happening, Task Manager → Details: CPU (should round to 0) and memory (working set) of each SquadTaskMap.exe after 2 minutes. Also one copy that has **never joined** (a third scratch folder): CPU and memory, for comparison.

## 4. Test B: two PCs (owner + one squadmate)
The squadmate installs the 2.7.0 exe you built (send it privately; it isn't released yet) in a **new folder** with a fresh data folder, or uses `STM_DATA_DIR`. Then repeat checks 2, 4, 5 and 6 across the two PCs. Note whether they connect directly or through a relay if Tailscale shows it (admin console → the machine → connection info), and how quickly drawings arrive.

## 5. What not to do
- Don't commit to `main` or merge anything. Don't change the code: report instead.
- Don't paste the auth key into issue comments, commits or logs.
- Don't use the owner's real `squad-task-map-data.json`.

## 6. Report: comment on issue #3
```markdown
## Ticket 05: real tailnet test (2.7.0, branch claude/lucid-bardeen-7flotk @ <commit>)
Windows <version>, exe <size> MB. Browser suite: <pass/fail counts>.

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | Join time / firewall prompt | | |
| 2 | Connected status | | |
| 3 | Machines in console (name, tag, expiry) | | |
| 4 | Drawing live / undo / toggle | | |
| 5 | Tasks shared / not shared, badges, filter | | |
| 6 | Offline → last seen → reconnect | | |
| 7 | Files; no %LocalAppData%\Tailscale; key not on disk | | |
| 8 | Leave: folder deleted; console shows … | | |
| 9 | Rejoin: … | | |
| 10 | Machine deleted → app shows … | | |
| 11 | Idle CPU / memory: joined A, joined B, never joined | | |
| B | Two PCs: direct or relay, delay | | |

Problems (exact steps, what you expected, what happened, console window output):
- …
```
