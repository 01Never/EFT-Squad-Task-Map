// Tests for the category rules (categories.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findTask } from "../../../../tests/support/game-data.js";
import { freshState } from "../../app/saved-data.js";
import { partsOfTask } from "./rules.js";
import { categoryOfPart, recreateMissingDefaults, snapshotCategories, restoreCategories, resortEverything } from "./categories.js";

test("a part lands in its default category unless you moved it", () => {
  const saved = freshState();
  const dandies = findTask("Dandies");
  const [firstPart, secondPart] = partsOfTask(dandies);
  assert.equal(categoryOfPart(saved, dandies, firstPart).builtin, firstPart.action);

  // Moved by hand to Unsorted.
  const movedToUnsorted = { cat: "unsorted", manual: true };
  saved.tasks[dandies.id] = { partCats: { [secondPart.key]: movedToUnsorted } };
  assert.equal(categoryOfPart(saved, dandies, secondPart).id, "unsorted");

  // Its default category deleted: falls back to Unsorted until the defaults are re-created.
  saved.cats = saved.cats.filter((category) => category.builtin !== firstPart.action);
  assert.equal(categoryOfPart(saved, dandies, firstPart).builtin, "unsorted");
  assert.equal(recreateMissingDefaults(saved), 1);
  assert.equal(categoryOfPart(saved, dandies, firstPart).builtin, firstPart.action);
});

test("re-sorting everything undoes every move, and Undo puts them back", () => {
  const saved = freshState();
  const dandies = findTask("Dandies");
  const [firstPart] = partsOfTask(dandies);
  saved.tasks[dandies.id] = { partCats: { [firstPart.key]: { cat: "unsorted", manual: true } } };
  const snapshot = snapshotCategories(saved);

  resortEverything(saved);
  assert.equal(categoryOfPart(saved, dandies, firstPart).builtin, firstPart.action);

  restoreCategories(saved, snapshot);
  assert.equal(categoryOfPart(saved, dandies, firstPart).id, "unsorted");
});
