// Watches Tarkov's screenshots folder using the OS's file notifications (no polling).
// - In-raid screenshots carry your position in the file name → GPS.
// - During a task scan ("capture mode"), other new screenshots are collected for the AI to read.
import { watch, existsSync, statSync, unlinkSync, readFileSync, type FSWatcher } from "node:fs";
import { join, basename } from "node:path";
import { parseGpsName, IMAGE_EXT, type GpsFix } from "./gpsname.ts";
import { isDir } from "./paths.ts";

export type CaptureFile = { name: string; t: number; size: number };

export class Screens {
  dir: string | null = null;
  watcher: FSWatcher | null = null;
  retry: any = null;
  pending = new Map<string, any>();
  gpsShots: { name: string; t: number }[] = [];
  capture: { active: boolean; startedAt: number; files: Map<string, CaptureFile> } = { active: false, startedAt: 0, files: new Map() };
  status = { ok: false, message: "Not started", dir: null as string | null };

  constructor(private on: { gps: (fix: GpsFix & { file: string; t: number }) => void; capture: (files: CaptureFile[]) => void }) {}

  start(dir: string | null) {
    this.stop();
    this.dir = dir;
    this.status.dir = dir;
    if (!dir || !isDir(dir)) {
      this.status = { ok: false, message: dir ? "Screenshots folder not found yet (it appears after your first screenshot)" : "Screenshots folder unknown — set it in Settings", dir };
      if (dir) this.retry = setInterval(() => { if (isDir(dir)) this.start(dir); }, 60_000);
      return;
    }
    try {
      this.watcher = watch(dir, { persistent: true }, (_ev, name) => { if (name) this.onFile(basename(String(name))); });
      this.status = { ok: true, message: "Watching", dir };
    } catch (e: any) {
      this.status = { ok: false, message: "Couldn't watch the screenshots folder: " + (e?.message || e), dir };
    }
  }

  stop() {
    try { this.watcher?.close(); } catch {}
    this.watcher = null;
    if (this.retry) clearInterval(this.retry);
    this.retry = null;
  }

  // The game writes a file in pieces; wait until it's quiet before reading it.
  private onFile(name: string) {
    if (!IMAGE_EXT.test(name)) return;
    clearTimeout(this.pending.get(name));
    this.pending.set(name, setTimeout(() => { this.pending.delete(name); this.handle(name); }, 400));
  }

  handle(name: string) {
    const full = join(this.dir!, name);
    if (!existsSync(full)) { // deleted
      if (this.capture.files.delete(name)) this.on.capture(this.captureList());
      return;
    }
    const fix = parseGpsName(name);
    const now = Date.now();
    if (fix) {
      if (!this.gpsShots.some((s) => s.name === name)) this.gpsShots.push({ name, t: now });
      this.on.gps({ ...fix, file: name, t: now });
      return;
    }
    if (!this.capture.active) return;
    let st;
    try { st = statSync(full); } catch { return; }
    if (st.mtimeMs < this.capture.startedAt - 2000) return; // only shots taken after "Scan tasks"
    this.capture.files.set(name, { name, t: st.mtimeMs, size: st.size });
    this.on.capture(this.captureList());
  }

  /** True when GPS screenshots were taken since the last raid ended (i.e. we're probably in a raid). */
  hasRaidShots() { return this.gpsShots.length > 0; }

  /** Delete this raid's GPS screenshots. Only files we saw being created, and only GPS-named ones. */
  deleteRaidShots(): number {
    let n = 0;
    for (const s of this.gpsShots) {
      if (!parseGpsName(s.name)) continue;
      try { unlinkSync(join(this.dir!, s.name)); n++; } catch {}
    }
    this.gpsShots = [];
    return n;
  }

  // ---------- capture mode (task-list scan)
  startCapture() { this.capture = { active: true, startedAt: Date.now(), files: new Map() }; this.on.capture([]); }
  captureList(): CaptureFile[] { return [...this.capture.files.values()].sort((a, b) => a.t - b.t); }
  removeFromCapture(name: string) { this.capture.files.delete(name); this.on.capture(this.captureList()); }
  stopCapture() { this.capture.active = false; }
  cancelCapture() { this.capture = { active: false, startedAt: 0, files: new Map() }; }
  readCaptured(name: string): Buffer | null {
    if (!this.capture.files.has(name)) return null; // never serve anything else from disk
    try { return readFileSync(join(this.dir!, name)); } catch { return null; }
  }
  /** After a confirmed scan: delete exactly the files that were scanned. */
  deleteCaptured(names: string[]): number {
    let n = 0;
    for (const name of names) {
      if (!this.capture.files.has(name)) continue;
      try { unlinkSync(join(this.dir!, name)); n++; } catch {}
      this.capture.files.delete(name);
    }
    this.cancelCapture();
    return n;
  }
}
