# AI Categorize

**What it does (player's view):** a chat box in the Tasks tab. You describe how you want your
tasks sorted ("anything that needs a key goes in a new Key runs category"); an OpenAI model reads
each task's objectives and wiki page and proposes moves, each with a reason. Nothing changes
until you tick the ones you want and click Apply selected; Undo takes them back. The scope is
this map's parts or all your tasks.

**Where the data comes from:** the parts in scope and your categories (sent with each request);
the model's answer from the server (`internal/features/aicategorize`, which also fetches the wiki).

**The rules** (`rules.js`):
- Each request carries the chat so far, and what you did with each answer ("applied 3", "undid",
  "discarded"), so follow-ups make sense (`chatHistoryForRequest()`).
- Applying first creates the proposed new categories (unless one with that name exists, in any
  case), just before Unsorted, then moves each ticked part as if you'd moved it by hand
  (`applyAssignments()`).
- Undo restores each part's previous choice and removes the categories the apply created, unless
  something is in them now (`undoAssignments()`).
- The chat is per map and kept only while the page is open.

**Flow:** Send (or Enter) → `sendInstruction()` → `POST /api/ai/categorize` (a job) → the page asks
`GET /api/ai/job/<id>` every `JOB_CHECK_INTERVAL_MS` = 1 s until it's done (the one place the page
polls, only while an answer is coming) → the answer with ticked moves → Apply selected →
`applyAssignments()` → save → `renderMapPage()`.

**Saved data / settings:** changes `cats` and `tasks[].partCats` on apply; `aiOpen` (box folded or
not). Uses the OpenAI key, model and reasoning effort (Settings → OpenAI).

**Privacy and cost:** task data and wiki excerpts go to OpenAI through the server, billed to your key.

**Files:**
- `rules.js`: the request's history, categories and parts; applying and undoing.
- `panel.js`: the box, the chat, asking and following the job, the handlers.
- `ai-categorize.css`: styles.

**Tests:** `rules.test.js` (history, applying before Unsorted, reusing a name, undo with and
without a category in use). The browser suite (`ai-and-scan.e2e.mjs`) adds the key, asks, applies
and undoes against the mock. **Needs an in-game check:** nothing.
