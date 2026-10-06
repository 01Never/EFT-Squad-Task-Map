# Raid (and the game mode prompt)

**What it does (player's view):** the top bar shows "● In raid: Streets of Tarkov" while a raid
runs, and which game data is in use ("PvP data"). When the game says you're playing another mode
than Settings, it offers "Game says PvE · Switch data / Not now". When the raid ends, your bag
counts and extract marks reset, your position and trail clear, and a toast says how many of that
raid's GPS screenshots were deleted.

**Where the data comes from:** the game's logs, read by the server (`internal/features/gamelog`,
`internal/features/raid`): events `raidStart`, `raidMap`, `raidEnd` (queued until the page has it)
and `mode`. The server deletes the raid's GPS screenshots itself.

**The rules** (`rules.js`):
- After a raid: `have` and `used` empty, no extract marked on any map (`resetAfterRaid()`).
- The mode prompt (`modePromptAfterReport()`): the same mode as Settings clears it; another mode
  is offered unless you said Not now to that mode. The game logs a mode more than once at start-up
  ("Pve" then "PvpSeason"); the last one counts.

**Flow:**
- `log line → gamelog → raid → event "raidEnd" → app/live-events.js onRaidEnded() →
  resetAfterRaid() → save → rerenderPage() → toast raidOverMessage()`.
- `event "mode" → onGameModeReported() → modePromptAfterReport() → renderNav()`; Switch data →
  `PUT /api/settings {gameMode}` (the server then sends `data`, which reloads the game data).
- `event "raidStart"` → "● In raid", and with Follow my position the raid's map opens
  (`features/find-me switchToMapIfFollowing()`).

**Saved data / settings:** resets `have`, `used`, `prefs[map].extMarked`. Reads and changes
`gameMode`.

**Files:**
- `rules.js`: the raid-end reset, its message, the mode prompt.
- `nav.js`: the raid part of the top bar and the prompt's buttons.

**Tests:** `rules.test.js` (reset, message, prompt cases including "Pve then PvpSeason"). The
browser suite (`game-log.e2e.mjs`) covers the prompt, Switch data and raid end. **Needs an
in-game check:** raid end in a real raid (HANDOFF §10).
