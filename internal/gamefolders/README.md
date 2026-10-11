# Game folders (`internal/gamefolders`)

**What it's for:** finding Tarkov's Logs folder and the screenshots folder on this PC, so the app
works without setup. Settings can override both (`logsPath`, `screenshotsPath`) and shows ✓ or ✗
for each.

**What it deliberately doesn't do:** watch anything, create folders, or search whole drives. It
only checks the places below; when nothing is found the page asks you to paste the folder.

**The rules** (choices between folders are in `rules.go`):
- **Screenshots:** `<Documents>\Escape From Tarkov\Screenshots`. Documents is asked from Windows
  (`FOLDERID_Documents`), because OneDrive often moves it; `%USERPROFILE%\Documents` is the
  fallback. Looked up once. (v2 started PowerShell for this; this asks Windows directly.)
  - With OneDrive's folder backup a PC can have two Documents folders, and the game may save in
    either. So the candidates are: the folder Windows reports, `%USERPROFILE%\Documents`, and
    `Documents` under `%OneDrive%`, `%OneDriveConsumer%` and `%OneDriveCommercial%`.
    `ChooseScreenshotsFolder`: of the screenshots folders that exist, the one changed most recently
    (a new screenshot changes it); when none exists yet, the one under the folder Windows reports.
- **Logs**, every one of these is a candidate:
  1. The launcher's uninstall entry, `…\Uninstall\EscapeFromTarkov` → `InstallLocation` (current
     user, then machine; normal and `WOW6432Node` views).
  2. Steam: Steam's folder from the registry (`HKCU\Software\Valve\Steam` `SteamPath`, then
     `HKLM\SOFTWARE\WOW6432Node\Valve\Steam` and `HKLM\SOFTWARE\Valve\Steam` `InstallPath`); each
     library listed in `steamapps\libraryfolders.vdf`; in each library, the folder named in
     `appmanifest_3932890.acf` (`installdir`; 3932890 is EFT's Steam app id), else
     `steamapps\common\Escape from Tarkov`.
  3. Inside an install folder: `Logs`, else `build\Logs`.

  `MostRecentlyUsedLogs`: the candidate whose newest `log_…` session folder is newest wins (an old
  launcher install next to the Steam one, or an uninstall entry pointing at an old copy, must not
  win); ties and candidates without sessions keep the order above.
  Nothing found → "" (Settings: "Couldn't find Tarkov's Logs folder — set it in Settings").
- **Session folders:** `NewestSessionFolderName`: the last `log_…` folder in name order (any
  case); other folders are ignored. Used by `gamelog` to pick the folder it follows.
- **A Logs folder set in Settings** (`LogsRoot`): a session folder becomes its parent Logs folder,
  an install folder becomes the Logs folder inside it; anything else is used as it is.
- `STM_LOGS_DIR` and `STM_SCREENSHOTS_DIR` override both (tests, offline mock setup).
- On other systems (development only): Documents is `~/Documents` and there's no registry, so no
  Logs folder is found.

**Files:** `rules.go` (the choices between folders: plain functions), `gamefolders.go` (the order
of lookups, Steam's files, reading folders), `gamefolders_windows.go` (registry, Documents),
`gamefolders_other.go` (stand-ins for other systems).

**Tests:** `gamefolders_test.go`: `Logs` or `build\Logs` under an install; Steam libraries from
`libraryfolders.vdf` and the install folder from `appmanifest_3932890.acf`; the
`STM_LOGS_DIR`/`STM_SCREENSHOTS_DIR` overrides. `rules_test.go`: the newest session folder (stray
folders ignored); the Logs folder played last wins; the screenshots folder with the latest
screenshot wins (OneDrive vs local Documents); a session or install folder pasted in Settings
becomes the Logs folder; every Steam library is a candidate. The registry lookups themselves were
checked on the owner's PC (ticket 04: `E:\Games\tarkov\Logs` and the real Documents folder).
**Needs the owner's PC** (HANDOFF §10.1): both folders found automatically.
