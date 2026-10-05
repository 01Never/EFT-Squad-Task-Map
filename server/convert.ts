// Turns game data into the one internal format the app uses ("stm-v2").
//
// Two sources:
//  - fromRaw():      json.tarkov.dev flat files ({mode}/tasks, tasks_en, maps, maps_en, traders, traders_en, items_en).
//                    Field handling follows how tarkov.dev's own site and tarkovtaskmap read these files.
//  - fromSnapshot(): the bundled tarkovtaskmap-style snapshot (offline fallback).
//
// Pure functions only (no I/O) so they can be unit-tested.

export type Item = { id: string; name: string };
export type Zone = { m: string; x: number; y: number; z: number; top?: number; bottom?: number; ol?: number[][] };
export type Obj = {
  id: string; type: string; d: string; n: number; fir: boolean; opt: boolean;
  maps: string[]; zones: Zone[]; poss: { m: string; p: number[][] }[];
  keys: Item[][];          // AND across groups; each group = alternatives
  items: Item[];           // alternatives (find/give/plant)
  marker: Item | null;     // mark objectives
  qi: string | null;       // quest item name
  targets: string[];       // shoot targets
  gear: { weapons: Item[]; mods: Item[][]; wearing: Item[][]; notWearing: number } | null;
  time: [number, number] | null;
};
export type Task = { id: string; name: string; trader: string; map: string | null; wiki: string | null; minLevel: number; kappa: boolean; lk: boolean; objs: Obj[] };
export type MapInfo = {
  key: string; scene: string | null; nameId: string | null;
  extracts: { n: string; fa: string; x: number; y: number; z: number; ol?: number[][] }[];
  transits: { n: string; x: number; y: number; z: number }[];
};
export type GameData = { format: "stm-v2"; generated: string | null; mode: string; tasks: Task[]; maps: MapInfo[] };

export const MS2000: Item = { id: "5991b51486f77447b112d44f", name: "MS2000 Marker" };

const ALIAS: Record<string, string> = { "ground-zero-21": "ground-zero", "night-factory": "factory" };
export const mapKey = (n?: string | null): string | null => (n ? ALIAS[n] ?? n : null);

const num = (v: any) => (typeof v === "number" && isFinite(v) ? v : 0);
const outline = (ol: any): number[][] | undefined =>
  Array.isArray(ol) && ol.length >= 3 ? ol.filter((p: any) => p && isFinite(p.x) && isFinite(p.z)).map((p: any) => [+p.x.toFixed(2), +p.z.toFixed(2)]) : undefined;
const uniqBy = <T>(arr: T[], k: (x: T) => string) => { const s = new Set<string>(); return arr.filter((x) => (s.has(k(x)) ? false : (s.add(k(x)), true))); };

/** Attach task-level neededKeys that no objective already lists, to the first objective on that map. */
function attachNeededKeys(objs: Obj[], needed: { m: string | null; keys: Item[] }[]) {
  const have = new Set(objs.flatMap((o) => o.keys.flat().map((k) => k.id)));
  for (const nk of needed) {
    const missing = nk.keys.filter((k) => !have.has(k.id));
    if (!missing.length) continue;
    const target = objs.find((o) => nk.m && (o.zones.some((z) => z.m === nk.m) || o.maps.includes(nk.m))) || objs.find((o) => o.zones.length) || objs[0];
    if (!target) continue;
    target.keys.push(missing);
    missing.forEach((k) => have.add(k.id));
  }
}

// ------------------------------------------------------------------ raw json.tarkov.dev
export type RawDocs = { tasks: any; tasksEn?: any; maps: any; mapsEn?: any; traders?: any; tradersEn?: any; itemsEn?: any };

export function fromRaw(docs: RawDocs, mode: string, generated: string | null): GameData {
  const dataOf = (d: any) => (d && d.data) || d || {};
  const en = dataOf(docs.tasksEn), men = dataOf(docs.mapsEn), ten = dataOf(docs.tradersEn), ien = dataOf(docs.itemsEn);
  const has = (o: any, k: any) => k != null && o[k] != null && o[k] !== "";
  const tr = (k: any) => (has(en, k) ? String(en[k]) : k == null ? "" : String(k));
  const idOf = (x: any) => (x && typeof x === "object" ? x.id : x);
  const itemName = (id: string) => (has(ien, id + " Name") ? ien[id + " Name"] : has(en, id + " Name") ? en[id + " Name"] : id);
  const mkItem = (x: any): Item => { const id = String(idOf(x)); let name = itemName(id); if (name === id && x && typeof x === "object" && x.name) name = tr(x.name); return { id, name }; };
  const groups = (g: any): Item[][] => (Array.isArray(g) ? g : []).map((a: any) => (Array.isArray(a) ? a : [a]).filter((v: any) => v != null).map(mkItem)).filter((a: Item[]) => a.length);

  const rawMaps = dataOf(docs.maps).maps || {};
  const mid2key: Record<string, string> = {};
  for (const id in rawMaps) mid2key[id] = mapKey(rawMaps[id].normalizedName)!;
  const mk = (id: any) => (id == null ? null : mid2key[id] ?? mapKey(String(id)));

  const rawTraders = dataOf(docs.traders);
  const traderName = (id: any) => { const t = rawTraders[id]; const nm = t ? t.name : id; return has(ten, nm) ? ten[nm] : nm || "?"; };

  const rawTasksDoc = dataOf(docs.tasks);
  const rawQI = rawTasksDoc.questItems || {};
  const qiName = (id: any) => { if (id && typeof id === "object") return tr(id.name) || id.id; const q = rawQI[id]; const k = q && q.name; return has(ien, k) ? ien[k] : has(en, k) ? en[k] : k || String(id); };

  const tasks: Task[] = [];
  const rawTasks = rawTasksDoc.tasks || {};
  for (const tid in rawTasks) {
    const t = rawTasks[tid];
    const objs: Obj[] = (t.objectives || []).map((o: any): Obj => {
      const shoot = o.type === "shoot";
      const gear = shoot ? { weapons: (o.usingWeapon || []).map(mkItem), mods: groups(o.usingWeaponMods), wearing: groups(o.wearing), notWearing: (o.notWearing || []).length } : null;
      const hasGear = gear && (gear.weapons.length || gear.mods.length || gear.wearing.length || gear.notWearing);
      const tf = o.timeFromHour, tu = o.timeUntilHour;
      return {
        id: String(o.id), type: String(o.type), d: tr(o.description), n: num(o.count), fir: !!o.foundInRaid, opt: !!o.optional,
        maps: (o.maps || []).map(mk).filter(Boolean),
        zones: (o.zones || []).filter((z: any) => z && z.position).map((z: any) => ({
          m: mk(z.map)!, x: num(z.position.x), y: num(z.position.y), z: num(z.position.z),
          ...(isFinite(z.top) ? { top: z.top } : {}), ...(isFinite(z.bottom) ? { bottom: z.bottom } : {}),
          ...(outline(z.outline) ? { ol: outline(z.outline) } : {}),
        })).filter((z: Zone) => z.m),
        poss: (o.possibleLocations || []).map((pl: any) => ({ m: mk(pl.map)!, p: (pl.positions || (pl.position ? [pl.position] : [])).map((q: any) => [num(q.x), num(q.y), num(q.z)]) })).filter((p: any) => p.m && p.p.length),
        keys: groups(o.requiredKeys),
        items: (o.items || (o.item ? [o.item] : [])).map(mkItem),
        marker: o.type === "mark" ? (o.markerItem ? mkItem(o.markerItem) : MS2000) : null,
        qi: o.questItem ? qiName(o.questItem) : null,
        targets: (o.targetNames || (o.target ? [o.target] : [])).map((x: any) => tr(x)),
        gear: hasGear ? gear : null,
        time: shoot && (tf || tu) && !(tf === 0 && tu === 0) ? [num(tf), num(tu)] : null,
      };
    });
    attachNeededKeys(objs, (t.neededKeys || []).map((nk: any) => ({ m: mk(nk.map), keys: (nk.keys || []).map(mkItem) })));
    tasks.push({
      id: String(t.id ?? tid), name: tr(t.name), trader: traderName(t.trader), map: mk(t.map),
      wiki: t.wikiLink || null, minLevel: num(t.minPlayerLevel), kappa: !!t.kappaRequired, lk: !!t.lightkeeperRequired, objs,
    });
  }

  const maps: MapInfo[] = [];
  const seen = new Set<string>();
  // prefer the non-"21" variant when two raw maps normalize to the same key
  const ids = Object.keys(rawMaps).sort((a, b) => (/21|night/.test(rawMaps[a].normalizedName) ? 1 : 0) - (/21|night/.test(rawMaps[b].normalizedName) ? 1 : 0));
  for (const id of ids) {
    const m = rawMaps[id], key = mapKey(m.normalizedName)!;
    const tm = (k: any) => (has(men, k) ? men[k] : k);
    const entry: MapInfo = {
      key, scene: m.scenePath || null, nameId: m.nameId || null,
      extracts: (m.extracts || []).filter((e: any) => e && e.position).map((e: any) => ({ n: String(tm(e.name)), fa: e.faction || "", x: num(e.position.x), y: num(e.position.y), z: num(e.position.z), ...(outline(e.outline) ? { ol: outline(e.outline) } : {}) })),
      transits: (m.transits || []).filter((x: any) => x && x.position).map((x: any) => ({ n: String(tm(x.description)), x: num(x.position.x), y: num(x.position.y), z: num(x.position.z) })),
    };
    if (seen.has(key)) { // keep extra scene/nameId aliases for log matching
      const prev = maps.find((p) => p.key === key)!;
      (prev as any).alt = [...((prev as any).alt || []), { scene: entry.scene, nameId: entry.nameId }];
      continue;
    }
    seen.add(key); maps.push(entry);
  }
  return { format: "stm-v2", generated, mode, tasks, maps };
}

// ------------------------------------------------------------------ bundled snapshot (tarkovtaskmap format)
export function fromSnapshot(snap: any, mode = "regular"): GameData {
  const d = snap.data ?? snap;
  const it = (x: any): Item => ({ id: String(x.id), name: String(x.name || x.short || x.id) });
  const tasks: Task[] = (d.tasks || []).map((t: any): Task => {
    const objs: Obj[] = (t.objectives || []).map((o: any): Obj => {
      const g = o.gear;
      return {
        id: String(o.id), type: String(o.type), d: String(o.description || ""), n: num(o.count), fir: !!o.foundInRaid, opt: !!o.optional,
        maps: (o.maps || []).map((m: any) => mapKey(m.normalizedName)).filter(Boolean) as string[],
        zones: (o.zones || []).filter((z: any) => z.position).map((z: any) => ({ m: mapKey(z.map?.normalizedName)!, x: num(z.position.x), y: num(z.position.y), z: num(z.position.z) })).filter((z: Zone) => z.m),
        poss: (o.possibleLocations || []).map((p: any) => ({ m: mapKey(p.map?.normalizedName)!, p: (p.positions || []).map((q: any) => [num(q.x), num(q.y), num(q.z)]) })).filter((p: any) => p.m && p.p.length),
        // the snapshot flattens key groups; most multi-key lists are alternatives, so keep them as one group
        keys: (o.requiredKeys || []).length ? [uniqBy((o.requiredKeys || []).map(it), (k) => k.id)] : [],
        items: (o.items || []).map(it),
        marker: o.type === "mark" ? MS2000 : null,
        qi: o.questItem ? String(o.questItem.name || o.questItem.short || "") : null,
        targets: [],
        gear: g && o.type === "shoot" ? { weapons: (g.weapons || []).map(it), mods: (g.mods || []).map((a: any[]) => a.map(it)), wearing: (g.wearing || []).map((a: any[]) => a.map(it)), notWearing: num(g.notWearing) } : null,
        time: null,
      };
    });
    attachNeededKeys(objs, (t.neededKeys || []).map((nk: any) => ({ m: mapKey(nk.map?.normalizedName), keys: (nk.keys || []).map(it) })));
    return { id: String(t.id), name: String(t.name), trader: String(t.trader?.name || "?"), map: mapKey(t.map?.normalizedName), wiki: t.wikiLink || null,
      minLevel: num(t.minPlayerLevel), kappa: !!t.kappaRequired, lk: !!t.lightkeeperRequired, objs };
  });
  const maps: MapInfo[] = [];
  for (const m of d.maps || []) {
    const key = mapKey(m.normalizedName)!;
    if (maps.some((x) => x.key === key)) continue;
    maps.push({
      key, scene: null, nameId: null,
      extracts: (m.extracts || []).map((e: any) => ({ n: String(e.key || e.name), fa: e.faction || "", x: num(e.position.x), y: num(e.position.y), z: num(e.position.z) })),
      transits: (m.transits || []).map((e: any) => ({ n: String(e.description), x: num(e.position.x), y: num(e.position.y), z: num(e.position.z) })),
    });
  }
  return { format: "stm-v2", generated: snap.generated ?? null, mode, tasks, maps };
}

/** Accepts any of: already-converted stm-v2, a tarkovtaskmap snapshot, or a `window.__X = {...};` JS file. */
export function fromAny(textOrObj: string | any, mode = "regular"): GameData {
  let o = textOrObj;
  if (typeof o === "string") { const i = o.indexOf("{"); o = JSON.parse(o.slice(i).trim().replace(/;\s*$/, "")); }
  if (o && o.format === "stm-v2") return o as GameData;
  return fromSnapshot(o, mode);
}

// Log scene paths / nameIds → map key (from the game's own location data). Used when tarkov.dev data has no scenePath.
export const SCENE_TO_MAP: Record<string, string> = {
  "maps/customs_preset.bundle": "customs", "maps/factory_day_preset.bundle": "factory", "maps/factory_night_preset.bundle": "factory",
  "maps/shopping_mall.bundle": "interchange", "maps/laboratory_preset.bundle": "the-lab", "maps/lighthouse_preset.bundle": "lighthouse",
  "maps/rezerv_base_preset.bundle": "reserve", "maps/sandbox_preset.bundle": "ground-zero", "maps/sandbox_high_preset.bundle": "ground-zero",
  "maps/shoreline_preset.bundle": "shoreline", "maps/city_preset.bundle": "streets-of-tarkov", "maps/woods_preset.bundle": "woods",
  "maps/labyrinth_preset.bundle": "labyrinth",
};
export const NAMEID_TO_MAP: Record<string, string> = {
  bigmap: "customs", factory4_day: "factory", factory4_night: "factory", interchange: "interchange", laboratory: "the-lab",
  lighthouse: "lighthouse", rezervbase: "reserve", sandbox: "ground-zero", sandbox_high: "ground-zero", shoreline: "shoreline",
  tarkovstreets: "streets-of-tarkov", woods: "woods", labyrinth: "labyrinth",
};
