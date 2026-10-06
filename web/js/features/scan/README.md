# Scan tasks

**What it does (player's view):** 📷 Scan tasks reads your task list from in-game screenshots.
Open Tasks in Tarkov and take a screenshot of each page; they show as thumbnails in a bar at the
top (× drops one). Done reads them with OpenAI, then a review dialog lists new tasks (ticked),
hand-in-only tasks, tasks already on your list, and names it didn't recognise (type the right
name). Confirming updates your list and deletes the screenshots; Cancel keeps them.

**Where the data comes from:** the screenshots folder (the server lists new non-GPS screenshots
while capturing: `internal/features/taskscan`, event `capture`); OpenAI's reading of each image
(`POST /api/scan/read`, through the server; the key never reaches the page); task names from the
game data.

**The rules** (`rules.js`):
- Names are matched exactly (lower case, letters and digits only), else to the most similar task
  name if at least `NAME_MATCH_MIN_SIMILARITY` = 0.82 alike (Levenshtein; v2's value: a misread
  letter or two still matches, another task's name doesn't). Names whose lengths differ by more
  than 8 aren't compared. Same-name tasks are told apart by the trader.
- A task on several screenshots keeps its highest progress (`matchScannedRows()`).
- The scan **replaces** your list (owner's decision after 2.0.1) only when every screenshot was read
  and something was recognised (`shouldScanReplaceList()`); otherwise it only adds. Replacing
  forgets every active task the screenshots didn't show (`features/tasks forgetTask()`).
- Screenshots are shrunk to `SCAN_IMAGE_MAX_EDGE_PIXELS` = 2048 px on the long edge (JPEG 0.9)
  before they're sent, `SCAN_PARALLEL_READS` = 3 at a time.
- The capture bar estimates about 1.5k input tokens per screenshot.

**Flow:** Scan → `startScan()` → `POST /api/scan/start` → screenshots → event `capture` →
`onCaptureChanged()` → thumbnails → Done → `POST /api/scan/stop`, `readCapturedScreenshots()` →
`POST /api/scan/read` per image → review → confirm: `activateTask()` per task, `forgetTask()` for
the rest when replacing, save, `POST /api/scan/confirm` (the server deletes only names in its
capture list) → toast "Added 6 tasks · removed 1 · deleted 1 screenshot". Cancel →
`POST /api/scan/cancel`.

**Saved data / settings:** changes `tasks` (and `ticks`, `used`, `subs` of forgotten tasks),
clears `showScanBanner`. Needs the OpenAI key and the screenshots folder (Settings).

**Privacy and cost:** each screenshot (shrunk) goes to OpenAI through the server, billed to your key.

**Files:**
- `rules.js`: name matching, sorting the results, replace or add, the cost estimate.
- `panel.js`: the capture bar, reading, the review dialog.
- `scan.css`: the capture bar and the review lists.

**Tests:** `rules.test.js` (exact, misspelt and unknown names; highest progress; replace or add;
the estimate). The browser suite (`ai-and-scan.e2e.mjs`) runs a scan against the mock: capture,
review, confirm deletes, cancel keeps. **Needs an in-game check:** scan accuracy with real
screenshots and a real model (HANDOFF §10).
