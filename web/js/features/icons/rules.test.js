// Tests for item icons on markers (rules.js): which objectives get an icon, and the picture's address.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findTask, readRepoJson } from "../../../../tests/support/game-data.js";
import { freshState, migrateSavedData } from "../../app/saved-data.js";
import { isItemId, itemIconUrl, markerIconItem, showsItemIcons } from "./rules.js";

const MS2000_MARKER_ID = "5991b51486f77447b112d44f";

test("a mark objective shows the marker item (A Fuel Matter: MS2000)", () => {
  const markSpot = findTask("A Fuel Matter").objs[0];
  assert.deepEqual(markerIconItem(markSpot), { id: MS2000_MARKER_ID, name: "MS2000 Marker", hasAlternatives: false });
});

test("a plant objective shows the item to leave (Dandies: the Bomber beanie)", () => {
  const plant = findTask("Dandies").objs.find((objective) => objective.type === "plantItem");
  assert.deepEqual(markerIconItem(plant), { id: "60bf74184a63fc79b60c57f6", name: "Bomber beanie", hasAlternatives: false });
});

test("a plant objective with alternatives shows the first one and says there are more", () => {
  const plant = findTask("Break the Deal").objs.find((objective) => objective.type === "plantItem" && objective.items.length > 1);
  const shown = markerIconItem(plant);
  assert.equal(shown.id, plant.items[0].id);
  assert.equal(shown.hasAlternatives, true);
});

test("a quest item plant shows the quest item when the data has its id, else keeps the shape", () => {
  const plant = findTask("Health Care Privacy - Part 6").objs.find((objective) => objective.type === "plantQuestItem");
  assert.equal(markerIconItem(plant), null, "data from before qiId");
  const withId = { ...plant, qiId: "66a0f0926fee20fa70036da6" };
  assert.deepEqual(markerIconItem(withId), { id: "66a0f0926fee20fa70036da6", name: "Blood sample", hasAlternatives: false });
});

test("every other kind of objective keeps its category shape", () => {
  const types = new Set();
  for (const objective of findTask("Anesthesia").objs.concat(findTask("Ballet Lover").objs)) {
    if (["mark", "plantItem", "plantQuestItem"].includes(objective.type)) continue;
    types.add(objective.type);
    assert.equal(markerIconItem(objective), null, objective.type);
  }
  assert.ok(types.size > 0);
});

test("only 24 lower-case hex digits count as an item id, and the picture comes from this app", () => {
  assert.equal(isItemId(MS2000_MARKER_ID), true);
  for (const bad of ["", "5991B51486F77447B112D44F", "../x", MS2000_MARKER_ID + "0", null, undefined, 5]) {
    assert.equal(isItemId(bad), false, String(bad));
  }
  assert.equal(itemIconUrl(MS2000_MARKER_ID), `/icons/${MS2000_MARKER_ID}.webp`);
});

test("item icons are on for a new file and for older files, which load without gaining the field", () => {
  assert.equal(showsItemIcons(freshState()), true);
  const migrated = migrateSavedData({ version: 2, cats: [], tasks: {}, prefs: {} });
  assert.equal(showsItemIcons(migrated), true);
  assert.equal("taskIcons" in migrated, false, "saved data only gets the field when you choose shapes");
  assert.equal(showsItemIcons(migrateSavedData(readRepoJson("tests/fixtures/v1-data.json"))), true);
});

test("choosing shapes is kept when the file loads again", () => {
  const saved = migrateSavedData({ ...freshState(), taskIcons: false });
  assert.equal(saved.taskIcons, false);
  assert.equal(showsItemIcons(saved), false);
});
