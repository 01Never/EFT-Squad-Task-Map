// Test helpers: build json.tarkov.dev-shaped documents from the bundled snapshot, so the live-data
// converter is exercised on realistic data (ids + translation keys, as tarkov.dev's flat files use).
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");
export function loadSnapshot() {
  const t = readFileSync(join(ROOT, "assets", "game-data.json"), "utf8");
  return JSON.parse(t.slice(t.indexOf("{")).trim().replace(/;\s*$/, ""));
}

/** Snapshot → raw docs. Adds a few fields the snapshot lacks (outlines, markerItem, targetNames, key groups). */
export function snapshotToRaw(snap: any) {
  const d = snap.data ?? snap;
  const en: Record<string, string> = {}, men: Record<string, string> = {}, ien: Record<string, string> = {}, ten: Record<string, string> = {};
  const key = (dict: Record<string, string>, text: string, prefix: string) => { const k = `${prefix}_${Object.keys(dict).length}`; dict[k] = text; return k; };
  const mapIds: Record<string, string> = {};
  const rawMaps: any = {};
  for (const m of d.maps) {
    const id = "map_" + m.normalizedName;
    mapIds[m.normalizedName] = id;
    rawMaps[id] = {
      id, normalizedName: m.normalizedName, name: key(men, m.normalizedName, "mapname"), nameId: m.normalizedName === "streets-of-tarkov" ? "TarkovStreets" : null,
      scenePath: m.normalizedName === "customs" ? "maps/customs_preset.bundle" : null,
      extracts: (m.extracts || []).map((e: any, i: number) => ({ name: key(men, e.name, "ext"), faction: e.faction, position: e.position, ...(i === 0 ? { outline: [{ x: e.position.x - 5, y: 0, z: e.position.z - 5 }, { x: e.position.x + 5, y: 0, z: e.position.z - 5 }, { x: e.position.x, y: 0, z: e.position.z + 5 }] } : {}) })),
      transits: (m.transits || []).map((t: any) => ({ description: key(men, t.description, "tr"), position: t.position })),
    };
  }
  const traders: any = {};
  const traderId = (n: string) => { const id = "trader_" + n.toLowerCase(); if (!traders[id]) traders[id] = { name: key(ten, n, "trname") }; return id; };
  const item = (it: any) => { ien[it.id + " Name"] = it.name; return it.id; };
  const questItems: any = {};
  const tasks: any = {};
  for (const t of d.tasks) {
    tasks[t.id] = {
      id: t.id, name: key(en, t.name, "taskname"), trader: traderId(t.trader.name), map: t.map ? mapIds[t.map.normalizedName] : null,
      wikiLink: t.wikiLink, minPlayerLevel: t.minPlayerLevel, kappaRequired: t.kappaRequired, lightkeeperRequired: t.lightkeeperRequired,
      neededKeys: (t.neededKeys || []).map((nk: any) => ({ map: mapIds[nk.map.normalizedName], keys: nk.keys.map(item) })),
      objectives: t.objectives.map((o: any) => {
        const r: any = {
          id: o.id, type: o.type, description: key(en, o.description, "obj"), optional: o.optional, count: o.count, foundInRaid: o.foundInRaid,
          maps: (o.maps || []).map((m: any) => mapIds[m.normalizedName]).filter(Boolean),
          zones: (o.zones || []).map((z: any) => ({ map: mapIds[z.map.normalizedName], position: z.position, outline: [{ x: z.position.x - 3, y: z.position.y, z: z.position.z - 3 }, { x: z.position.x + 3, y: z.position.y, z: z.position.z - 3 }, { x: z.position.x + 3, y: z.position.y, z: z.position.z + 3 }, { x: z.position.x - 3, y: z.position.y, z: z.position.z + 3 }], top: z.position.y + 2, bottom: z.position.y - 2 })),
          possibleLocations: (o.possibleLocations || []).map((p: any) => ({ map: mapIds[p.map.normalizedName], positions: p.positions })),
          items: (o.items || []).map(item),
          requiredKeys: (o.requiredKeys || []).map((k: any) => [item(k)]),
        };
        if (o.questItem) { questItems[o.questItem.id] = { name: key(en, o.questItem.name, "qi") }; r.questItem = o.questItem.id; }
        if (o.type === "mark") r.markerItem = "5991b51486f77447b112d44f";
        if (o.type === "shoot") {
          r.targetNames = /pmc/i.test(o.description) ? ["PMC"] : /scav/i.test(o.description) ? ["Scav"] : ["Any"];
          if (o.gear) { r.usingWeapon = o.gear.weapons.map(item); r.wearing = o.gear.wearing.map((g: any[]) => g.map(item)); r.usingWeaponMods = o.gear.mods.map((g: any[]) => g.map(item)); }
        }
        return r;
      }),
    };
  }
  ien["5991b51486f77447b112d44f Name"] = "MS2000 Marker";
  return {
    tasks: { data: { tasks, questItems } }, tasksEn: { data: en },
    maps: { data: { maps: rawMaps } }, mapsEn: { data: men },
    traders: { data: traders }, tradersEn: { data: ten }, itemsEn: { data: ien },
  };
}
