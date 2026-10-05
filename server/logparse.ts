// Pure parsing of Escape from Tarkov log text (no file I/O).
// Format (as written by the game, and as TarkovMonitor reads it):
//   2026-10-01 11:25:03.123 -05:00|1.0.0.0|Info|application|…message…
//   optionally followed by a JSON block whose first line starts with "{" and last line starts with "}".

export type LogEntry = { date: string; message: string; json: any | null };

const HEAD = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3})(?: [+-]\d{2}:\d{2})?\|/;

/**
 * Split a text chunk into complete entries. Returns the entries plus any trailing text that may be
 * an incomplete entry (to be prepended to the next chunk).
 */
export function splitEntries(text: string): { entries: LogEntry[]; rest: string } {
  const lines = text.split(/\r?\n/);
  const endsWithNewline = /\n$/.test(text);
  if (endsWithNewline) lines.pop(); // trailing empty string
  const blocks: string[][] = [];
  let cur: string[] | null = null;
  let lead = "";
  for (const line of lines) {
    if (HEAD.test(line)) { if (cur) blocks.push(cur); cur = [line]; }
    else if (cur) cur.push(line);
    else lead += line + "\n"; // text before the first header (partial leftover) — ignored
  }
  if (cur) blocks.push(cur);
  // the last block is complete only if the chunk ended with a newline and any JSON block is closed
  let rest = "";
  if (blocks.length) {
    const last = blocks[blocks.length - 1];
    const openJson = last.length > 1 && last[1].startsWith("{") && !last.slice(1).some((l) => l.startsWith("}"));
    if (!endsWithNewline || openJson) { rest = last.join("\n") + (endsWithNewline ? "\n" : ""); blocks.pop(); }
  }
  const entries = blocks.map(parseBlock).filter(Boolean) as LogEntry[];
  return { entries, rest };
}

function parseBlock(block: string[]): LogEntry | null {
  const m = block[0].match(HEAD);
  if (!m) return null;
  const message = block[0].slice(m[0].length);
  let json: any = null;
  if (block.length > 1 && block[1].startsWith("{")) {
    const end = block.findIndex((l, i) => i > 0 && l.startsWith("}"));
    const body = block.slice(1, end > 0 ? end + 1 : block.length).join("\n");
    try { json = JSON.parse(body); } catch { json = null; }
  }
  return { date: `${m[1]}T${m[2]}`, message, json };
}

export type LogEvent =
  | { type: "task"; id: string; status: "started" | "failed" | "finished"; at: string }
  | { type: "mode"; mode: "regular" | "pve" | "pvp-season"; raw: string }
  | { type: "mapLoading"; scene: string }
  | { type: "mapLoaded"; nameId: string }
  | { type: "raidStart"; at: string }
  | { type: "raidLeft" }                      // UserMatchOver notification
  | { type: "profileSelected" }               // back in the menus (TarkovMonitor treats this as raid end)
  | { type: "matchingAborted" }
  | { type: "keybind"; ok: boolean; warning: string | null };

export function resolveMode(raw: string): "regular" | "pve" | "pvp-season" | null {
  const r = raw.toLowerCase();
  if (r === "pve") return "pve";
  if (r === "regular" || r === "pvp") return "regular";
  if (r === "pvpseason" || r === "seasonal" || r === "szn") return "pvp-season";
  return null;
}

const STATUS: Record<number, "started" | "failed" | "finished"> = { 10: "started", 11: "failed", 12: "finished" };

/** Turn one entry into zero or more app events. */
export function eventsFrom(e: LogEntry): LogEvent[] {
  const out: LogEvent[] = [];
  const msg = e.message;
  if (msg.includes("Got notification | ChatMessageReceived") && e.json) {
    const m = e.json.message || {};
    const st = STATUS[Number(m.type)];
    if (st && typeof m.templateId === "string") {
      const id = m.templateId.split(" ")[0];
      if (/^[0-9a-f]{24}$/i.test(id)) out.push({ type: "task", id, status: st, at: e.date });
    }
  }
  if (msg.includes("Got notification | UserMatchOver")) out.push({ type: "raidLeft" });
  const sm = msg.match(/Session mode: ([^\s|]+)/);
  if (sm) { const mode = resolveMode(sm[1]); if (mode) out.push({ type: "mode", mode, raw: sm[1] }); }
  const sp = msg.match(/scene preset path:(maps\/[A-Za-z0-9_]+\.bundle)/);
  if (sp) out.push({ type: "mapLoading", scene: sp[1] });
  if (msg.includes("TRACE-NetworkGameCreate profileStatus")) { const lm = msg.match(/Location: ([^,]+)/); if (lm) out.push({ type: "mapLoaded", nameId: lm[1].trim() }); }
  if (msg.includes("application|GameStarted")) out.push({ type: "raidStart", at: e.date });
  if (/(Select(ed)?Profile|PrepareSelectedProfileLocally) ProfileId:/.test(msg)) out.push({ type: "profileSelected" });
  if (msg.includes("Network game matching aborted") || msg.includes("Network game matching cancelled")) out.push({ type: "matchingAborted" });
  if (msg.includes("Control settings:") && e.json) out.push(keybind(e.json));
  return out;
}

export function keybind(cs: any): LogEvent {
  const binds: any[] = Array.isArray(cs?.keyBindings) ? cs.keyBindings : [];
  const b = binds.find((n) => n?.keyName === "MakeScreenshot" && (n.variants || []).some((v: any) => v?.isAxis === true || (v?.keyCode || []).length > 0));
  if (!b) return { type: "keybind", ok: false, warning: "No screenshot key is bound in Tarkov's control settings. Bind one so the map can show your position." };
  const v = (b.variants || []).find((x: any) => (x?.keyCode || []).length > 0);
  if (v && (v.keyCode || []).includes("SysReq")) return { type: "keybind", ok: false, warning: "Tarkov's screenshot key is bound in a way that doesn't work (SysReq). Rebind it in the game's control settings." };
  return { type: "keybind", ok: true, warning: null };
}
