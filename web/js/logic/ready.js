// Requirements per objective (keys, items to place, gear), readiness, and the bring list. Pure; no DOM.
import { objDone, tickValue, tickTarget } from "./parts.js";

export const MS2000 = { id: "5991b51486f77447b112d44f", name: "MS2000 Marker" };

function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
/** One key per requirement: an item id, or a stable id for a set of alternatives. */
export function reqKey(items) {
  const ids = [...new Set(items.map((i) => i.id))].sort();
  return ids.length === 1 ? ids[0] : "any:" + hash(ids.join(","));
}

const reqCache = new WeakMap();
/**
 * Requirements of one objective: [{kind:"key"|"place"|"gear", key, items, need, label}]
 * - key: each key group is alternatives; groups are all needed.
 * - place: markers / plantItem items (alternatives) × count.
 * - gear: weapon (alternatives), worn items, weapon mods.
 * Game data lists "must wear" either as separate single items (all needed, e.g. armor + helmet)
 * or as alternative outfits (e.g. hat + vest combinations). Single-item lists of up to 4 are
 * treated as "all of these"; anything else as "any one outfit".
 */
export function requirementsOf(o) {
  if (reqCache.has(o)) return reqCache.get(o);
  const out = [];
  for (const g of o.keys || []) if (g.length) out.push({ kind: "key", key: reqKey(g), items: g, need: 1, label: g.length > 1 ? "Key (any one)" : "Key" });
  if (o.type === "mark") { const m = o.marker || MS2000; out.push({ kind: "place", key: m.id, items: [m], need: 1, label: "Marker" }); }
  if (o.type === "plantItem" && o.items.length) out.push({ kind: "place", key: reqKey(o.items), items: o.items, need: tickTarget(o), label: o.items.length > 1 ? "Place (any one)" : "Place" });
  const g = o.gear;
  if (g) {
    if (g.weapons.length) out.push({ kind: "gear", key: reqKey(g.weapons), items: g.weapons, need: 1, label: g.weapons.length > 1 ? "Weapon (any one)" : "Weapon" });
    const W = g.wearing || [];
    if (W.length && W.every((x) => x.length === 1) && W.length <= 4) W.forEach((x) => out.push({ kind: "gear", key: x[0].id, items: x, need: 1, label: "Wear" }));
    else if (W.length) {
      const sig = W.map((x) => x.map((i) => i.id).sort().join("+")).sort().join("|");
      out.push({ kind: "gear", key: "outfit:" + hash(sig), items: W.map((x) => ({ id: x.map((i) => i.id).join("+"), name: x.map((i) => i.name).join(" + ") })), need: 1, label: "Wear (any one outfit)" });
    }
    const Mo = g.mods || [];
    if (Mo.length) {
      const sig = Mo.map((x) => x.map((i) => i.id).sort().join("+")).sort().join("|");
      out.push({ kind: "gear", key: "mods:" + hash(sig), items: Mo.map((x) => ({ id: x.map((i) => i.id).join("+"), name: x.map((i) => i.name).join(" + ") })), need: 1, label: Mo.length > 1 ? "Weapon mods (any one set)" : "Weapon mods" });
    }
  }
  reqCache.set(o, out);
  return out;
}

export const has = (have, key) => (have[key] || 0) >= 1;
/** Possible = at least one of everything it still needs. */
export const objReady = (o, have) => requirementsOf(o).every((r) => has(have, r.key));
export const missingFor = (o, have) => requirementsOf(o).filter((r) => !has(have, r.key));
export const partReady = (p, ticks, have) => p.objs.filter((o) => !objDone(o, ticks)).every((o) => objReady(o, have));

/** Items this objective consumes when ticked (markers, planted items): {key, per tick}. */
export function consumes(o) {
  if (o.type === "mark") return requirementsOf(o).find((r) => r.kind === "place") || null;
  if (o.type === "plantItem") return requirementsOf(o).find((r) => r.kind === "place") || null;
  return null;
}

const itemLabel = (items) => (items.length === 1 ? items[0].name : items.slice(0, 3).map((i) => i.name).join(" / ") + (items.length > 3 ? ` +${items.length - 3} more` : ""));

/**
 * Bring list for a set of visible objectives: [{task, o}] (remaining, i.e. not done).
 * Keys/gear need 1; placed items sum the remaining count. Found-in-raid comes from `firTasks`.
 */
export function bringList(entries, ticks, have, firTasks = []) {
  const sections = { key: new Map(), place: new Map(), gear: new Map() };
  for (const { task, o } of entries) {
    if (objDone(o, ticks)) continue;
    for (const r of requirementsOf(o)) {
      const map = sections[r.kind];
      let e = map.get(r.key);
      if (!e) { e = { key: r.key, kind: r.kind, label: r.label, name: itemLabel(r.items), items: r.items, need: 0, by: new Map() }; map.set(r.key, e); }
      const n = r.kind === "place" ? Math.max(0, tickTarget(o) - tickValue(o, ticks)) : 1;
      e.by.set(task.name, (e.by.get(task.name) || 0) + (r.kind === "place" ? n : 1));
      e.need = r.kind === "place" ? e.need + n : 1;
    }
  }
  const fir = new Map();
  for (const t of firTasks) {
    const finds = t.objs.filter((o) => o.type === "findItem" && o.items.length);
    const findKeys = new Set(finds.map((o) => reqKey(o.items)));
    const list = finds.concat(t.objs.filter((o) => o.type === "giveItem" && o.items.length && !findKeys.has(reqKey(o.items))));
    for (const o of list) {
      if (objDone(o, ticks)) continue;
      const k = reqKey(o.items) + (o.fir ? ":fir" : "");
      let e = fir.get(k);
      if (!e) { e = { key: k, kind: "fir", fir: o.fir, name: itemLabel(o.items), items: o.items, need: 0, by: new Map() }; fir.set(k, e); }
      const n = Math.max(0, tickTarget(o) - tickValue(o, ticks));
      e.need += n; e.by.set(t.name, (e.by.get(t.name) || 0) + n);
    }
  }
  const fin = (m) => [...m.values()].filter((e) => e.need > 0).map((e) => ({ ...e, have: have[e.key] || 0, by: [...e.by.entries()] })).sort((a, b) => a.name.localeCompare(b.name));
  return { keys: fin(sections.key), place: fin(sections.place), gear: fin(sections.gear), fir: fin(fir) };
}
