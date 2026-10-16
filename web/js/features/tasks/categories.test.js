// Tests for the category rules (categories.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findTask } from "../../../../tests/support/game-data.js";
import { freshState, blankTaskEntry } from "../../app/saved-data.js";
import { partsOfTask } from "./rules.js";
import {
  categoryOfPart,
  defaultCategoryOfPart,
  movePartTo,
  resetPartCategory,
  recreateMissingDefaults,
  snapshotCategories,
  restoreCategories,
  resortEverything,
  deleteCategory,
  newCategory,
  insertBeforeUnsorted,
  resetPartCategoriesOnce,
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

test("the one-time reset sends every part of every mode back to its default category, once", () => {
  const saved = freshState();
  delete saved.catsResetAt; // an older file
  const custom = { id: "cx", name: "Key runs", color: "#fff", icon: "circle", builtin: null, visible: true };
  saved.cats.splice(saved.cats.length - 1, 0, custom);
  for (const mode of ["regular", "pve"]) {
    saved.modes[mode].tasks.t1 = { ...blankTaskEntry(1), partCats: { "*": { cat: "cx", manual: true } } };
  }

  assert.equal(resetPartCategoriesOnce(saved, 1234), true);
  assert.deepEqual(saved.modes.regular.tasks.t1.partCats, {});
  assert.deepEqual(saved.modes.pve.tasks.t1.partCats, {});
  assert.ok(saved.cats.some((category) => category.id === "cx"), "categories stay");
  assert.equal(saved.catsResetAt, 1234);

  saved.modes.regular.tasks.t1.partCats = { "*": { cat: "cx", manual: true } };
  assert.equal(resetPartCategoriesOnce(saved, 5678), false);
  assert.equal(saved.modes.regular.tasks.t1.partCats["*"].cat, "cx", "a later move is kept");
  assert.equal(saved.catsResetAt, 1234);
});

test("a new file never needs the reset", () => {
  assert.equal(resetPartCategoriesOnce(freshState(), 1), false);
});

test("a squadmate's task you don't have can't be moved or reset (ticket 26); yours can", () => {
  const dandies = findTask("Dandies");
  const [firstPart] = partsOfTask(dandies);
  const pinnedOnly = { ...blankTaskEntry(1), pinned: true };
  assert.equal(movePartTo(pinnedOnly, firstPart.key, firstPart, "b-boss"), false);
  assert.equal(movePartTo(undefined, firstPart.key, firstPart, "b-boss"), false);
  assert.deepEqual(pinnedOnly.partCats, {}, "nothing stored");
  assert.equal(resetPartCategory(pinnedOnly, firstPart.key), false);

  const mine = { ...blankTaskEntry(1), active: true };
  assert.equal(movePartTo(mine, firstPart.key, firstPart, "b-boss"), true);
  assert.equal(mine.partCats[firstPart.key].cat, "b-boss");
  assert.equal(resetPartCategory(mine, firstPart.key), true);
  assert.deepEqual(mine.partCats, {});
});

test("the default category ignores your choices: it's the built-in for the kind of work", () => {
  const saved = freshState();
  const dandies = findTask("Dandies");
  for (const part of partsOfTask(dandies)) {
    assert.equal(defaultCategoryOfPart(saved, part).builtin, part.action);
  }
});
