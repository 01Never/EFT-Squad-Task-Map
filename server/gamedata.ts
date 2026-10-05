// Game data: json.tarkov.dev (live) → cached next to the exe → bundled snapshot as last resort.
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import bundledText from "../assets/game-data.json" with { type: "text" };
import { fromRaw, fromAny, SCENE_TO_MAP, NAMEID_TO_MAP, type GameData } from "./convert.ts";
import { FILES } from "./paths.ts";

const JSON_BASE = process.env.STM_JSON_BASE || "https://json.tarkov.dev";
const UA = "SquadTaskMap/2.0 (personal local map tool)";
const DAY = 24 * 3600 * 1000;

let current: GameData;
let origin: "live" | "cache" | "built-in" = "built-in";
let fetchedAt: number | null = null;
let lastError: string | null = null;
let refreshing = false;
let mode = "regular";
let jsonText: string | null = null;
let onChange: () => void = () => {};

let bundled: GameData | null = null;
const getBundled = () => (bundled ??= fromAny(bundledText, "regular"));

function loadCache(m: string): { data: GameData; fetchedAt: number } | null {
  try {
    const f = FILES.gamedata(m);
    if (!existsSync(f)) return null;
    const o = JSON.parse(readFileSync(f, "utf8"));
    if (o?.data?.format === "stm-v2" && Array.isArray(o.data.tasks) && o.data.tasks.length > 100) return o;
  } catch {}
  return null;
}

export function initGameData(m: string, changed: () => void) {
  onChange = changed;
  setMode(m, false);
  // check once an hour; refresh when the data is a day old (one small download, nothing else)
  setInterval(() => { if (!refreshing && (!fetchedAt || Date.now() - fetchedAt > DAY)) refresh().catch(() => {}); }, 3600_000).unref?.();
}

export function setMode(m: string, notify = true) {
  mode = ["regular", "pve", "pvp-season"].includes(m) ? m : "regular";
  const c = loadCache(mode);
  if (c) { current = c.data; origin = "cache"; fetchedAt = c.fetchedAt; }
  else { current = { ...getBundled(), mode }; origin = "built-in"; fetchedAt = null; }
  jsonText = null; lastError = null;
  if (notify) onChange();
  if (!fetchedAt || Date.now() - fetchedAt > DAY) refresh().catch(() => {});
}

async function getJson(path: string) {
  const r = await fetch(`${JSON_BASE}/${path}`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`json.tarkov.dev/${path}: HTTP ${r.status}`);
  return r.json();
}

export async function refresh(): Promise<{ ok: boolean; tasks?: number; error?: string }> {
  if (refreshing) return { ok: false, error: "Already updating" };
  refreshing = true;
  const m = mode;
  try {
    const opt = (p: string) => getJson(p).catch(() => null);
    const [tasks, tasksEn, maps, mapsEn, traders, tradersEn, itemsEn] = await Promise.all([
      getJson(`${m}/tasks`), opt(`${m}/tasks_en`), getJson(`${m}/maps`), opt(`${m}/maps_en`), opt(`${m}/traders`), opt(`${m}/traders_en`), opt(`${m}/items_en`),
    ]);
    const gd = fromRaw({ tasks, tasksEn, maps, mapsEn, traders, tradersEn, itemsEn }, m, new Date().toISOString());
    const prev = current?.tasks.length || 0;
    if (gd.tasks.length < Math.max(200, prev * 0.5) || gd.maps.length < 5)
      throw new Error(`Download looked incomplete (${gd.tasks.length} tasks, ${gd.maps.length} maps); kept the old data`);
    const now = Date.now();
    const f = FILES.gamedata(m);
    writeFileSync(f + ".tmp", JSON.stringify({ fetchedAt: now, data: gd }));
    renameSync(f + ".tmp", f);
    if (m === mode) { current = gd; origin = "live"; fetchedAt = now; lastError = null; jsonText = null; onChange(); }
    return { ok: true, tasks: gd.tasks.length };
  } catch (e: any) {
    lastError = String(e?.message || e);
    onChange();
    return { ok: false, error: lastError };
  } finally { refreshing = false; }
}

export const gameData = () => current;
export const gameMode = () => mode;
export function dataStatus() {
  return { origin, mode, generated: current?.generated ?? null, fetchedAt, error: lastError, refreshing, tasks: current?.tasks.length || 0 };
}
/** The data as sent to the page — stringified once per change. */
export function dataJson(): string {
  if (!jsonText) jsonText = JSON.stringify({ ...current, status: dataStatus() });
  return jsonText;
}

export function mapFromScene(scene: string): string | null {
  for (const m of current.maps) {
    if (m.scene === scene || ((m as any).alt || []).some((a: any) => a.scene === scene)) return m.key;
  }
  return SCENE_TO_MAP[scene] ?? null;
}
export function mapFromNameId(nameId: string): string | null {
  for (const m of current.maps) if (m.nameId === nameId || ((m as any).alt || []).some((a: any) => a.nameId === nameId)) return m.key;
  return NAMEID_TO_MAP[nameId.toLowerCase()] ?? null;
}
export const taskExists = (id: string) => current.tasks.some((t) => t.id === id);
