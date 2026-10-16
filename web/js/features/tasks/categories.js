// @ts-check
// Categories: the built-in set, which category a part is in, and the changes the list makes to
// them (new, move, delete, re-sort). Plain functions only: no DOM, no network.
import { MARKER_SHAPES } from "../../map/marker-shapes.js";

/** @import { SavedState, TaskList, Category, Task, Part, TaskEntry } from "../../app/types.js" */

/**
 * The built-in categories, one per kind of work, plus Unsorted (always last). `builtin` is the
 * action whose parts land there by default. These colours and shapes are what a new saved data
 * file starts with; after that they're the owner's to change.
 * @type {Category[]}
 */
export const DEFAULT_CATEGORIES = [
  { id: "b-boss", name: "Boss hunts", color: "#ff4d4d", icon: "star", builtin: "boss" },
  { id: "b-pmc", name: "PMC kills", color: "#ff922b", icon: "triangle", builtin: "pmc" },
  { id: "b-scav", name: "Scav / any kills", color: "#c0eb75", icon: "triangle", builtin: "scav" },
  { id: "b-mark", name: "Mark", color: "#ffd43b", icon: "diamond", builtin: "mark" },
  { id: "b-plant", name: "Plant / stash", color: "#3bc9db", icon: "square", builtin: "plant" },
  { id: "b-retrieve", name: "Retrieve", color: "#f783ac", icon: "circle", builtin: "retrieve" },
  { id: "b-go", name: "Scout & extract", color: "#51cf66", icon: "circle", builtin: "go" },
  { id: "unsorted", name: "Unsorted", color: "#c7c5b3", icon: "hexagon", builtin: "unsorted" },
];

// Colours for categories you add (without a colour of their own), taken in turn by how
// many categories exist, so neighbours differ.
export const NEW_CATEGORY_COLORS = ["#f783ac", "#ff922b", "#66d9e8", "#a9e34b", "#e599f7", "#ffe084", "#4dabf7"];

/**
 * The owner's choice for a part: the part's own key, else "*" (the whole task,
 * carried over from v1). Undefined when there's none.
 * @param {TaskEntry | undefined} entry
 * @param {Part} part
 */
function chosenCategoryFor(entry, part) {
  return entry && entry.partCats && (entry.partCats[part.key] || entry.partCats["*"]);
}

/**
 * The category a part is in: the owner's choice, else the built-in for its kind of work, else
 * Unsorted. So "auto-sort" is implicit: only parts you moved are stored.
 * @param {SavedState} saved its categories (shared by every game mode)
 * @param {TaskList} list the game mode's list, with the choices
 * @param {Task} task
 * @param {Part} part
 * @returns {Category}
 */
export function categoryOfPart(saved, list, task, part) {
  const choice = chosenCategoryFor(list.tasks[task.id], part);
  if (choice && choice.cat) {
    const chosen = saved.cats.find((category) => category.id === choice.cat);
    if (chosen) return chosen;
  }
  return defaultCategoryOfPart(saved, part);
}

/**
 * The category a part gets by the default rules alone: the built-in for its kind of work, else
 * Unsorted. A squadmate's task you don't have (ticket 26) is always sorted this way.
 * @param {SavedState} saved its categories
 * @param {Part} part
 * @returns {Category}
 */
export function defaultCategoryOfPart(saved, part) {
  const builtIn = saved.cats.find((category) => category.builtin === part.action);
  return builtIn || saved.cats.find((category) => category.builtin === "unsorted") || saved.cats[0];
}

/**
 * Whether you moved this part by hand, so "reset" is offered.
 * @param {TaskList} list
 * @param {Task} task
 * @param {Part} part
 */
export function isMovedByHand(list, task, part) {
  return !!chosenCategoryFor(list.tasks[task.id], part)?.manual;
}

/**
 * Re-create any built-in category that was deleted, just before Unsorted. A deleted built-in
 * whose id is taken gets a new id. Returns how many were added.
 * @param {SavedState} saved
 */
export function recreateMissingDefaults(saved) {
  let added = 0;
  for (const builtIn of DEFAULT_CATEGORIES) {
    if (saved.cats.some((category) => category.builtin === builtIn.builtin)) continue;
    const isIdTaken = saved.cats.some((category) => category.id === builtIn.id);
    const id = isIdTaken ? builtIn.id + "-" + Date.now().toString(36) : builtIn.id;
    insertBeforeUnsorted(saved.cats, { ...builtIn, visible: true, id });
    added++;
  }
  return added;
}

/**
 * New categories go just before Unsorted (or last when there's no Unsorted).
 * @param {Category[]} categories
 * @param {Category} category
 */
export function insertBeforeUnsorted(categories, category) {
  const unsortedIndex = categories.findIndex((candidate) => candidate.builtin === "unsorted");
  categories.splice(unsortedIndex < 0 ? categories.length : unsortedIndex, 0, category);
}

/**
 * A new category made by you. Without a colour or shape of its own, it takes
 * the next one in turn.
 * @param {Category[]} categories the existing ones
 * @param {string} id
 * @param {string} name
 * @param {{ color?: string, icon?: string }} [preferred]
 * @returns {Category}
 */
export function newCategory(categories, id, name, preferred = {}) {
  const color = preferred.color || NEW_CATEGORY_COLORS[categories.length % NEW_CATEGORY_COLORS.length];
  const icon = preferred.icon || MARKER_SHAPES[categories.length % MARKER_SHAPES.length];
  return { id, name, color, icon, visible: true, builtin: null };
}

/**
 * Move a part into a category by hand. A whole task's v1 choice ("*") is replaced.
 * Refused for a task that isn't on your list (a squadmate's task, ticket 26).
 * @param {TaskEntry | undefined} entry
 * @param {string} partKey
 * @param {Part | undefined} part
 * @param {string} categoryId
 * @returns {boolean} false when refused
 */
export function movePartTo(entry, partKey, part, categoryId) {
  if (!entry || !entry.active) return false;
  entry.partCats = entry.partCats || {};
  if (part && !part.split) delete entry.partCats["*"];
  entry.partCats[partKey] = { cat: categoryId, manual: true };
  return true;
}

/**
 * "reset": the part goes back to its default category. Refused for a task that isn't on your list.
 * @param {TaskEntry | undefined} entry
 * @param {string} partKey
 * @returns {boolean} false when refused
 */
export function resetPartCategory(entry, partKey) {
  if (!entry || !entry.active) return false;
  entry.partCats = entry.partCats || {};
  delete entry.partCats[partKey];
  delete entry.partCats["*"];
  return true;
}

/**
 * Delete a category: every part you put in it goes back to its default category (or Unsorted),
 * in every game mode's list, since the categories are shared by all of them.
 * @param {SavedState} saved
 * @param {Category} category
 */
export function deleteCategory(saved, category) {
  for (const list of Object.values(saved.modes)) {
    for (const entry of Object.values(list.tasks)) {
      for (const [partKey, choice] of Object.entries(entry.partCats || {})) {
        if (choice.cat === category.id) delete entry.partCats[partKey];
      }
    }
  }
  saved.cats = saved.cats.filter((candidate) => candidate !== category);
}

/**
 * "Re-sort everything": the built-ins come back and every part goes to its default category,
 * undoing manual moves and AI choices. Only in the list shown: other game modes keep theirs.
 * @param {SavedState} saved
 * @param {TaskList} list
 */
export function resortEverything(saved, list) {
  recreateMissingDefaults(saved);
  for (const entry of Object.values(list.tasks)) entry.partCats = {};
}

/**
 * The categories and every task's choices in this list, as text, so a sort can be undone.
 * @param {SavedState} saved
 * @param {TaskList} list
 * @returns {string}
 */
export function snapshotCategories(saved, list) {
  const choicesByTask = Object.fromEntries(Object.entries(list.tasks).map(([taskId, entry]) => [taskId, entry.partCats]));
  return JSON.stringify({ cats: saved.cats, pc: choicesByTask });
}

/**
 * Put back what snapshotCategories() saved (tasks that are gone since are skipped).
 * @param {SavedState} saved
 * @param {TaskList} list the list the snapshot was taken of
 * @param {string} snapshot
 */
export function restoreCategories(saved, list, snapshot) {
  const restored = JSON.parse(snapshot);
  saved.cats = restored.cats;
  for (const [taskId, partCats] of Object.entries(restored.pc)) {
    if (list.tasks[taskId]) list.tasks[taskId].partCats = /** @type {any} */ (partCats);
  }
}

/**
 * The one-time reset to the default categories (issue #25, when AI Categorize was removed): every part
 * of every game mode's list goes back to its default category, by clearing the moves. Every
 * category stays (the ones the AI made are now empty custom categories). `catsResetAt` records
 * that it ran, so it never runs again; a file that has it (a new one, or one already reset)
 * is left alone. Changes the saved data in place.
 * @param {SavedState} saved
 * @param {number} now ms since 1970
 * @returns {boolean} whether it ran (the caller then saves)
 */
export function resetPartCategoriesOnce(saved, now) {
  if (saved.catsResetAt !== undefined) return false;
  for (const list of Object.values(saved.modes)) {
    for (const entry of Object.values(list.tasks)) {
      entry.partCats = {};
    }
  }
  saved.catsResetAt = now;
  return true;
}
