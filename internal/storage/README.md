# Storage (`internal/storage`)

**What it's for:** the app's own files in its data folder: settings, the page's saved data and its
backups, the names of every other data file, and writing a file safely.

**What it deliberately doesn't do:**
- Look inside the page's saved data. The page owns its format and migrates it (SPEC §5.3, §12);
  the server only checks it's JSON, and whether it's still v1.
- Touch the game's files.

**Data folder** (`DataDir`): `STM_DATA_DIR` when set (development and tests use a scratch folder);
otherwise the exe's folder; under `go run` (the exe is a temporary build) the current folder. A
temporary build is recognised by `go-build` or `\temp\` in the exe's path.

**Files** (`FilesIn`):

| File | What | Written by |
|---|---|---|
| `squad-task-map-data.json` (+ `.bak`) | the page's saved data | the page, through `WriteStateText` |
| `squad-task-map-data.v1-backup.json` | an untouched copy of v1 data, made once | `BackupV1IfNeeded` |
| `squad-task-map-settings.json` | settings | the app, through `WriteSettings` |
| `squad-task-map-pending.json` | events waiting for the page | `events` |
| `squad-task-map-wikicache.json` | wiki pages for AI Categorize | `aicategorize` |
| `squad-task-map-gamedata-<mode>.json` | the game data cache | `gamedata` |
| `squad-task-map-instance.json` | the port of the running copy (one copy at a time) | `internal/app/run.go` |
| `squad-task-map-data.before-<version>.json` | copy of the saved data made before a new version's first start; the newest 3 are kept | `BackupStateBeforeUpdate` (called by `updates`) |
| `squad-task-map-update-notice.json` | release notes handed to the copy an update starts | `updates` |
| `squad-task-map-squad.json` | my last squad share and friends' last shares with `lastSeen` (ticket 05) | `squad` |
| `squad-task-map-tailscale/` (folder) | tsnet's state: the squad node key (secret) and its logs; deleted by Leave squad | tsnet, inside `squad` |

**The rules:**
- **Atomic writes** (`WriteFileAtomic`): write `<file>.tmp`, then rename it over the file, so a
  crash mid-write never leaves half a file.
- **Saved data** (`WriteStateText`): refused unless it's valid JSON ("the saved data isn't valid
  JSON"), so a broken request can't wipe your data. The previous file is copied to `.bak` first.
  `ReadStateText` returns `null` when there's no file yet; the page then starts fresh.
- **v1 backup** (`BackupV1IfNeeded`, at start-up): when the saved data exists, there's no backup
  yet, and it isn't `{"version": 2, …}`, copy it once before the page migrates it.
- **Settings** (`ReadSettings`, `WriteSettings`): the known fields are `openaiKey`, `openaiModel`,
  `openaiEffort`, `gameMode`, `logsPath`, `screenshotsPath`, `followPosition`, `autoCenter`, and
  the `squad` block (ticket 05: `playerId`, `name`, `color`, `shareTasks`, `joined`; never the
  invite code; `SquadOrEmpty` gives an empty block when there's none).
  - Defaults: game mode `regular`; Follow my position on; auto-center off; empty folders mean
    "found automatically"; not in a squad, tasks not shared (the squad feature fills in the
    player id, name and colour the first time).
  - Fields this version doesn't know are kept untouched (also inside `squad`), so an older or
    newer version's settings survive a save. The exception is v1's TarkovTracker fields (names starting with `tt`), dropped
    on first start because v2 doesn't use TarkovTracker.
  - A missing or broken file gives the defaults.
  - Written indented with one space, as v2 did (keys now in alphabetical order).
- **API key:** stored in plain text in the settings file (SPEC, CLAUDE.md). The page only ever sees
  `MaskKey`: the first 4 and last 4 characters around "…" (null when there's no key).

**Files:** `files.go` (data folder, file names, atomic write), `settings.go` (settings, masking the
key), `state.go` (saved data, `.bak`, v1 backup).

- **Pre-update backup** (`BackupStateBeforeUpdate(files, version)`): copies the saved data to
  `squad-task-map-data.before-<version>.json`, then deletes all but the newest 3 such files (by
  modification time). Nothing to do when there's no saved data; a version containing `/` or `\`
  is refused. The saved data itself is never touched.

**Tests:** `update_backup_test.go` (the copy, no data, only the newest 3 kept while other backups are
left alone, unsafe versions refused); `storage_test.go`: atomic writes leave no `.tmp`; non-JSON state is refused and the previous file kept as `.bak`; "null" when there's no data; the v1 backup is made once and never for version 2; unknown settings survive a save while `tt…` fields are dropped; unknown fields inside `squad` survive too, and no block reads as not in a squad; defaults for Follow and auto-center; key masking; only a go-build path counts as `go run`. **Needs a Windows check:** the data files land next to the exe; the
owner's real v1 file gets its backup once.
