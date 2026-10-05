// Where things live: our data files (next to the exe), the game's screenshots folder, and its logs folder.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

export const isCompiled = !/[\\/]bun(\.exe)?$/i.test(process.execPath);
export const HOME = process.env.STM_DATA_DIR || (isCompiled ? dirname(process.execPath) : process.cwd());
export const FILES = {
  state: join(HOME, "squad-task-map-data.json"),
  v1backup: join(HOME, "squad-task-map-data.v1-backup.json"),
  settings: join(HOME, "squad-task-map-settings.json"),
  pending: join(HOME, "squad-task-map-pending.json"),
  wiki: join(HOME, "squad-task-map-wikicache.json"),
  gamedata: (mode: string) => join(HOME, `squad-task-map-gamedata-${mode}.json`),
  oldGamedata: join(HOME, "squad-task-map-gamedata.json"),
};

const isWin = process.platform === "win32";

function run(cmd: string, args: string[]): string {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 8000 });
    return r.status === 0 ? String(r.stdout || "") : "";
  } catch { return ""; }
}

let docsCache: string | null | undefined;
/** The real Documents folder (OneDrive often redirects it, so ask Windows). */
export function documentsDir(): string | null {
  if (docsCache !== undefined) return docsCache;
  if (isWin) {
    const out = run("powershell", ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetFolderPath('MyDocuments')"]).trim();
    docsCache = out && existsSync(out) ? out : join(homedir(), "Documents");
  } else docsCache = join(homedir(), "Documents");
  return docsCache;
}

export function defaultScreenshotsDir(): string | null {
  if (process.env.STM_SCREENSHOTS_DIR) return process.env.STM_SCREENSHOTS_DIR;
  const d = documentsDir();
  return d ? join(d, "Escape From Tarkov", "Screenshots") : null;
}

function regValues(key: string, value: string): string[] {
  const out = run("reg", ["query", key, "/v", value]);
  const vals: string[] = [];
  for (const line of out.split(/\r?\n/)) { const m = line.match(/REG_\w+\s+(.+)$/); if (m) vals.push(m[1].trim()); }
  return vals;
}

const STEAM_EFT_APP_ID = "3932890";
function logsIn(install: string): string | null {
  for (const p of [join(install, "Logs"), join(install, "build", "Logs")]) if (existsSync(p)) return p;
  return null;
}

/** Find EFT's Logs folder: registry uninstall entry, then Steam libraries. */
export function detectLogsDir(): string | null {
  if (process.env.STM_LOGS_DIR) return process.env.STM_LOGS_DIR;
  if (!isWin) return null;
  const installs: string[] = [];
  for (const hive of ["HKCU", "HKLM"]) for (const path of ["SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov", "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov"])
    installs.push(...regValues(`${hive}\\${path}`, "InstallLocation"));
  for (const i of installs) { const l = logsIn(i); if (l) return l; }
  const steamRoots = [...regValues("HKCU\\Software\\Valve\\Steam", "SteamPath"), ...regValues("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"), ...regValues("HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath")];
  for (const root of steamRoots) {
    const libs = [root];
    try {
      const vdf = readFileSync(join(root, "steamapps", "libraryfolders.vdf"), "utf8");
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(m[1].replace(/\\\\/g, "\\"));
    } catch {}
    for (const lib of libs) {
      let dirs = ["Escape from Tarkov"];
      try { const acf = readFileSync(join(lib, "steamapps", `appmanifest_${STEAM_EFT_APP_ID}.acf`), "utf8"); const m = acf.match(/"installdir"\s+"([^"]+)"/); if (m) dirs = [m[1], ...dirs]; } catch {}
      for (const d of dirs) { const l = logsIn(join(lib, "steamapps", "common", d)); if (l) return l; }
    }
  }
  return null;
}

export function isDir(p: string | null | undefined) { try { return !!p && statSync(p).isDirectory(); } catch { return false; } }
export function listDir(p: string): string[] { try { return readdirSync(p); } catch { return []; } }
