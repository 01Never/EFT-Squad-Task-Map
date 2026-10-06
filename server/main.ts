// Squad Task Map v2 — local edition.
// Serves the page on http://127.0.0.1:<port>, saves data next to the exe, and watches the game's
// logs and screenshots folder. Built to stay out of the way while Tarkov runs: a 5-second log size
// check, OS file notifications for screenshots, and push events to the page (no polling).
import { spawn } from "node:child_process";

import indexHtml from "../web/index.html" with { type: "text" };
import appJs from "../web/dist/app.js" with { type: "text" };
import mapsConfig from "../assets/maps-config.json" with { type: "text" };
import fontsJson from "../assets/fonts.json" with { type: "text" };
import svgStreets from "../assets/StreetsOfTarkov.svg" with { type: "text" };
import svgGZ from "../assets/GroundZero.svg" with { type: "text" };
import svgCustoms from "../assets/Customs.svg" with { type: "text" };
import svgFactory from "../assets/Factory.svg" with { type: "text" };
import svgInterchange from "../assets/Interchange.svg" with { type: "text" };
import svgLighthouse from "../assets/Lighthouse.svg" with { type: "text" };
import svgReserve from "../assets/Reserve.svg" with { type: "text" };
import svgShoreline from "../assets/Shoreline.svg" with { type: "text" };
import svgWoods from "../assets/Woods.svg" with { type: "text" };

import { FILES, HOME, detectLogsDir, defaultScreenshotsDir } from "./paths.ts";
import { readSettings, writeSettings, readStateText, writeStateText, backupV1IfNeeded, ack, mask, type Settings } from "./store.ts";
import { initGameData, setMode, refresh, dataJson, dataStatus, gameData, gameMode, mapFromScene, mapFromNameId, taskExists } from "./gamedata.ts";
import { broadcast, deliver, sseResponse, clientCount } from "./events.ts";
import { LogWatcher } from "./logs.ts";
import { Screens } from "./screens.ts";
import { initWikiCache, categorize, testKey, readTaskList, DEFAULT_MODEL } from "./ai.ts";

const VERSION = "2.1.0";
const SVGS: Record<string, string> = {
  "StreetsOfTarkov.svg": svgStreets, "GroundZero.svg": svgGZ, "Customs.svg": svgCustoms, "Factory.svg": svgFactory,
  "Interchange.svg": svgInterchange, "Lighthouse.svg": svgLighthouse, "Reserve.svg": svgReserve, "Shoreline.svg": svgShoreline, "Woods.svg": svgWoods,
};
const FONTS: Record<string, string> = JSON.parse(fontsJson);
const MAP_NAMES: Record<string, string> = Object.fromEntries(JSON.parse(mapsConfig).map((m: any) => [m.key, m.name]));
Object.assign(MAP_NAMES, { "the-lab": "The Lab", labyrinth: "The Labyrinth", terminal: "Terminal" });

// ---------------------------------------------------------------- startup
backupV1IfNeeded();
initWikiCache(FILES.wiki);
let settings: Settings = readSettings();
initGameData(settings.gameMode || "regular", () => broadcast({ type: "data", status: dataStatus() }));

// ---------------------------------------------------------------- raid / GPS state
const raid = { active: false, map: null as string | null, pendingMap: null as string | null, start: 0, sessionMode: null as string | null };
let keybind: { ok: boolean; warning: string | null } | null = null;
let gps: { map: string | null; x: number; y: number; z: number; yaw: number; t: number } | null = null;
let trail: { x: number; z: number; t: number }[] = [];

const screens = new Screens({
  gps(fix) {
    const map = raid.map || raid.pendingMap || null;
    if (gps && gps.map === map) trail = [...trail, { x: gps.x, z: gps.z, t: gps.t }].slice(-5);
    else trail = [];
    gps = { map, x: fix.x, y: fix.y, z: fix.z, yaw: fix.yaw, t: fix.t };
    broadcast({ type: "gps", gps, trail });
  },
  capture(files) { broadcast({ type: "capture", files: files.map((f) => ({ name: f.name, t: f.t, size: f.size })) }); },
});

function endRaid() {
  const deleted = screens.deleteRaidShots();
  deliver({ type: "raidEnd", map: raid.map, deleted });
  raid.active = false; raid.map = null; raid.pendingMap = null; trail = []; gps = null;
}
const modeMatches = () => !raid.sessionMode || raid.sessionMode === (settings.gameMode || "regular");

const logs = new LogWatcher((ev) => {
  switch (ev.type) {
    case "task":
      if (modeMatches() && taskExists(ev.id)) deliver({ type: "task", taskId: ev.id, status: ev.status });
      break;
    case "mode":
      raid.sessionMode = ev.mode;
      broadcast({ type: "mode", mode: ev.mode, dataMode: settings.gameMode || "regular" });
      break;
    case "mapLoading": raid.pendingMap = mapFromScene(ev.scene); broadcast({ type: "raidMap", map: raid.pendingMap }); break;
    case "mapLoaded": if (!raid.pendingMap) raid.pendingMap = mapFromNameId(ev.nameId); break;
    case "raidStart":
      raid.active = true; raid.map = raid.pendingMap; raid.start = Date.now(); trail = [];
      broadcast({ type: "raidStart", map: raid.map });
      break;
    case "raidLeft": case "profileSelected":
      if (raid.active || screens.hasRaidShots()) endRaid();
      break;
    case "matchingAborted": raid.pendingMap = null; break;
    case "keybind": keybind = { ok: ev.ok, warning: ev.warning }; broadcast({ type: "keybind", ...keybind }); break;
  }
});

function startWatchers() {
  logs.start(settings.logsPath || detectLogsDir());
  screens.start(settings.screenshotsPath || defaultScreenshotsDir());
}

// ---------------------------------------------------------------- HTTP
const JOBS = new Map<string, any>();
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const body = async (req: Request) => { try { return await req.json(); } catch { return {}; } };

function status() {
  return {
    version: VERSION, statePath: FILES.state, home: HOME,
    data: dataStatus(),
    settings: { gameMode: settings.gameMode || "regular", logsPath: settings.logsPath || "", screenshotsPath: settings.screenshotsPath || "", followPosition: settings.followPosition !== false },
    logs: logs.status, screenshots: screens.status, keybind,
    raid: { active: raid.active, map: raid.map || raid.pendingMap, sessionMode: raid.sessionMode },
    gps, trail,
    capture: { active: screens.capture.active, files: screens.captureList() },
    ai: { hasKey: !!settings.openaiKey, key: mask(settings.openaiKey), model: settings.openaiModel || DEFAULT_MODEL, effort: settings.openaiEffort || "" },
  };
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname, M = req.method;

  if (p === "/" || p === "/index.html") return new Response(indexHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
  if (p === "/app.js") return new Response(appJs, { headers: { "content-type": "text/javascript; charset=utf-8" } });
  if (p.startsWith("/fonts/")) {
    const b64 = FONTS[p.slice(7)];
    return b64 ? new Response(Buffer.from(b64, "base64"), { headers: { "content-type": "font/woff2", "cache-control": "max-age=86400" } }) : new Response("Not found", { status: 404 });
  }
  if (p.startsWith("/maps/")) {
    const svg = SVGS[decodeURIComponent(p.slice(6))];
    return svg ? new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "max-age=3600" } }) : new Response("Not found", { status: 404 });
  }

  if (p === "/api/config") return new Response(mapsConfig, { headers: { "content-type": "application/json" } });
  if (p === "/api/data") return new Response(dataJson(), { headers: { "content-type": "application/json" } });
  if (p === "/api/status") return json(status());
  if (p === "/api/events") return sseResponse();
  if (p === "/api/events/ack" && M === "POST") { const b = await body(req); if (Number.isFinite(b.upTo)) ack(b.upTo); return json({ ok: true }); }

  if (p === "/api/state" && M === "GET") return new Response(readStateText(), { headers: { "content-type": "application/json" } });
  if (p === "/api/state" && M === "PUT") {
    try { writeStateText(await req.text()); return json({ ok: true }); } catch (e) { return json({ ok: false, error: String(e) }, 400); }
  }

  if (p === "/api/settings" && M === "PUT") {
    const b = await body(req);
    const next: Settings = { ...settings };
    if (["regular", "pve", "pvp-season"].includes(b.gameMode)) next.gameMode = b.gameMode;
    if (typeof b.logsPath === "string") next.logsPath = b.logsPath.trim();
    if (typeof b.screenshotsPath === "string") next.screenshotsPath = b.screenshotsPath.trim();
    if (typeof b.followPosition === "boolean") next.followPosition = b.followPosition;
    const modeChanged = (next.gameMode || "regular") !== (settings.gameMode || "regular");
    const pathsChanged = next.logsPath !== settings.logsPath || next.screenshotsPath !== settings.screenshotsPath;
    settings = next; writeSettings(settings);
    if (modeChanged) setMode(settings.gameMode!);
    if (pathsChanged) startWatchers();
    return json({ ok: true, status: status() });
  }
  if (p === "/api/data/refresh" && M === "POST") return json(await refresh());

  // ---------- AI key + categorize
  if (p === "/api/ai/key" && M === "PUT") {
    try {
      const b = await body(req);
      const key = String(b.key || "").trim() || settings.openaiKey || "";
      const model = String(b.model || "").trim() || DEFAULT_MODEL;
      const effort = ["", "low", "medium", "high"].includes(b.effort) ? b.effort : "";
      if (!/^sk-[A-Za-z0-9_\-]{20,}$/.test(key)) throw new Error("That doesn't look like an OpenAI API key (they start with sk-)");
      if (!/^[A-Za-z0-9._:-]{2,80}$/.test(model)) throw new Error("Model name looks wrong");
      await testKey(key, model);
      settings = { ...settings, openaiKey: key, openaiModel: model, openaiEffort: effort }; writeSettings(settings);
      return json({ ok: true, ...status().ai });
    } catch (e: any) { return json({ ok: false, error: String(e?.message || e) }, 400); }
  }
  if (p === "/api/ai/key" && M === "DELETE") { delete settings.openaiKey; writeSettings(settings); return json({ ok: true }); }
  if (p === "/api/ai/categorize" && M === "POST") {
    if (!settings.openaiKey) return json({ ok: false, error: "Add your OpenAI API key first" }, 400);
    const b = await body(req);
    const instruction = String(b.instruction || "").trim().slice(0, 2000);
    if (!instruction) return json({ ok: false, error: "Type an instruction" }, 400);
    const id = Math.random().toString(36).slice(2, 10);
    const job: any = { status: "running", log: "Starting…", result: null, error: null, t: Date.now() };
    JOBS.set(id, job);
    const byId = Object.fromEntries(gameData().tasks.map((t) => [t.id, t]));
    categorize({
      instruction,
      history: Array.isArray(b.history) ? b.history.slice(-8).map((h: any) => ({ role: h.role === "assistant" ? "assistant" : "user", content: String(h.content || "").slice(0, 4000) })) : [],
      mapName: String(b.mapName || ""), categories: Array.isArray(b.categories) ? b.categories.slice(0, 50) : [], parts: Array.isArray(b.parts) ? b.parts.slice(0, 500) : [],
    }, byId, (k) => MAP_NAMES[k] || k, settings.openaiKey, settings.openaiModel || DEFAULT_MODEL, (m) => { job.log = m; }, settings.openaiEffort || "")
      .then((r) => { job.status = "done"; job.result = r; })
      .catch((e) => { job.status = "error"; job.error = String(e?.message || e); });
    for (const [k, j] of JOBS) if (Date.now() - j.t > 3600_000) JOBS.delete(k);
    return json({ ok: true, job: id });
  }
  if (p.startsWith("/api/ai/job/")) { const j = JOBS.get(p.slice(12)); return j ? json(j) : json({ status: "error", error: "Job not found" }, 404); }

  // ---------- task-list scan
  if (p === "/api/scan/start" && M === "POST") {
    if (!screens.status.ok) return json({ ok: false, error: screens.status.message, dir: screens.status.dir }, 400);
    screens.startCapture(); return json({ ok: true, dir: screens.dir });
  }
  if (p === "/api/scan/stop" && M === "POST") { screens.stopCapture(); return json({ ok: true, files: screens.captureList() }); }
  if (p === "/api/scan/cancel" && M === "POST") { screens.cancelCapture(); broadcast({ type: "capture", files: [], cancelled: true }); return json({ ok: true }); }
  if (p === "/api/scan/remove" && M === "POST") { const b = await body(req); screens.removeFromCapture(String(b.name || "")); return json({ ok: true }); }
  if (p === "/api/scan/image") {
    const name = url.searchParams.get("name") || "";
    const buf = screens.readCaptured(name);
    if (!buf) return new Response("Not found", { status: 404 });
    const type = /\.png$/i.test(name) ? "image/png" : /\.bmp$/i.test(name) ? "image/bmp" : "image/jpeg";
    return new Response(buf, { headers: { "content-type": type, "cache-control": "no-store" } });
  }
  if (p === "/api/scan/read" && M === "POST") {
    if (!settings.openaiKey) return json({ ok: false, error: "Add your OpenAI API key first" }, 400);
    const b = await body(req);
    const dataUrl = String(b.image || "");
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl) || dataUrl.length > 25_000_000) return json({ ok: false, error: "Bad image" }, 400);
    try { return json({ ok: true, ...(await readTaskList(settings.openaiKey, settings.openaiModel || DEFAULT_MODEL, dataUrl)) }); }
    catch (e: any) { return json({ ok: false, error: String(e?.message || e) }, 502); }
  }
  if (p === "/api/scan/confirm" && M === "POST") {
    const b = await body(req);
    const deleted = screens.deleteCaptured(Array.isArray(b.names) ? b.names.map(String) : []);
    broadcast({ type: "capture", files: [], done: true });
    return json({ ok: true, deleted });
  }

  return new Response("Not found", { status: 404 });
}

// ---------------------------------------------------------------- listen
function start(port: number): any {
  try { return Bun.serve({ hostname: "127.0.0.1", port, fetch: handler, idleTimeout: 0 }); }
  catch (e) { if (port < 7800) return start(port + 1); throw e; }
}
const server = start(Number(process.env.PORT) || 7777);
const url = `http://127.0.0.1:${server.port}/`;
startWatchers();
console.log(`\n  Squad Task Map ${VERSION} is running`);
console.log("  Open: " + url);
console.log("  Your data:        " + FILES.state);
console.log("  Game data:        " + dataStatus().origin + (dataStatus().generated ? " (" + String(dataStatus().generated).slice(0, 10) + ")" : ""));
console.log("  Game logs:        " + (logs.status.ok ? logs.status.dir : logs.status.message));
console.log("  Screenshots:      " + (screens.status.ok ? screens.status.dir : screens.status.message));
console.log("\n  Close this window to stop.\n");
if (!process.env.STM_NO_BROWSER) {
  try {
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    else spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch { /* the URL is printed above */ }
}
void clientCount; void gameMode;
