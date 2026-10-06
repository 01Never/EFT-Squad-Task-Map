// Tests for the page's DOM-free logic in web/js/logic/: projection, parts, readiness,
// saved data and task names. Runs with `node --test` and no packages.
// Game-data conversion and GPS screenshot names are server code and are tested in Go.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { makeProj, floorBadge, arrowRotation } from "../web/js/logic/projection.js";
import { simplify } from "../web/js/logic/simplify.js";
import { makeMatcher } from "../web/js/logic/match.js";
import { partsOf, objAction, partDone, partProgress, isOneRaid } from "../web/js/logic/parts.js";
import { requirementsOf, objReady, bringList, reqKey, consumes } from "../web/js/logic/ready.js";
import {
  migrate,
  catForPart,
  freshState,
  ensureDefaults,
  forgetTask,
} from "../web/js/logic/state.js";

/** Reads a JSON file given relative to this test file. */
function readJson(relativePath) {
  const text = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  return JSON.parse(text);
}

/**
 * The bundled game-data snapshot, already converted to the page's "stm-v2" format.
 * The golden file is exactly what the converter produces from assets/game-data.json,
 * so these tests don't depend on the (Go) converter.
 */
function loadConvertedGameData() {
  const goldenFile = new URL("../testdata/golden/data-snapshot.json.gz", import.meta.url);
  const gzipped = readFileSync(goldenFile);
  return JSON.parse(gunzipSync(gzipped).toString("utf8"));
}

const gameData = loadConvertedGameData();
const mapConfigs = readJson("../assets/maps-config.json");

/** Finds a task by its exact English name (every name used here is unique in the data). */
function findTask(name) {
  const task = gameData.tasks.find((candidate) => candidate.name === name);
  assert.ok(task, `task "${name}" should exist in the game data`);
  return task;
}

describe("projection", () => {
  const vectors = readJson("./fixtures/projection-vectors.streets.json");
  const streetsConfig = mapConfigs.find((config) => config.key === "streets-of-tarkov");
  const projection = makeProj(streetsConfig, vectors.viewBox);

  // The vectors were measured on tarkov.dev's own Streets map; the projection must land on them.
  for (const vector of vectors.vectors) {
    test(`${vector.name} projects to within 1.5 SVG units of tarkov.dev and back`, () => {
      const [svgX, svgY] = projection.toSvg(vector.game.x, vector.game.z);
      const svgDistance = Math.hypot(svgX - vector.svg_viewbox.x, svgY - vector.svg_viewbox.y);
      assert.ok(svgDistance < 1.5, `expected less than 1.5 SVG units off, got ${svgDistance}`);

      const [gameX, gameZ] = projection.toGame(svgX, svgY);
      const roundTripError = Math.abs(gameX - vector.game.x) + Math.abs(gameZ - vector.game.z);
      assert.ok(roundTripError < 0.01, `expected round trip within 0.01 m, got ${roundTripError}`);
    });
  }

  test("upstairs gets its floor number, ground level gets no badge, underground gets B", () => {
    // Ballet Lover apartment
    assert.equal(floorBadge(streetsConfig, 47.63, 12.66, 153.12), "2");
    assert.equal(floorBadge(streetsConfig, 0, 1, 0), null);
    assert.equal(floorBadge(streetsConfig, 0, -20, 0), "B");
  });

  test("arrow rotation matches tarkov.dev's correction", () => {
    assert.equal(arrowRotation({ rotation: 180 }, 10), 190);
    assert.equal(arrowRotation({ rotation: 90 }, 0), 270);
  });
});

test("stroke simplification keeps both ends and drops collinear points", () => {
  const simplified = simplify([[0, 0], [1, 0.001], [2, 0], [3, 5]], 0.1);
  assert.deepEqual(simplified[0], [0, 0]);
  assert.deepEqual(simplified[simplified.length - 1], [3, 5]);
  assert.equal(simplified.length, 3);
});

describe("parts", () => {
  test("kills are sorted into boss, PMC and scav by their targets and wording", () => {
    const killa = { type: "shoot", d: "Locate and neutralize Killa", targets: [] };
    const pmcsAtScavBase = {
      type: "shoot",
      d: "Eliminate PMC operatives at the Scav base on Customs",
      targets: [],
    };
    const scavs = { type: "shoot", d: "Eliminate Scavs", targets: [] };
    const anyTarget = { type: "shoot", d: "Eliminate any target", targets: ["Any"] };
    const anyPmcTarget = { type: "shoot", d: "x", targets: ["AnyPmc"] };

    assert.equal(objAction(killa), "boss");
    assert.equal(objAction(pmcsAtScavBase), "pmc");
    assert.equal(objAction(scavs), "scav");
    assert.equal(objAction(anyTarget), "scav");
    assert.equal(objAction(anyPmcTarget), "pmc");
  });

  test("a task whose objectives are all one kind stays one part", () => {
    const capturingOutposts = partsOf(findTask("Capturing Outposts"));
    assert.equal(capturingOutposts.length, 1);
    assert.equal(capturingOutposts[0].action, "pmc");

    assert.equal(partsOf(findTask("A Fuel Matter"))[0].action, "mark");
    assert.equal(partsOf(findTask("Cease Fire!"))[0].action, "go");
  });

  test("pick up, extract and hand over make one Retrieve part", () => {
    const paramedic = partsOf(findTask("Paramedic"));
    assert.equal(paramedic.length, 1);
    assert.equal(paramedic[0].action, "retrieve");
    assert.equal(paramedic[0].objs.length, 3);
  });

  test("a task that says '(In one raid)' never splits", () => {
    const secretsOfPolikhim = findTask("Secrets of Polikhim");
    assert.equal(isOneRaid(secretsOfPolikhim), true);
    assert.equal(partsOf(secretsOfPolikhim).length, 1);
  });

  test("a mixed task splits by kind, and Don't split merges it under the hardest kind", () => {
    const dandies = findTask("Dandies"); // kills + stash items

    const parts = partsOf(dandies);
    const actions = parts.map((part) => part.action).sort();
    assert.deepEqual(actions, ["plant", "scav"]);
    assert.equal(parts.every((part) => part.split && part.total === 2), true);

    const whole = partsOf(dandies, true);
    assert.equal(whole.length, 1);
    assert.equal(whole[0].action, "scav");
  });

  test("a task that is only hand-ins is off-map", () => {
    assert.equal(partsOf(findTask("Booze"))[0].action, "offmap");
  });

  test("a part is half done with one of two objectives ticked and done with both", () => {
    const part = partsOf(findTask("A Fuel Matter"))[0];
    const ticks = { [part.objs[0].id]: true };
    assert.equal(partDone(part, ticks), false);
    assert.equal(partProgress(part, ticks), 50);

    ticks[part.objs[1].id] = true;
    assert.equal(partDone(part, ticks), true);
  });
});

describe("readiness and the bring list", () => {
  const aFuelMatter = findTask("A Fuel Matter");
  const anesthesia = findTask("Anesthesia");
  const balletLover = findTask("Ballet Lover");
  const theGoodTimesPart1 = findTask("The Good Times - Part 1");
  const setup = findTask("Setup");
  const MS2000_MARKER_ID = "5991b51486f77447b112d44f";

  /** Bring-list entries for every objective of a task. */
  function entriesFor(task) {
    return task.objs.map((objective) => ({ task, o: objective }));
  }

  /** Only the gear requirements of an objective. */
  function gearRequirementsOf(objective) {
    return requirementsOf(objective).filter((requirement) => requirement.kind === "gear");
  }

  test("a marker spot is possible once you carry at least one marker", () => {
    const markSpot = aFuelMatter.objs[0];
    assert.equal(objReady(markSpot, {}), false);
    assert.equal(objReady(markSpot, { [MS2000_MARKER_ID]: 1 }), true);
    assert.equal(consumes(markSpot).key, MS2000_MARKER_ID);
  });

  test("separate single items to wear are all needed, while outfit lists are alternatives", () => {
    const goodTimesGear = gearRequirementsOf(theGoodTimesPart1.objs[0]);
    assert.equal(goodTimesGear.length, 2);

    const setupGear = gearRequirementsOf(setup.objs[0]);
    const setupLabels = setupGear.map((requirement) => requirement.label);
    assert.deepEqual(setupLabels, ["Weapon (any one)", "Wear (any one outfit)"]);
  });

  test("the bring list adds up markers across tasks and leaves out ticked spots", () => {
    // A Fuel Matter has 2 marker spots and Anesthesia has 3.
    const entries = [...entriesFor(aFuelMatter), ...entriesFor(anesthesia)];

    const nothingTicked = bringList(entries, {}, {});
    const markersForAll = nothingTicked.place.find((entry) => entry.key === MS2000_MARKER_ID);
    assert.equal(markersForAll.need, 5);

    const ticks = { [aFuelMatter.objs[0].id]: true };
    const bag = { [MS2000_MARKER_ID]: 2 };
    const oneTickedTwoCarried = bringList(entries, ticks, bag);
    const markersLeft = oneTickedTwoCarried.place.find((entry) => entry.key === MS2000_MARKER_ID);
    assert.equal(markersLeft.need, 4);
    assert.equal(markersLeft.have, 2);
  });

  test("a task's key shows up once in the bring list", () => {
    const bring = bringList(entriesFor(balletLover), {}, {});
    assert.equal(bring.keys.length, 1);
  });

  test("found-in-raid items for hand-ins are counted once", () => {
    const booze = findTask("Booze");
    const bring = bringList([], {}, {}, [booze]);
    assert.equal(bring.fir.length, 4);
    assert.equal(bring.fir.every((entry) => entry.need >= 1), true);
  });

  test("the key for a set of alternatives doesn't depend on their order", () => {
    const itemBThenA = [{ id: "b", name: "" }, { id: "a", name: "" }];
    const itemAThenB = [{ id: "a", name: "" }, { id: "b", name: "" }];
    assert.equal(reqKey(itemBThenA), reqKey(itemAThenB));
  });
});

describe("saved data", () => {
  const v1Data = readJson("./fixtures/v1-data.json");

  test("v1 → v2 keeps the manual list as active and replaces the old default categories", () => {
    const state = migrate(v1Data);
    assert.equal(state.version, 2);

    const builtinCategories = state.cats.map((category) => category.builtin);
    const expectedBuiltins = ["boss", "pmc", "scav", "mark", "plant", "retrieve", "go", "unsorted"];
    assert.deepEqual(builtinCategories, expectedBuiltins);

    const activeCount = Object.values(state.tasks).filter((entry) => entry.active).length;
    const v1ManualCount = Object.values(v1Data.tasks).filter(
      (entry) => entry.manual === true || (entry.manual === undefined && entry.added),
    ).length;
    assert.equal(activeCount, v1ManualCount);

    assert.equal(state.showScanBanner, true);
  });

  test("a part lands in its default category unless you moved it", () => {
    const state = freshState();
    const dandies = findTask("Dandies");
    const [firstPart, secondPart] = partsOf(dandies);
    assert.equal(catForPart(state, dandies, firstPart).builtin, firstPart.action);

    // Moved by hand to Unsorted.
    const movedToUnsorted = { cat: "unsorted", manual: true };
    state.tasks[dandies.id] = { partCats: { [secondPart.key]: movedToUnsorted } };
    assert.equal(catForPart(state, dandies, secondPart).id, "unsorted");

    // Its default category deleted: falls back to Unsorted until the defaults are restored.
    state.cats = state.cats.filter((category) => category.builtin !== firstPart.action);
    assert.equal(catForPart(state, dandies, firstPart).builtin, "unsorted");
    assert.equal(ensureDefaults(state), 1);
    assert.equal(catForPart(state, dandies, firstPart).builtin, firstPart.action);
  });

  test("a forgotten task leaves nothing behind; other tasks are untouched", () => {
    const state = freshState();
    const dandies = findTask("Dandies");
    const booze = findTask("Booze");
    const wholeTaskInUnsorted = { "*": { cat: "unsorted", manual: true } };
    state.tasks[dandies.id] = { active: true, pinned: true, partCats: wholeTaskInUnsorted };
    state.tasks[booze.id] = { active: true };
    state.ticks[dandies.objs[0].id] = true;
    state.ticks[booze.objs[0].id] = true;
    state.used = { [dandies.objs[0].id]: 1 };
    state.subs = [{ id: "s1", task: dandies.id }, { id: "s2", task: booze.id }];

    forgetTask(state, dandies.id, dandies);

    assert.equal(state.tasks[dandies.id], undefined);
    assert.equal(state.ticks[dandies.objs[0].id], undefined);
    assert.equal(state.used[dandies.objs[0].id], undefined);
    assert.deepEqual(state.subs.map((subTask) => subTask.id), ["s2"]);
    assert.equal(state.tasks[booze.id].active, true);
    assert.equal(state.ticks[booze.objs[0].id], true);
  });
});

describe("names", () => {
  const matcher = makeMatcher(gameData.tasks);

  test("exact and misspelt names find their task; unknown names find nothing", () => {
    assert.equal(matcher.match("Ballet Lover").task.name, "Ballet Lover");

    const misspelt = matcher.match("Seizing the Initative");
    assert.equal(misspelt && misspelt.task.name, "Seizing the Initiative");

    assert.equal(matcher.match("Totally Fake Task"), null);
  });
});
