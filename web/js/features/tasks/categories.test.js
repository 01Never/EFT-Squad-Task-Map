// Tests for the category rules (categories.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findTask } from "../../../../tests/support/game-data.js";
import { freshState } from "../../app/saved-data.js";
import { partsOfTask } from "./rules.js";
import {
  categoryOfPart,
  recreateMissingDefaults,
  snapshotCategories,
  restoreCategories,
  resortEverything,
  deleteCategory,
  newCategory,
  insertBeforeUnsorted,
} from "./categories.js";

test("a part lands in its default category unless you moved it", () => {
  const saved = freshState();
  const list = saved.modes.regular;
  const dandies = findTask("Dandies");
  const [firstPart, secondPart] = partsOfTask(dandies);
  assert.equal(categoryOfPart(saved, list, dandies, firstPart).builtin, firstPart.action);

  // Moved by hand to Unsorted.
  const movedToUnsorted = { cat: "unsorted", manual: true };
  list.tasks[dandies.id] = { partCats: { [secondPart.key]: movedToUnsorted } };
  assert.equal(categoryOfPart(saved, list, dandies, secondPart).id, "unsorted");

  // Its default category deleted: falls back to Unsorted until the defaults are re-created.
  saved.cats = saved.cats.filter((category) => category.builtin !== firstPart.action);
  assert.equal(categoryOfPart(saved, list, dandies, firstPart).builtin, "unsorted");
  assert.equal(recreateMissingDefaults(saved), 1);
  assert.equal(categoryOfPart(saved, list, dandies, firstPart).builtin, firstPart.action);
});

test("re-sorting everything undoes every move, and Undo puts them back", () => {
  const saved = freshState();
  const list = saved.modes.regular;
  const dandies = findTask("Dandies");
  const [firstPart] = partsOfTask(dandies);
  list.tasks[dandies.id] = { partCats: { [firstPart.key]: { cat: "unsorted", manual: true } } };
  const snapshot = snapshotCategories(saved, list);

  resortEverything(saved, list);
  assert.equal(categoryOfPart(saved, list, dandies, firstPart).builtin, firstPart.action);

  restoreCategories(saved, list, snapshot);
  assert.equal(categoryOfPart(saved, list, dandies, firstPart).id, "unsorted");
});

test("a part's category choice belongs to its game mode's list; the categories are shared", () => {
  const saved = freshState();
  const dandies = findTask("Dandies");
  const [firstPart] = partsOfTask(dandies);
  saved.modes.pve.tasks[dandies.id] = { partCats: { [firstPart.key]: { cat: "unsorted", manual: true } } };

  assert.equal(categoryOfPart(saved, saved.modes.pve, dandies, firstPart).id, "unsorted");
  assert.equal(categoryOfPart(saved, saved.modes.regular, dandies, firstPart).builtin, firstPart.action);

  resortEverything(saved, saved.modes.regular);
  assert.equal(categoryOfPart(saved, saved.modes.pve, dandies, firstPart).id, "unsorted", "only the shown list is re-sorted");
});

test("deleting a category sends parts back to their defaults in every game mode's list", () => {
  const saved = freshState();
  const dandies = findTask("Dandies");
  const [firstPart] = partsOfTask(dandies);
  const keyRuns = newCategory(saved.cats, "c-keys", "Key runs");
  insertBeforeUnsorted(saved.cats, keyRuns);
  saved.modes.pve.tasks[dandies.id] = { partCats: { [firstPart.key]: { cat: "c-keys", manual: true } } };
  saved.modes["pvp-season"].tasks[dandies.id] = { partCats: { [firstPart.key]: { cat: "c-keys", manual: true } } };

  deleteCategory(saved, keyRuns);

  assert.deepEqual(saved.modes.pve.tasks[dandies.id].partCats, {});
  assert.deepEqual(saved.modes["pvp-season"].tasks[dandies.id].partCats, {});
  assert.equal(saved.cats.some((category) => category.id === "c-keys"), false);
});
