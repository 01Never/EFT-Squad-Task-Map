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
