// Settings file, saved-state file (with .bak and a one-time v1 backup), and the queue of game events
// waiting for the page (so log events aren't lost while the browser is closed).
import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync } from "node:fs";
import { FILES } from "./paths.ts";

export type Settings = {
  openaiKey?: string; openaiModel?: string; openaiEffort?: string;
  gameMode?: "regular" | "pve" | "pvp-season";
  logsPath?: string; screenshotsPath?: string;
  followPosition?: boolean;
  [k: string]: any;
};

function readJson(file: string, fallback: any) { try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback; } catch { return fallback; } }
function writeAtomic(file: string, text: string) { writeFileSync(file + ".tmp", text); renameSync(file + ".tmp", file); }

export function readSettings(): Settings {
  const s = readJson(FILES.settings, {});
  // v2 no longer uses TarkovTracker; drop its token on first start
  let dirty = false;
  for (const k of Object.keys(s)) if (k.startsWith("tt")) { delete s[k]; dirty = true; }
  if (dirty) writeSettings(s);
  return s;
}
export function writeSettings(s: Settings) { writeAtomic(FILES.settings, JSON.stringify(s, null, 1)); }
export const mask = (t?: string) => (t ? t.slice(0, 4) + "…" + t.slice(-4) : null);

export function readStateText(): string {
  try { return existsSync(FILES.state) ? readFileSync(FILES.state, "utf8") : "null"; } catch { return "null"; }
}
/** Before the page migrates v1 data, keep an untouched copy once. */
export function backupV1IfNeeded() {
  try {
    if (!existsSync(FILES.state) || existsSync(FILES.v1backup)) return;
    const s = JSON.parse(readFileSync(FILES.state, "utf8"));
    if (s && s.version !== 2) copyFileSync(FILES.state, FILES.v1backup);
  } catch {}
}
export function writeStateText(body: string) {
  JSON.parse(body); // reject anything that isn't JSON
  if (existsSync(FILES.state)) copyFileSync(FILES.state, FILES.state + ".bak");
  writeAtomic(FILES.state, body);
}

// ---------- pending events
export type QueuedEvent = { id: number; type: string; [k: string]: any };
let pending: QueuedEvent[] = readJson(FILES.pending, []);
let seq = pending.reduce((m, e) => Math.max(m, e.id), 0);
export function enqueue(ev: Omit<QueuedEvent, "id">): QueuedEvent {
  const e = { ...ev, id: ++seq } as QueuedEvent;
  pending.push(e);
  if (pending.length > 500) pending = pending.slice(-500);
  writeAtomic(FILES.pending, JSON.stringify(pending));
  return e;
}
export function pendingEvents() { return pending.slice(); }
export function ack(upTo: number) {
  const before = pending.length;
  pending = pending.filter((e) => e.id > upTo);
  if (pending.length !== before) writeAtomic(FILES.pending, JSON.stringify(pending));
}
