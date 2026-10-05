// Watches the game's log files. Every 5 s it compares file sizes and reads only the new bytes
// (the same approach as TarkovMonitor). Starts at the end of existing files: no catch-up.
import { openSync, readSync, closeSync, statSync } from "node:fs";
import { join } from "node:path";
import { splitEntries, eventsFrom, type LogEvent } from "./logparse.ts";
import { isDir, listDir } from "./paths.ts";

type FileState = { offset: number; rest: string; dec: TextDecoder };
const LOG_FILE = /(notifications|application)[^\\/]*\.log$/i;
const MAX_READ = 4 * 1024 * 1024;

export class LogWatcher {
  dir: string | null = null;
  folder: string | null = null;
  files = new Map<string, FileState>();
  timer: any = null;
  ticks = 0;
  status = { ok: false, message: "Not started", dir: null as string | null, folder: null as string | null };

  constructor(private onEvent: (ev: LogEvent) => void) {}

  start(dir: string | null) {
    this.stop();
    this.dir = dir;
    this.status.dir = dir;
    if (!dir || !isDir(dir)) {
      this.status = { ok: false, message: dir ? "Logs folder not found" : "Couldn't find Tarkov's Logs folder — set it in Settings", dir, folder: null };
      // check again occasionally in case the game gets installed / the drive appears
      if (dir) this.timer = setInterval(() => { if (isDir(dir)) this.start(dir); }, 60_000);
      return;
    }
    this.scanFolder(true);
    this.timer = setInterval(() => this.poll(), 5000);
    this.status.ok = true;
    this.status.message = "Watching";
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.files.clear(); this.folder = null; }

  private scanFolder(atStart: boolean) {
    const subs = listDir(this.dir!).filter((n) => isDir(join(this.dir!, n))).sort();
    const newest = subs[subs.length - 1] || null;
    if (newest !== this.folder) {
      this.folder = newest;
      this.files.clear();
      this.status.folder = newest;
      // a session folder that appears while we run is read from the start; at startup, from the end
      this.addFiles(atStart);
    } else this.addFiles(false); // rotated files (…_001.log) appearing in the same session
  }

  private addFiles(atEnd: boolean) {
    if (!this.folder) return;
    const base = join(this.dir!, this.folder);
    for (const f of listDir(base)) {
      if (!LOG_FILE.test(f) || this.files.has(f)) continue;
      let size = 0;
      try { size = statSync(join(base, f)).size; } catch {}
      this.files.set(f, { offset: atEnd ? size : 0, rest: "", dec: new TextDecoder("utf-8") });
    }
  }

  poll() {
    this.ticks++;
    if (this.ticks % 6 === 0) this.scanFolder(false); // new session folder / new files: every 30 s
    if (!this.folder) return;
    const base = join(this.dir!, this.folder);
    for (const [name, st] of this.files) {
      const path = join(base, name);
      let size: number;
      try { size = statSync(path).size; } catch { continue; }
      if (size < st.offset) { st.offset = 0; st.rest = ""; st.dec = new TextDecoder("utf-8"); }
      if (size === st.offset) continue;
      const len = Math.min(size - st.offset, MAX_READ);
      const buf = Buffer.alloc(len);
      let fd: number | null = null;
      try { fd = openSync(path, "r"); readSync(fd, buf, 0, len, st.offset); } catch { continue; } finally { if (fd !== null) closeSync(fd); }
      st.offset += len;
      this.feed(st, st.dec.decode(buf, { stream: true }));
    }
  }

  /** Exposed for tests. */
  feed(st: { rest: string }, text: string) {
    const { entries, rest } = splitEntries(st.rest + text);
    st.rest = rest.length > 1_000_000 ? "" : rest;
    for (const e of entries) for (const ev of eventsFrom(e)) this.onEvent(ev);
  }
}
