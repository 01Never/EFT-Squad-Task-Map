# Scan tasks (`internal/features/taskscan`)

**What it does (player's view):** click **Scan tasks**. In Tarkov, open Tasks and press your
screenshot key on each page; each screenshot shows up as a thumbnail in the capture bar (× takes
one out). Click **Done**: every screenshot is read by the OpenAI vision model, the names are
matched to tasks, and a review lists the new tasks, the ones already on your list, and names it
didn't recognise (you can type the right name). Confirm, and your task list becomes what the scan
found and the screenshots are deleted. Cancel changes nothing and deletes nothing.

**Where the data comes from:** new pictures in the screenshots folder (`internal/screenshots`),
the OpenAI Responses API (vision, with your key), and the task data (for matching, in the page).

**Who does what:**
- **Server (this package):** capture mode, which files belong to the scan, serving those pictures
  to the page, sending one picture to OpenAI and cleaning the answer, deleting the confirmed files.
- **Page (`web/js/scan.js`; moves to `web/js/features/scan/` in ticket 04b):** the capture bar,
  shrinking the pictures, reading 3 at a time, matching names (`web/js/logic/match.js`), the
  review, and **replacing the task list**.

**The rules:**

*Capture (server):*
- **Start** fails when the screenshots folder isn't being watched; the error is the folder's
  status message and the page opens Settings.
- While capture is on, a new screenshot joins the list if it has no position in its name (those
  go to GPS) and the game wrote it no earlier than `captureClockSlack` = 2 s before Scan tasks was
  clicked (slack between the file's time and the PC clock).
- The list is oldest first, by the file's time; files written in the same millisecond (the game
  writes one at a time, so only in tests) are ordered by name, which follows Tarkov's " (0)", " (1)"
  numbering.
- A listed file deleted from disk drops off the list. × on a thumbnail (`Remove`) takes it off the
  list; the file stays.
- **Only listed files** are ever served to the page (`/api/scan/image`; any other name is "Not
  found") or deleted.
- **Done** (`Stop`): capture turns off; the list stays while the page reads it.
- **Confirm** (`Confirm`): deletes only names that are on the list, through
  `screenshots.DeleteFile` (plain names inside the screenshots folder), then ends the scan and
  returns how many were deleted. This is one of the two deletions CLAUDE.md allows.
- **Cancel**: forgets the list. Nothing is deleted.

*Reading one screenshot (server, `Read`):*
- Needs the OpenAI key ("Add your OpenAI API key first").
- The page sends the picture as a `data:image/jpeg|png|webp;base64,…` URL of at most
  `maxImageDataURLLength` = 25,000,000 characters (the page's ≤ 2048 px JPEGs are far smaller).
  Anything else is "Bad image".
- One Responses API call: the picture at `detail: high`, a strict JSON schema
  `{rows: [{name, trader or null, progress or null}]}`, and instructions: return every row whose
  task name you can read, the name exactly as written, the trader only if it's written as text,
  progress as a whole percent; skip headers and unreadable rows; don't invent rows.
- Model: the one in Settings (default `gpt-5.4-mini`). Reasoning effort is always `low` for models
  that take one (gpt-5…, gpt-6…, o…), whatever the Reasoning setting says. Kept from v2; SPEC §8
  says to reuse the setting (HANDOFF §11, known gap).
- Cleaning (`cleanRows`): rows without a name are dropped; the name is trimmed and cut at 120
  characters, the trader at 40; progress is kept only when it's a whole number, then limited to
  0–100.
- Errors: OpenAI's own ("OpenAI 401: … (check the API key)") reach the page as status 502; a
  refusal is "The AI declined: …"; an answer that isn't the expected JSON is "The AI didn't return
  a readable list for this screenshot".

*In the page (for the whole picture):*
- Each picture is shrunk to at most 2048 px on its long edge (JPEG, quality 0.9) and 3 are read at
  a time.
- Matching: the same name ignoring case and punctuation; otherwise the closest name with a
  similarity of at least 0.82 (shown as "spelling fixed"); the trader breaks ties between tasks with
  the same name. Story chapters aren't in tarkov.dev's data, so they show as "Not recognised".
- **Confirm replaces the list** (owner's decision after 2.0.1): ticked new tasks are added
  (`source: "scan"`, with the game's progress), tasks already on the list get the new progress,
  and every active task that isn't in the scan is removed as if it never existed (`forgetTask`:
  its entry, ticks, used counts and sub-tasks), with no list shown first. Removal is skipped when
  any screenshot failed to read or nothing was recognised; then the scan only adds. The page saves
  first, then asks the server to delete the screenshots.

**Flow:**
```
Scan tasks → POST /api/scan/start → Scan.Start → Broadcast "capture" {files: []}
screenshot → screenshots watcher → app.onScreenshot → (no position) Scan.OnScreenshot
  → Broadcast "capture" {files} → live.js → scan.js onCapture → thumbnails (GET /api/scan/image)
Done → POST /api/scan/stop → page reads 3 at a time: POST /api/scan/read
  → app.ReadScanImage → Scan.Read → OpenAI → {rows}
  → page matches names → review → "Update list & delete N screenshots"
  → page replaces the list and saves (PUT /api/state)
  → POST /api/scan/confirm {names} → Scan.Confirm (deletes) → Broadcast "capture" {files: [], done: true}
Cancel → POST /api/scan/cancel → Scan.Cancel → Broadcast "capture" {files: [], cancelled: true}
```

**Saved data / settings:** no files of its own; the capture list lives in memory. Uses the
`openaiKey` and `openaiModel` settings (through the app) and watches the folder from
`screenshotsPath`. What it changes in the page's saved data (through the page):
`tasks[id]` (`active`, `source`, `addedAt`, `gamePct`, `scannedAt`), the removed tasks' ticks,
`used` and `subs`, and `showScanBanner`.

**Files:**
- `rules.go`: the rules as plain functions: `IsTakenDuringCapture` (with `captureClockSlack`),
  `imageContentType`, which image uploads are accepted, `cleanRows`.
- `taskscan.go`: capture mode (`Start`, `Stop`, `Cancel`, `IsActive`, `OnScreenshot`, `List`,
  `Remove`, `Image`, `Confirm`) and reading (`Read`, the instructions and schema).
- Page: `web/js/scan.js`, `web/js/logic/match.js`, `forgetTask` in `web/js/logic/state.js`.

**Tests:** `taskscan_test.go` (v2's "capture mode and safe deletion", ported): Start fails without a watched folder; only shots written after Start count; only listed files are served, with the right type; Confirm deletes only listed names and ends the scan; Cancel deletes nothing; same-time shots are ordered by name; rows are cleaned (trimmed, cut, progress kept within 0–100). The offline mock (`go run ./cmd/mock`) fakes the vision answer;
its rows can be changed with `POST /set-rows`.

**Needs an in-game check** (HANDOFF §10.6): scan accuracy with real screenshots and a real model,
and that a full scan leaves exactly the in-game list.
