// Tests for the saved data's shape and migration (saved-data.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readRepoJson } from "../../../tests/support/game-data.js";
import { migrateSavedData, freshState } from "./saved-data.js";

const v1Data = readRepoJson("tests/fixtures/v1-data.json");

test("v1 → v2 keeps the manual list as active and replaces the old default categories", () => {
  const saved = migrateSavedData(v1Data);
  assert.equal(saved.version, 2);

  const builtinCategories = saved.cats.map((category) => category.builtin);
  const expectedBuiltins = ["boss", "pmc", "scav", "mark", "plant", "retrieve", "go", "unsorted"];
  assert.deepEqual(builtinCategories, expectedBuiltins);

  const activeCount = Object.values(saved.tasks).filter((entry) => entry.active).length;
  const v1ManualCount = Object.values(v1Data.tasks).filter(
    (entry) => entry.manual === true || (entry.manual === undefined && entry.added),
  ).length;
  assert.equal(activeCount, v1ManualCount);

  assert.equal(saved.showScanBanner, true);
});

test("nothing saved yet gives fresh saved data", () => {
  assert.deepEqual(migrateSavedData(null), freshState());
});

test("a v2 file with missing fields gets their defaults and an Unsorted category", () => {
  const partial = { version: 2, cats: [], tasks: { t1: { active: true } }, prefs: { customs: {} } };
  const saved = migrateSavedData(partial);
  assert.equal(saved.dwidth, 4);
  assert.deepEqual(saved.cats.map((category) => category.id), ["unsorted"]);
  assert.equal(saved.tasks.t1.active, true);
  assert.deepEqual(saved.tasks.t1.partCats, {});
  assert.deepEqual(saved.prefs.customs.extMarked, {});
  assert.equal(saved.prefs.customs.ext.pmc, true);
});

test("extract marks saved before ticket 06 (true) survive loading, next to auto marks", () => {
  const saved = migrateSavedData({
    version: 2,
    cats: [],
    tasks: {},
    prefs: { customs: { extMarked: { Crossroads: true, "Old Gas Station Gate": { auto: true, note: "Requires paracord" } } } },
  });
  assert.deepEqual(saved.prefs.customs.extMarked, {
    Crossroads: true,
    "Old Gas Station Gate": { auto: true, note: "Requires paracord" },
  });
});

test("a file from before ticket 08 loads without loot choices: no loot shown, nothing added", () => {
  const before = { version: 2, cats: [], tasks: {}, prefs: { customs: { ext: { pmc: true }, extMarked: {} } } };
  const saved = migrateSavedData(before);
  assert.equal("loot" in saved.prefs.customs, false);
});

test("saved loot choices load as they are, and a damaged one keeps only the chips that are on", () => {
  const prefs = {
    customs: { loot: { safe: true, loose: true } },
    woods: { loot: { jacket: "on", drawer: true } },
    shoreline: { loot: null },
  };
  const saved = migrateSavedData({ version: 2, cats: [], tasks: {}, prefs });
  assert.deepEqual(saved.prefs.customs.loot, { safe: true, loose: true });
  assert.deepEqual(saved.prefs.woods.loot, { drawer: true });
  assert.deepEqual(saved.prefs.shoreline.loot, {});
});
