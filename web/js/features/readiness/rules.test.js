// Tests for the readiness rules (rules.js): requirements, what's possible, the bag and the Bring list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findTask } from "../../../../tests/support/game-data.js";
import { freshState } from "../../app/saved-data.js";
import {
  requirementsOf,
  isObjectivePossible,
  bringList,
  requirementKey,
  usedUpByTicking,
  updateBagForTick,
  isPartPossible,
  isOnKeyList,
  hasRequirement,
  countMissing,
} from "./rules.js";

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
  assert.equal(isObjectivePossible(markSpot, {}), false);
  assert.equal(isObjectivePossible(markSpot, { [MS2000_MARKER_ID]: 1 }), true);
  assert.equal(usedUpByTicking(markSpot).key, MS2000_MARKER_ID);
});

test("separate single items to wear are all needed, while outfit lists are alternatives", () => {
  const goodTimesGear = gearRequirementsOf(theGoodTimesPart1.objs[0]);
  assert.equal(goodTimesGear.length, 2);

  const setupGear = gearRequirementsOf(setup.objs[0]);
  const setupLabels = setupGear.map((requirement) => requirement.label);
  assert.deepEqual(setupLabels, ["Weapon (any one)", "Wear (any one outfit)"]);
});

test("ticking a marker spot takes a marker out of the bag, and unticking gives back only what it took", () => {
  const saved = freshState();
  const markSpot = aFuelMatter.objs[0];
  saved.have[MS2000_MARKER_ID] = 1;

  updateBagForTick(saved, markSpot, 1);
  assert.equal(saved.have[MS2000_MARKER_ID], 0);
  assert.equal(saved.used[markSpot.id], 1);

  updateBagForTick(saved, markSpot, -1);
  assert.equal(saved.have[MS2000_MARKER_ID], 1);
  assert.equal(saved.used[markSpot.id], undefined);

  const emptyBag = freshState();
  updateBagForTick(emptyBag, markSpot, 1);
  updateBagForTick(emptyBag, markSpot, -1);
  assert.equal(emptyBag.have[MS2000_MARKER_ID], undefined, "nothing was taken, so nothing comes back");
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
  assert.equal(requirementKey(itemBThenA), requirementKey(itemAThenB));
});

// ---------------------------------------------------------------- ticket 09: keys on your key list

const pharmacist = findTask("Pharmacist"); // its find objective needs the Dorm room 114 key
const DORM_114_KEY = "59387a4986f77401cc236e62";

test("a key on the map's key list makes its objective ready without any bag count", () => {
  const needsKey = pharmacist.objs.find((objective) => objective.keys.length);
  assert.equal(isObjectivePossible(needsKey, {}), false, "no key, no list: not ready");
  assert.equal(isObjectivePossible(needsKey, {}, new Set([DORM_114_KEY])), true);
  assert.equal(isObjectivePossible(needsKey, {}, new Set(["5780cf7f2459777de4559322"])), false, "another key doesn't do");
});

test("a key on the list keeps the part ready after a raid end empties the bag", () => {
  const part = { key: pharmacist.id + ":*", action: "retrieve", objs: pharmacist.objs, split: false, index: 0, total: 1 };
  const keyList = new Set([DORM_114_KEY]);
  const saved = freshState();
  saved.have = { [DORM_114_KEY]: 1 };
  assert.equal(isPartPossible(part, {}, saved.have), true);
  saved.have = {}; // what raid end does
  assert.equal(isPartPossible(part, {}, saved.have), false, "without the list the bag count was all it had");
  assert.equal(isPartPossible(part, {}, saved.have, keyList), true, "with the list it stays ready");
});

test("any key of a set of alternatives on the list counts; only keys come from the list", () => {
  const requirement = { kind: "key", key: "any:x", items: [{ id: "a", name: "A" }, { id: "b", name: "B" }], need: 1, label: "Key (any one)" };
  assert.equal(isOnKeyList(requirement, new Set(["b"])), true);
  assert.equal(hasRequirement(requirement, {}, new Set(["b"])), true);
  assert.equal(hasRequirement(requirement, {}, new Set(["c"])), false);
  const marker = { kind: "place", key: MS2000_MARKER_ID, items: [{ id: MS2000_MARKER_ID, name: "MS2000" }], need: 1, label: "Marker" };
  assert.equal(isOnKeyList(marker, new Set([MS2000_MARKER_ID])), false);
});

test("the Bring list says a listed key is on your key list, and it isn't missing", () => {
  const entries = entriesFor(pharmacist);
  const withoutList = bringList(entries, {}, {});
  const keyLine = withoutList.keys.find((line) => line.key === DORM_114_KEY);
  assert.equal(keyLine.onKeyList, false);
  const missingWithout = countMissing(withoutList);
  const withList = bringList(entries, {}, {}, [], new Set([DORM_114_KEY]));
  const listedLine = withList.keys.find((line) => line.key === DORM_114_KEY);
  assert.equal(listedLine.onKeyList, true);
  assert.equal(listedLine.have, 0, "the bag count is untouched");
  assert.equal(countMissing(withList), missingWithout - 1);
});
