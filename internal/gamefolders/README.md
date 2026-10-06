# Game folders (`internal/gamefolders`)

**What it's for:** finding Tarkov's Logs folder and the screenshots folder on this PC, so the app
works without setup. Settings can override both (`logsPath`, `screenshotsPath`) and shows ✓ or ✗
for each.

**What it deliberately doesn't do:** watch anything, create folders, or search whole drives. It
only checks the places below; when nothing is found the page asks you to paste the folder.

**The rules:**
- **Screenshots:** `<Documents>\Escape From Tarkov\Screenshots`. Documents is asked from Windows
  (`FOLDERID_Documents`), because OneDrive often moves it; `%USERPROFILE%\Documents` is the
  fallback. Looked up once. (v2 started PowerShell for this; this asks Windows directly.)
- **Logs**, first existing one wins:
  1. The launcher's uninstall entry, `…\Uninstall\EscapeFromTarkov` → `InstallLocation` (current
     user, then machine; normal and `WOW6432Node` views).
  2. Steam: Steam's folder from the registry (`HKCU\Software\Valve\Steam` `SteamPath`, then
     `HKLM\SOFTWARE\WOW6432Node\Valve\Steam` and `HKLM\SOFTWARE\Valve\Steam` `InstallPath`); each
     library listed in `steamapps\libraryfolders.vdf`; in each library, the folder named in
     `appmanifest_3932890.acf` (`installdir`; 3932890 is EFT's Steam app id), else
     `steamapps\common\Escape from Tarkov`.
  3. Inside an install folder: `Logs`, else `build\Logs`.
  Nothing found → "" (Settings: "Couldn't find Tarkov's Logs folder — set it in Settings").
- `STM_LOGS_DIR` and `STM_SCREENSHOTS_DIR` override both (tests, offline mock setup).
- On other systems (development only): Documents is `~/Documents` and there's no registry, so no
  Logs folder is found.

**Files:** `gamefolders.go` (the order of lookups, Steam's files), `gamefolders_windows.go`
(registry, Documents), `gamefolders_other.go` (stand-ins for other systems).

**Tests:** `gamefolders_test.go`: `Logs` or `buildogs` under an install; steam libraries from `libraryfolders.vdf` and the install folder from `appmanifest_3932890.acf`; the `stm_logs_dir`/`stm_screenshots_dir` overrides. the registry lookups themselves were checked on the owner's pc (ticket 04: `e:games	arkovogs` and the real documents folder). **Needs the owner's PC** (HANDOFF §10.1):
both folders found automatically.
