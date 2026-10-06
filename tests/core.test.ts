import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fromSnapshot, fromRaw } from "../server/convert.ts";
import { makeProj, floorBadge, arrowRotation } from "../web/js/logic/projection.js";
import { simplify } from "../web/js/logic/simplify.js";
import { makeMatcher } from "../web/js/logic/match.js";
import { partsOf, objAction, partDone, partProgress, clearPartsCache, isOneRaid } from "../web/js/logic/parts.js";
import { requirementsOf, objReady, bringList, reqKey, consumes } from "../web/js/logic/ready.js";
import { migrate, catForPart, freshState, ensureDefaults, forgetTask } from "../web/js/logic/state.js";
import { parseGpsName, yawFromQuaternion } from "../server/gpsname.ts";
import { ROOT, loadSnapshot, snapshotToRaw } from "./helpers.ts";

const snap = loadSnapshot();
const data = fromSnapshot(snap);
const byName = (n: string) => data.tasks.find((t) => t.name === n)!;
const cfgs = JSON.parse(readFileSync(join(ROOT, "assets", "maps-config.json"), "utf8"));

describe("projection", () => {
  const vec = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "projection-vectors.streets.json"), "utf8"));
  const cfg = cfgs.find((c: any) => c.key === "streets-of-tarkov");
  const P = makeProj(cfg, vec.viewBox);
  for (const v of vec.vectors) test(v.name, () => {
    const [x, y] = P.toSvg(v.game.x, v.game.z);
    expect(Math.hypot(x - v.svg_viewbox.x, y - v.svg_viewbox.y)).toBeLessThan(1.5);
    const [gx, gz] = P.toGame(x, y);
    expect(Math.abs(gx - v.game.x) + Math.abs(gz - v.game.z)).toBeLessThan(0.01);
  });
  test("floor badges", () => {
    expect(floorBadge(cfg, 47.63, 12.66, 153.12)).toBe("2"); // Ballet Lover apartment
    expect(floorBadge(cfg, 0, 1, 0)).toBe(null);
    expect(floorBadge(cfg, 0, -20, 0)).toBe("B");
  });
  test("arrow rotation matches tarkov.dev's correction", () => {
    expect(arrowRotation({ rotation: 180 }, 10)).toBe(190);
    expect(arrowRotation({ rotation: 90 }, 0)).toBe(270);
  });
});

test("stroke simplification keeps ends and drops collinear points", () => {
  const s = simplify([[0, 0], [1, 0.001], [2, 0], [3, 5]], 0.1);
  expect(s[0]).toEqual([0, 0]); expect(s[s.length - 1]).toEqual([3, 5]); expect(s.length).toBe(3);
});

describe("game data conversion", () => {
  test("snapshot has tasks, maps and items with ids", () => {
    expect(data.tasks.length).toBeGreaterThan(400);
    expect(data.maps.find((m) => m.key === "streets-of-tarkov")!.extracts.length).toBeGreaterThan(10);
    const ballet = byName("Ballet Lover");
    expect(ballet.objs[0].keys[0][0].name).toContain("skybridge");
    expect(ballet.objs[0].keys[0][0].id).toMatch(/^[0-9a-f]{24}$/);
  });
  test("raw json.tarkov.dev documents convert to the same tasks, plus outlines/markers/targets", () => {
    const raw = fromRaw(snapshotToRaw(snap), "pvp-season", "2026-10-01");
    expect(raw.tasks.length).toBe(data.tasks.length);
    const a = raw.tasks.find((t) => t.name === "A Fuel Matter")!;
    expect(a.trader).toBe("Ragman");
    expect(a.map).toBe("reserve");
    expect(a.objs[0].marker!.name).toBe("MS2000 Marker");
    expect(a.objs[0].zones[0].ol!.length).toBe(4);
    const setup = raw.tasks.find((t) => t.name === "Setup")!;
    expect(setup.objs[0].targets).toEqual(["PMC"]);
    expect(setup.objs[0].gear!.weapons.length).toBeGreaterThan(5);
    const streets = raw.maps.find((m) => m.key === "streets-of-tarkov")!;
    expect(streets.extracts[0].ol!.length).toBe(3);
    expect(streets.nameId).toBe("TarkovStreets");
    expect(raw.maps.find((m) => m.key === "customs")!.scene).toBe("maps/customs_preset.bundle");
    // names translated
    expect(raw.tasks.find((t) => t.id === byName("Paramedic").id)!.objs[0].d).toContain("smartphone");
  });
});

describe("parts", () => {
  test("kill targets", () => {
    expect(objAction({ type: "shoot", d: "Locate and neutralize Killa", targets: [] } as any)).toBe("boss");
    expect(objAction({ type: "shoot", d: "Eliminate PMC operatives at the Scav base on Customs", targets: [] } as any)).toBe("pmc");
    expect(objAction({ type: "shoot", d: "Eliminate Scavs", targets: [] } as any)).toBe("scav");
    expect(objAction({ type: "shoot", d: "Eliminate any target", targets: ["Any"] } as any)).toBe("scav");
    expect(objAction({ type: "shoot", d: "x", targets: ["AnyPmc"] } as any)).toBe("pmc");
  });
  test("single-kind tasks stay whole", () => {
    const p = partsOf(byName("Capturing Outposts"));
    expect(p.length).toBe(1); expect(p[0].action).toBe("pmc");
    expect(partsOf(byName("A Fuel Matter"))[0].action).toBe("mark");
    expect(partsOf(byName("Cease Fire!"))[0].action).toBe("go");
  });
  test("pick-up + extract + hand-over is one Retrieve part", () => {
    const p = partsOf(byName("Paramedic"));
    expect(p.length).toBe(1); expect(p[0].action).toBe("retrieve"); expect(p[0].objs.length).toBe(3);
  });
  test("'(In one raid)' tasks never split", () => {
    const t = byName("Secrets of Polikhim");
    expect(isOneRaid(t)).toBe(true);
    expect(partsOf(t).length).toBe(1);
  });
  test("mixed tasks split; Don't split merges by precedence", () => {
    const t = byName("Dandies"); // kills + stash items
    const p = partsOf(t);
    expect(p.map((x) => x.action).sort()).toEqual(["plant", "scav"]);
    expect(p.every((x) => x.split && x.total === 2)).toBe(true);
    const whole = partsOf(t, true);
    expect(whole.length).toBe(1); expect(whole[0].action).toBe("scav");
  });
  test("hand-in-only tasks are off-map", () => { expect(partsOf(byName("Booze"))[0].action).toBe("offmap"); });
  test("ticks and progress", () => {
    const p = partsOf(byName("A Fuel Matter"))[0];
    const ticks: any = { [p.objs[0].id]: true };
    expect(partDone(p, ticks)).toBe(false); expect(partProgress(p, ticks)).toBe(50);
    ticks[p.objs[1].id] = true;
    expect(partDone(p, ticks)).toBe(true);
  });
});

describe("readiness + bring list", () => {
  const fuel = byName("A Fuel Matter"), anes = byName("Anesthesia"), ballet = byName("Ballet Lover"), goodTimes = byName("The Good Times - Part 1"), setup = byName("Setup");
  const MK = "5991b51486f77447b112d44f";
  test("markers: possible with at least one", () => {
    const o = fuel.objs[0];
    expect(objReady(o, {})).toBe(false);
    expect(objReady(o, { [MK]: 1 })).toBe(true);
    expect(consumes(o)!.key).toBe(MK);
  });
  test("separate single 'wear' items are all needed; outfit lists are alternatives", () => {
    const gt = requirementsOf(goodTimes.objs[0]).filter((r) => r.kind === "gear");
    expect(gt.length).toBe(2);
    const su = requirementsOf(setup.objs[0]).filter((r) => r.kind === "gear");
    expect(su.map((r) => r.label)).toEqual(["Weapon (any one)", "Wear (any one outfit)"]);
  });
  test("bring list sums markers across tasks and drops ticked ones", () => {
    const entries = [...fuel.objs, ...anes.objs].map((o) => ({ task: o === fuel.objs[0] || o === fuel.objs[1] ? fuel : anes, o }));
    let b = bringList(entries, {}, {});
    expect(b.place.find((e) => e.key === MK)!.need).toBe(5);
    b = bringList(entries, { [fuel.objs[0].id]: true }, { [MK]: 2 });
    const m = b.place.find((e) => e.key === MK)!;
    expect(m.need).toBe(4); expect(m.have).toBe(2);
  });
  test("keys appear once", () => {
    const b = bringList(ballet.objs.map((o) => ({ task: ballet, o })), {}, {});
    expect(b.keys.length).toBe(1);
  });
  test("found-in-raid counts hand-ins once", () => {
    const booze = byName("Booze");
    const b = bringList([], {}, {}, [booze]);
    expect(b.fir.length).toBe(4);
    expect(b.fir.every((e) => e.need >= 1)).toBe(true);
  });
  test("reqKey is stable for alternatives", () => {
    expect(reqKey([{ id: "b", name: "" }, { id: "a", name: "" }])).toBe(reqKey([{ id: "a", name: "" }, { id: "b", name: "" }]));
  });
});

describe("saved data", () => {
  const v1 = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "v1-data.json"), "utf8"));
  test("v1 → v2 keeps the manual list as active and replaces the old default categories", () => {
    const s = migrate(v1);
    expect(s.version).toBe(2);
    expect(s.cats.map((c: any) => c.builtin)).toEqual(["boss", "pmc", "scav", "mark", "plant", "retrieve", "go", "unsorted"]);
    const active = Object.values(s.tasks).filter((e: any) => e.active).length;
    expect(active).toBe(Object.values(v1.tasks).filter((v: any) => v.manual === true || (v.manual === undefined && v.added)).length);
    expect(s.showScanBanner).toBe(true);
  });
  test("parts land in their default category unless moved", () => {
    const S = freshState();
    const t = byName("Dandies"), [a, b] = partsOf(t);
    expect(catForPart(S, t, a).builtin).toBe(a.action);
    S.tasks[t.id] = { partCats: { [b.key]: { cat: "unsorted", manual: true } } };
    expect(catForPart(S, t, b).id).toBe("unsorted");
    S.cats = S.cats.filter((c: any) => c.builtin !== a.action);
    expect(catForPart(S, t, a).builtin).toBe("unsorted");
    expect(ensureDefaults(S)).toBe(1);
    expect(catForPart(S, t, a).builtin).toBe(a.action);
  });
  test("a forgotten task leaves nothing behind; other tasks are untouched", () => {
    const S = freshState();
    const t = byName("Dandies"), u = byName("Booze");
    S.tasks[t.id] = { active: true, pinned: true, partCats: { "*": { cat: "unsorted", manual: true } } };
    S.tasks[u.id] = { active: true };
    S.ticks[t.objs[0].id] = true; S.ticks[u.objs[0].id] = true;
    S.used = { [t.objs[0].id]: 1 };
    S.subs = [{ id: "s1", task: t.id }, { id: "s2", task: u.id }];
    forgetTask(S, t.id, t);
    expect(S.tasks[t.id]).toBeUndefined();
    expect(S.ticks[t.objs[0].id]).toBeUndefined();
    expect(S.used[t.objs[0].id]).toBeUndefined();
    expect(S.subs.map((s: any) => s.id)).toEqual(["s2"]);
    expect(S.tasks[u.id].active).toBe(true);
    expect(S.ticks[u.objs[0].id]).toBe(true);
  });
});

describe("names", () => {
  const m = makeMatcher(data.tasks);
  test("exact, fuzzy, unknown", () => {
    expect(m.match("Ballet Lover")!.task.name).toBe("Ballet Lover");
    const f = m.match("Seizing the Initative");
    expect(f && f.task.name).toBe("Seizing the Initiative");
    expect(m.match("Totally Fake Task")).toBe(null);
  });
});

describe("GPS screenshot names", () => {
  test("parses position and heading", () => {
    const g = parseGpsName("2026-10-01[14-05]_-120.53, 3.10, 210.77_0.00000, 0.70711, 0.00000, 0.70711 (0).png")!;
    expect(g.x).toBeCloseTo(-120.53); expect(g.y).toBeCloseTo(3.1); expect(g.z).toBeCloseTo(210.77);
    expect(g.yaw).toBeCloseTo(90, 0);
  });
  test("ignores normal screenshots", () => {
    expect(parseGpsName("2026-10-01[14-05]_1 (0).png")).toBe(null);
    expect(parseGpsName("screenshot.png")).toBe(null);
  });
  test("yaw of identity is 0", () => { expect(yawFromQuaternion(0, 0, 0, 1)).toBeCloseTo(0); });
});
void clearPartsCache;
