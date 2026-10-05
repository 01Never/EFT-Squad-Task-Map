// Shared app state + saving. The page owns the saved data; the server only stores it.
import { $ } from "./util.js";
import { blankEntry, catForPart, DEFAULT_EXT } from "./logic/state.js";
import { partsOf, taskOnMap, objDone, isOffmapTask } from "./logic/parts.js";
import { consumes } from "./logic/ready.js";

export const app = {
  S: null, DATA: null, CFG: [], STATUS: null, BYID: {}, matcher: null,
  M: null,               // current map page context
  gps: null, trail: [],  // last position from an in-raid screenshot
  capture: null,         // scan in progress
};

let saveTimer = null, saving = false, dirty = false;
export function save() {
  dirty = true;
  const el = $("#saved");
  if (el) { el.textContent = "Saving…"; el.classList.remove("err"); }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
}
export async function flush() {
  if (!dirty || saving) return;
  saving = true; dirty = false;
  try {
    const r = await fetch("/api/state", { method: "PUT", body: JSON.stringify(app.S), keepalive: true });
    if (!r.ok) throw 0;
    $("#saved").textContent = "Saved ✓";
  } catch {
    $("#saved").textContent = "Save failed";
    $("#saved").classList.add("err");
    dirty = true;
  }
  saving = false;
  if (dirty) saveTimer = setTimeout(flush, 1500);
}
addEventListener("beforeunload", () => { if (dirty) fetch("/api/state", { method: "PUT", body: JSON.stringify(app.S), keepalive: true }); });

export function prefs(k) {
  const S = app.S;
  return (S.prefs[k] = S.prefs[k] || { ext: { ...DEFAULT_EXT }, extMarked: {}, labels: true, drawOn: true });
}
export const entry = (id) => (app.S.tasks[id] = app.S.tasks[id] || blankEntry());
export const isActive = (id) => !!(app.S.tasks[id] && app.S.tasks[id].active);
export const activeTasks = () => Object.keys(app.S.tasks).filter((id) => app.S.tasks[id].active && app.BYID[id]).map((id) => app.BYID[id]);
export const tasksOn = (k) => activeTasks().filter((t) => taskOnMap(t, k));
export const offmapActive = () => activeTasks().filter((t) => isOffmapTask(t));
export const partsFor = (t) => partsOf(t, !!(app.S.tasks[t.id] && app.S.tasks[t.id].noSplit));
export const catOf = (t, p) => catForPart(app.S, t, p);
export const mapName = (k) => (app.CFG.find((m) => m.key === k) || {}).name || { "the-lab": "The Lab", labyrinth: "The Labyrinth" }[k] || k;

/** Mark a task active (from a scan, the log, or by hand). */
export function activate(id, source, extra = {}) {
  const e = entry(id);
  const was = e.active;
  Object.assign(e, { active: true, source: was ? e.source : source, addedAt: was ? e.addedAt : Date.now() }, extra);
  return !was;
}
/** Finished/failed (from the log): inactive, ticks cleared, unpinned. Categories and sub-tasks are kept. */
export function finish(id) {
  const e = app.S.tasks[id];
  if (!e || !e.active) return false;
  e.active = false; e.pinned = false;
  const t = app.BYID[id];
  if (t) for (const o of t.objs) delete app.S.ticks[o.id];
  return true;
}

/** Set an objective's tick value; markers / planted items also come off the "have" count. */
export function setTick(o, value) {
  const S = app.S;
  const target = Math.max(o.n || 0, 1);
  const old = S.ticks[o.id] === true ? target : typeof S.ticks[o.id] === "number" ? S.ticks[o.id] : 0;
  const v = Math.max(0, Math.min(target, value === true ? target : value === false ? 0 : value));
  if (v === 0) delete S.ticks[o.id]; else S.ticks[o.id] = v >= target && target === 1 ? true : v;
  const c = consumes(o);
  const delta = v - old;
  if (!c || !delta) return;
  S.used = S.used || {};
  if (delta > 0) { // placed: take from what's in the bag (if anything was counted)
    const take = Math.min(delta, S.have[c.key] || 0);
    if (take) { S.have[c.key] -= take; S.used[o.id] = (S.used[o.id] || 0) + take; }
  } else { // unticked: give back only what this objective took
    const back = Math.min(-delta, S.used[o.id] || 0);
    if (back) { S.have[c.key] = (S.have[c.key] || 0) + back; S.used[o.id] -= back; if (!S.used[o.id]) delete S.used[o.id]; }
  }
}
export const done = (o) => objDone(o, app.S.ticks);
