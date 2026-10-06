# Settings

**What it does (player's view):** ⚙ Settings: the game mode (which task data to use, and which
game sessions' log events count), the game logs and screenshots folders (found automatically,
with ✓ or why not), "Follow my position", "Center the map on me", the game data in use with
"Update game data now", and the OpenAI key (its own dialog: key, model, reasoning effort,
"Save & test", "Remove key"), and the Updates section (`features/updates`).

**Where the data comes from:** `/api/status` (the settings, folder checks, game data, key status);
the server keeps them in `squad-task-map-settings.json` (`internal/storage`, wired in `internal/app`).

**The rules** (`rules.js`):
- The game data line: "PvP · 515 tasks · downloaded 2 min ago" / "saved copy from …" / "built-in
  copy (date)" (`gameDataDescription()`, `timeAgo()`).
- The model field suggests `DEFAULT_AI_MODEL` = gpt-5.4-mini; reasoning: Default, Low, Medium, High.
- The server tests a key with OpenAI before saving it; the page only ever sees it masked.

**Flow:** Save → `PUT /api/settings` → the answer's status replaces `app.status` → toast "Settings
saved" → `rerenderPage()`. ◎ Follow on the map changes the same `autoCenter` setting
(`features/find-me`). Update game data → `POST /api/data/refresh` → `reloadGameData()`. Key →
`PUT /api/ai/key` (or `DELETE`).

**Saved data / settings:** owns no saved data. Settings: `gameMode`, `logsPath`,
`screenshotsPath`, `followPosition`, `autoCenter`, OpenAI key / model / effort.

**Files:**
- `rules.js`: the dialog's choices and the game data line.
- `panel.js`: the Settings and OpenAI dialogs and their handlers.
- `settings.css`: the label + field rows.

**Tests:** `rules.test.js` (time ago, the game data line). The browser suite saves Settings,
mirrors ◎ Follow, and adds a wrong then a right key. **Needs an in-game check:** nothing.
