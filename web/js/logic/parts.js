// What each objective is about, how tasks split into parts, and tick progress. Pure; no DOM.

export const ACTIONS = ["boss", "pmc", "scav", "mark", "plant", "retrieve", "go"];
// Unsplit tasks take the "hardest" action they contain.
export const PRECEDENCE = ["boss", "pmc", "scav", "plant", "mark", "retrieve", "go"];
export const ACTION_LABEL = { boss: "boss", pmc: "PMC kills", scav: "kills", mark: "marking", plant: "placing", retrieve: "pick-up", go: "scouting", offmap: "hand-in" };

const OFFMAP = new Set(["findItem", "giveItem", "buildWeapon", "sellItem", "skill", "traderLevel", "traderStanding", "taskStatus", "experience", "playerLevel"]);
const BOSS_RE = /\b(reshala|killa|tagilla|glukhar|sanitar|shturman|kollontay|kaban|partisan|zryachiy|knight|big ?pipe|birdeye|goons)\b/;

export function objAction(o) {
  if (o.type === "shoot") {
    const t = (o.targets || []).join(" ").toLowerCase(), d = (o.d || "").toLowerCase();
    if (BOSS_RE.test(t) || BOSS_RE.test(d)) return "boss";
    if (/pmc|usec|bear/.test(t) || /\bpmcs?\b|pmc operatives|\busec\b|\bbear operatives\b/.test(d)) return "pmc";
    return "scav";
  }
  if (o.type === "mark") return "mark";
  if (o.type === "plantItem" || o.type === "plantQuestItem") return "plant";
  if (o.type === "findQuestItem") return "retrieve";
  if (o.type === "visit" || o.type === "extract" || o.type === "useItem") return "go";
  if (OFFMAP.has(o.type)) return "offmap";
  return (o.zones && o.zones.length) || (o.maps && o.maps.length) ? "go" : "offmap";
}

export const isOneRaid = (t) => t.objs.some((o) => /\(in one raid\)/i.test(o.d || ""));

const cache = new Map();
export function clearPartsCache() { cache.clear(); }

/**
 * Split a task into parts by action. Glue rules: "hand over" joins its pick-up; "survive and extract"
 * joins the group before it. "(In one raid)" tasks and tasks with noSplit stay whole.
 * Returns [{key, action, objs, split, index, total}].
 */
export function partsOf(t, noSplit = false) {
  const ck = t.id + (noSplit ? "|1" : "|0");
  if (cache.has(ck)) return cache.get(ck);
  const groups = [], by = {}, pendingExtract = [], gives = [];
  let last = null;
  for (const o of t.objs) {
    if (o.type === "giveQuestItem") { gives.push(o); continue; }
    if (o.type === "extract") { if (last) last.objs.push(o); else pendingExtract.push(o); continue; }
    const a = objAction(o);
    if (a === "offmap") continue;
    let g = by[a];
    if (!g) { g = by[a] = { action: a, objs: [] }; groups.push(g); }
    g.objs.push(o); last = g;
  }
  if (pendingExtract.length) {
    if (groups.length) groups[0].objs.push(...pendingExtract);
    else { const g = (by.go = { action: "go", objs: pendingExtract }); groups.push(g); }
  }
  for (const gq of gives) {
    const home = groups.find((g) => g.objs.some((o) => o.type === "findQuestItem" && o.qi && o.qi === gq.qi)) || by.retrieve;
    if (home) home.objs.push(gq);
  }
  const order = (objs) => objs.slice().sort((a, b) => t.objs.indexOf(a) - t.objs.indexOf(b));
  let parts;
  if (noSplit || isOneRaid(t) || groups.length <= 1) {
    const action = groups.length ? PRECEDENCE.find((p) => by[p]) : "offmap";
    parts = [{ key: t.id + ":*", action, objs: order(groups.flatMap((g) => g.objs)), split: false, index: 0, total: 1 }];
  } else {
    const gs = groups.slice().sort((a, b) => t.objs.indexOf(order(a.objs)[0]) - t.objs.indexOf(order(b.objs)[0]));
    parts = gs.map((g, i) => ({ key: t.id + ":" + g.action, action: g.action, objs: order(g.objs), split: true, index: i, total: gs.length }));
  }
  cache.set(ck, parts);
  return parts;
}

export function canSplit(t) {
  const p = partsOf(t, false);
  return p.length > 1;
}

// ---------- maps
export function objOnMap(o, k, t) {
  if (o.zones.some((z) => z.m === k) || o.poss.some((p) => p.m === k) || o.maps.includes(k)) return true;
  return !o.maps.length && !o.zones.length && !o.poss.length && t.map === k;
}
export function taskOnMap(t, k) {
  if (t.map === k) return true;
  return t.objs.some((o) => o.maps.includes(k) || o.zones.some((z) => z.m === k) || o.poss.some((p) => p.m === k));
}
export function mapsOf(t) {
  const s = new Set();
  if (t.map) s.add(t.map);
  for (const o of t.objs) { o.maps.forEach((m) => m && s.add(m)); o.zones.forEach((z) => z.m && s.add(z.m)); o.poss.forEach((p) => p.m && s.add(p.m)); }
  return [...s];
}
export const partOnMap = (p, k, t) => p.objs.some((o) => objOnMap(o, k, t));
export const isOffmapTask = (t) => partsOf(t)[0].action === "offmap";

// ---------- ticks
export const tickTarget = (o) => Math.max(o.n || 0, 1);
export function tickValue(o, ticks) {
  const v = ticks[o.id];
  if (v === true) return tickTarget(o);
  return typeof v === "number" ? Math.max(0, Math.min(v, tickTarget(o))) : 0;
}
export const objDone = (o, ticks) => tickValue(o, ticks) >= tickTarget(o);
const required = (p) => { const r = p.objs.filter((o) => !o.opt); return r.length ? r : p.objs; };
export const partDone = (p, ticks) => p.objs.length > 0 && required(p).every((o) => objDone(o, ticks));
export function partProgress(p, ticks) {
  const r = required(p);
  if (!r.length) return 0;
  return Math.round((r.reduce((s, o) => s + tickValue(o, ticks) / tickTarget(o), 0) / r.length) * 100);
}
/** Objectives that use a counter instead of a checkbox. */
export const isCounter = (o) => (o.n || 0) > 1;
