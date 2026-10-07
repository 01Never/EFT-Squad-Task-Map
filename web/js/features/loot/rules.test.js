// Tests for the loot rules (rules.js), on made-up spots and on the real loot of Customs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  LOOSE_CHIP,
  lootChoicesOf,
  cleanLootChoices,
  toggleLootChip,
  lootChipsForMap,
  highValueChoices,
  isHighValueOn,
  lootSpotsShown,
  lootSpotName,
  summarizeSpots,
  spotsNearView,
  groupNearbySpots,
  lootGlyph,
} from "./rules.js";

/** A small map: 2 safes, a jacket, a toolbox, a cash register, and 2 loose spots. */
const smallMap = {
  map: "test",
  available: true,
  containers: [
    { t: "safe", x: 0, y: 0, z: 0 },
    { t: "toolbox", x: 1, y: 0, z: 1 },
    { t: "safe", x: 10, y: 5, z: 10 },
    { t: "jacket", x: 20, y: 0, z: 20 },
    { t: "cash-register", x: 30, y: 0, z: 30 },
  ],
  loose: [
    { i: ["key-1"], x: 5, y: 0, z: 5 },
    { i: ["ledx", "gpu"], x: 6, y: 0, z: 6 },
  ],
  locks: [],
  lootTypes: { safe: "Safe", toolbox: "Toolbox", jacket: "Jacket", "cash-register": "Cash register" },
  items: { "key-1": "Dorm room 114 key", ledx: "LEDX Skin Transilluminator", gpu: "Graphics card" },
};

/** The real loot of the 2026-10-05 json.tarkov.dev files, as the Go converter makes it. */
function realLoot() {
  const gzipped = readFileSync(new URL("../../../../testdata/golden/loot-real.json.gz", import.meta.url));
  return JSON.parse(gunzipSync(gzipped).toString("utf8"));
}

/** A map's /api/loot answer built from the real data (what loot.go AnswerForMap sends). */
function realMapLoot(mapKey) {
  const all = realLoot();
  return { map: mapKey, available: true, ...all.maps[mapKey], lootTypes: all.types, items: all.itemNames };
}

// ---------------------------------------------------------------- saved choices

test("a map with no saved loot choices shows no loot", () => {
  assert.deepEqual(lootChoicesOf(undefined), {});
  assert.deepEqual(lootChoicesOf({}), {});
  assert.deepEqual(lootChoicesOf({ ext: { pmc: true } }), {});
});

test("saved choices keep only chips that are on", () => {
  const saved = { safe: true, jacket: false, loose: "yes", drawer: true };
  assert.deepEqual(cleanLootChoices(saved), { safe: true, drawer: true });
  assert.deepEqual(cleanLootChoices(["safe"]), {});
  assert.deepEqual(cleanLootChoices("safe"), {});
});

test("toggling a chip turns it on, and again turns it off, without changing the old choices", () => {
  const before = { safe: true };
  const withJacket = toggleLootChip(before, "jacket");
  assert.deepEqual(withJacket, { safe: true, jacket: true });
  assert.deepEqual(toggleLootChip(withJacket, "safe"), { jacket: true });
  assert.deepEqual(before, { safe: true });
});

// ---------------------------------------------------------------- chips and the preset

test("chips: high-value types first, then the rest by name, then loose loot, each with its count", () => {
  const chips = lootChipsForMap(smallMap);
  assert.deepEqual(
    chips.map((chip) => `${chip.label} ${chip.count}`),
    ["Safe 2", "Jacket 1", "Cash register 1", "Toolbox 1", "Loose loot 2"],
  );
});

test("High value turns on exactly the preset's chips this map has", () => {
  const chips = lootChipsForMap(smallMap);
  assert.deepEqual(highValueChoices(chips), { safe: true, jacket: true, loose: true });
});

test("the High value button shows pressed only for exactly its set", () => {
  const chips = lootChipsForMap(smallMap);
  assert.equal(isHighValueOn({ safe: true, jacket: true, loose: true }, chips), true);
  assert.equal(isHighValueOn({ safe: true, jacket: true }, chips), false);
  assert.equal(isHighValueOn({ safe: true, jacket: true, loose: true, toolbox: true }, chips), false);
  assert.equal(isHighValueOn({}, lootChipsForMap({ ...smallMap, containers: [], loose: [] })), false);
});

test("on real Customs, High value means safes, weapon boxes, PC blocks, tech crates, medcases, jackets, drawers and loose loot", () => {
  const customs = realMapLoot("customs");
  const chips = lootChipsForMap(customs);
  const preset = Object.keys(highValueChoices(chips));
  assert.deepEqual(preset, ["safe", "weapon-box", "pc-block", "technical-supply-crate", "medcase", "jacket", "drawer", "loose"]);
  const countOf = (id) => chips.find((chip) => chip.id === id)?.count;
  // The counts the server's converter test checks against the source file, seen from the page.
  assert.equal(countOf("safe"), 8);
  assert.equal(countOf("pc-block"), 14);
  assert.equal(countOf(LOOSE_CHIP), 306);
  const total = chips.reduce((sum, chip) => sum + chip.count, 0);
  assert.equal(total, 551 + 306);
});

// ---------------------------------------------------------------- spots

test("only the spots of chips that are on are shown", () => {
  const spots = lootSpotsShown(smallMap, { safe: true, loose: true });
  assert.deepEqual(spots.map((spot) => spot.chip), ["safe", "safe", "loose", "loose"]);
  assert.deepEqual(spots[3].items, ["ledx", "gpu"]);
  assert.deepEqual(lootSpotsShown(smallMap, {}), []);
});

test("a spot is named after its container, its one loose item, or as loose loot", () => {
  const [safe, keySpot, mixedSpot] = lootSpotsShown(smallMap, { safe: true, loose: true }).filter((_, index) => index !== 1);
  assert.equal(lootSpotName(smallMap, safe), "Safe");
  assert.equal(lootSpotName(smallMap, keySpot), "Dorm room 114 key");
  assert.equal(lootSpotName(smallMap, mixedSpot), "Loose loot");
});

test("a bubble lists what it holds, the most common first", () => {
  const spots = lootSpotsShown(smallMap, { safe: true, jacket: true });
  assert.deepEqual(summarizeSpots(smallMap, spots), [
    { name: "Safe", count: 2 },
    { name: "Jacket", count: 1 },
  ]);
});

test("every type has a sign: its own, or its first letter", () => {
  assert.equal(lootGlyph("safe"), "$");
  assert.equal(lootGlyph("pc-block"), "PC");
  assert.equal(lootGlyph("wooden-crate"), "W");
  assert.equal(lootGlyph(LOOSE_CHIP), "L");
});

// ---------------------------------------------------------------- what gets drawn

test("spots near the view are kept, with a quarter view of margin on each side", () => {
  const view = { x: 0, y: 0, w: 100, h: 40 };
  const spots = [
    { name: "inside", svgX: 50, svgY: 20 },
    { name: "in the margin", svgX: 124, svgY: -9 },
    { name: "too far right", svgX: 126, svgY: 20 },
    { name: "too far up", svgX: 50, svgY: -11 },
  ];
  assert.deepEqual(spotsNearView(spots, view).map((spot) => spot.name), ["inside", "in the margin"]);
});

test("spots in the same grid square become one bubble at their middle", () => {
  const spots = [
    { svgX: 1, svgY: 1 },
    { svgX: 9, svgY: 3 },
    { svgX: 25, svgY: 1 },
  ];
  const groups = groupNearbySpots(spots, 10);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].spots.length, 2);
  assert.equal(groups[0].svgX, 5);
  assert.equal(groups[0].svgY, 2);
  assert.equal(groups[1].spots.length, 1);
});

test("zooming in (smaller squares) splits a bubble", () => {
  const spots = [
    { svgX: 1, svgY: 1 },
    { svgX: 9, svgY: 3 },
  ];
  assert.equal(groupNearbySpots(spots, 10).length, 1);
  assert.equal(groupNearbySpots(spots, 4).length, 2);
});

test("on real Streets with every chip on, a whole-map view draws far fewer markers than spots", () => {
  const streets = realMapLoot("streets-of-tarkov");
  const everything = {};
  for (const chip of lootChipsForMap(streets)) everything[chip.id] = true;
  const spots = lootSpotsShown(streets, everything);
  assert.equal(spots.length, 1282 + 942);
  // Game metres stand in for SVG units here; 30 px squares on a 1200 px wide view of ~600 m.
  const placed = spots.map((spot) => ({ svgX: spot.x, svgY: spot.z }));
  const groups = groupNearbySpots(placed, 15);
  assert.ok(groups.length < spots.length / 3, `${groups.length} markers for ${spots.length} spots`);
});
