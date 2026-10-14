// Tests for the saved data's shape and migration (saved-data.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readRepoJson } from "../../../tests/support/game-data.js";
import { migrateSavedData, freshState, emptyTaskList, taskListOf } from "./saved-data.js";
import { GAME_MODES, knownGameMode } from "./game-modes.js";

const v1Data = readRepoJson("tests/fixtures/v1-data.json");

/** A small v2 file: one task list at the top level, for every game mode. */
function v2File() {
  return {
    version: 2,
    cats: [{ id: "unsorted", name: "Unsorted", color: "#c7c5b3", icon: "hexagon", visible: true, builtin: "unsorted" }],
    tasks: { t1: { active: true, pinned: true, partCats: { "t1:go": { cat: "unsorted", manual: true } } } },
    ticks: { o1: true, o2: 3 },
    used: { o1: 1 },
    have: { marker: 2 },
    subs: [{ id: "s1", task: "t1", text: "bring a key" }],
    draw: { customs: [{ c: "#ff4d4d", w: 4, pts: [[0, 0]] }] },
    prefs: {},
    collapsed: { unsorted: true },
    pinnedOnly: true,
    dwidth: 6,
    squad: { friends: { mike: { drawings: true, tasks: true } } },
  };
}

test("v1 → v3 keeps the manual list as active and replaces the old default categories", () => {
  const saved = migrateSavedData(v1Data);
  assert.equal(saved.version, 3);

  const builtinCategories = saved.cats.map((category) => category.builtin);
  const expectedBuiltins = ["boss", "pmc", "scav", "mark", "plant", "retrieve", "go", "unsorted"];
  assert.deepEqual(builtinCategories, expectedBuiltins);

  const activeCount = Object.values(saved.modes.regular.tasks).filter((entry) => entry.active).length;
  const v1ManualCount = Object.values(v1Data.tasks).filter(
    (entry) => entry.manual === true || (entry.manual === undefined && entry.added),
  ).length;
  assert.equal(activeCount, v1ManualCount);

  assert.equal(saved.showScanBanner, true);
  assert.equal(saved.migratedFrom, 1);
});

test("v1 → v3 puts the v1 list in the game mode in Settings, like a v2 file", () => {
  const saved = migrateSavedData(v1Data, "pve");
  assert.ok(Object.keys(saved.modes.pve.tasks).length > 0);
  assert.deepEqual(saved.modes.regular, emptyTaskList());
  assert.deepEqual(saved.modes["pvp-season"], emptyTaskList());
});

test("nothing saved yet gives fresh saved data, with an empty list for every game mode", () => {
  const saved = migrateSavedData(null);
  assert.deepEqual(saved, freshState());
  assert.deepEqual(Object.keys(saved.modes), ["regular", "pve", "pvp-season"]);
  for (const mode of GAME_MODES) {
    assert.deepEqual(saved.modes[mode], { tasks: {}, ticks: {}, used: {}, have: {}, subs: [] });
  }
});

test("v2 → v3 puts the one list in the game mode in Settings; the other modes start empty", () => {
  const old = v2File();
  const saved = migrateSavedData(old, "pvp-season");

  assert.equal(saved.version, 3);
  assert.deepEqual(saved.modes["pvp-season"].ticks, { o1: true, o2: 3 });
  assert.deepEqual(saved.modes["pvp-season"].used, { o1: 1 });
  assert.deepEqual(saved.modes["pvp-season"].have, { marker: 2 });
  assert.deepEqual(saved.modes["pvp-season"].subs, [{ id: "s1", task: "t1", text: "bring a key" }]);
  const entry = saved.modes["pvp-season"].tasks.t1;
  assert.equal(entry.active, true);
  assert.equal(entry.pinned, true);
  assert.deepEqual(entry.partCats, { "t1:go": { cat: "unsorted", manual: true } });
  assert.deepEqual(saved.modes.regular, emptyTaskList());
  assert.deepEqual(saved.modes.pve, emptyTaskList());
});

test("v2 → v3 keeps everything shared at the top level, and no list fields stay there", () => {
  const saved = migrateSavedData(v2File(), "pve");
  assert.equal(saved.cats.length, 1);
  assert.equal(saved.draw.customs.length, 1);
  assert.deepEqual(saved.collapsed, { unsorted: true });
  assert.equal(saved.pinnedOnly, true);
  assert.equal(saved.dwidth, 6);
  assert.deepEqual(saved.squad, { friends: { mike: { drawings: true, tasks: true } } });
  for (const field of ["tasks", "ticks", "used", "have", "subs"]) {
    assert.equal(field in saved, false, `${field} lives in modes now`);
  }
  assert.deepEqual(Object.keys(saved).slice(0, 3), ["version", "cats", "modes"]);
});

test("v2 → v3 with no game mode known (or an unknown one) puts the list in PvP", () => {
  assert.equal(migrateSavedData(v2File()).modes.regular.have.marker, 2);
  assert.equal(migrateSavedData(v2File(), "arena").modes.regular.have.marker, 2);
  assert.equal("arena" in migrateSavedData(v2File(), "arena").modes, false);
});

test("a v3 file loads unchanged, whatever the game mode in Settings", () => {
  const v3 = migrateSavedData(v2File(), "pve");
  const text = JSON.stringify(v3);
  const loaded = migrateSavedData(JSON.parse(text), "regular");
  assert.equal(JSON.stringify(loaded), text);
});

test("a v3 file missing a mode's list, or fields of one, gets them empty", () => {
  const partial = { version: 3, cats: [], modes: { pve: { tasks: { t1: { active: true } } } }, prefs: {} };
  const saved = migrateSavedData(partial);
  assert.deepEqual(saved.modes.regular, emptyTaskList());
  assert.deepEqual(saved.modes["pvp-season"], emptyTaskList());
  assert.deepEqual(saved.modes.pve.ticks, {});
  assert.deepEqual(saved.modes.pve.subs, []);
  assert.equal(saved.modes.pve.tasks.t1.active, true);
  assert.deepEqual(saved.modes.pve.tasks.t1.partCats, {});
});

test("each game mode's list is its own: changing one leaves the others as they were", () => {
  const saved = migrateSavedData(v2File(), "pvp-season");
  const pve = taskListOf(saved, "pve");
  pve.ticks.o9 = true;
  pve.have.marker = 5;
  assert.deepEqual(saved.modes["pvp-season"].ticks, { o1: true, o2: 3 });
  assert.equal(saved.modes["pvp-season"].have.marker, 2);
  assert.equal(taskListOf(saved, "pve").have.marker, 5, "the same list comes back");
});

test("a game mode the page doesn't know (or none) means PvP; an event's missing mode means Settings'", () => {
  assert.equal(knownGameMode("pve"), "pve");
  assert.equal(knownGameMode(undefined), "regular");
  assert.equal(knownGameMode(""), "regular");
  assert.equal(knownGameMode("arena"), "regular");
  assert.equal(knownGameMode(undefined, "pvp-season"), "pvp-season");
  assert.equal(knownGameMode("pve", "pvp-season"), "pve");
});

test("a v2 file with missing fields gets their defaults and an Unsorted category", () => {
  const partial = { version: 2, cats: [], tasks: { t1: { active: true } }, prefs: { customs: {} } };
  const saved = migrateSavedData(partial);
  assert.equal(saved.dwidth, 4);
  assert.deepEqual(saved.cats.map((category) => category.id), ["unsorted"]);
  assert.equal(saved.modes.regular.tasks.t1.active, true);
  assert.deepEqual(saved.modes.regular.tasks.t1.partCats, {});
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
