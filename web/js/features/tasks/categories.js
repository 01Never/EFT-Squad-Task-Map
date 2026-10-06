// @ts-check
// Categories: the built-in set, which category a part is in, and the changes the list makes to
// them (new, move, delete, re-sort). Plain functions only: no DOM, no network.
import { MARKER_SHAPES } from "../../map/marker-shapes.js";

/** @import { SavedState, Category, Task, Part, TaskEntry } from "../../app/types.js" */

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

// Colours for categories you add (and AI Categorize adds without a colour), taken in turn by how
// many categories exist, so neighbours differ.
export const NEW_CATEGORY_COLORS = ["#f783ac", "#ff922b", "#66d9e8", "#a9e34b", "#e599f7", "#ffe084", "#4dabf7"];

/**
 * The owner's (or the AI's) choice for a part: the part's own key, else "*" (the whole task,
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
 * @param {SavedState} saved
 * @param {Task} task
 * @param {Part} part
 * @returns {Category}
 */
export function categoryOfPart(saved, task, part) {
  const choice = chosenCategoryFor(saved.tasks[task.id], part);
  if (choice && choice.cat) {
    const chosen = saved.cats.find((category) => category.id === choice.cat);
    if (chosen) return chosen;
  }
  const builtIn = saved.cats.find((category) => category.builtin === part.action);
  return builtIn || saved.cats.find((category) => category.builtin === "unsorted") || saved.cats[0];
}

/**
 * Whether you (or AI Categorize) moved this part by hand, so "reset" is offered.
 * @param {SavedState} saved
 * @param {Task} task
 * @param {Part} part
 */
export function isMovedByHand(saved, task, part) {
  return !!chosenCategoryFor(saved.tasks[task.id], part)?.manual;
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
 * A new category made by you or by AI Categorize. Without a colour or shape of its own, it takes
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
 * @param {TaskEntry} entry
 * @param {string} partKey
 * @param {Part | undefined} part
 * @param {string} categoryId
 */
export function movePartTo(entry, partKey, part, categoryId) {
  entry.partCats = entry.partCats || {};
  if (part && !part.split) delete entry.partCats["*"];
  entry.partCats[partKey] = { cat: categoryId, manual: true };
}

/**
 * "reset": the part goes back to its default category.
 * @param {TaskEntry} entry
 * @param {string} partKey
 */
export function resetPartCategory(entry, partKey) {
  delete entry.partCats[partKey];
  delete entry.partCats["*"];
}

/**
 * Delete a category: every part you put in it goes back to its default category (or Unsorted).
 * @param {SavedState} saved
 * @param {Category} category
 */
export function deleteCategory(saved, category) {
  for (const entry of Object.values(saved.tasks)) {
    for (const [partKey, choice] of Object.entries(entry.partCats || {})) {
      if (choice.cat === category.id) delete entry.partCats[partKey];
    }
  }
  saved.cats = saved.cats.filter((candidate) => candidate !== category);
}

/**
 * "Re-sort everything": the built-ins come back and every part goes to its default category,
 * undoing manual moves and AI choices.
 * @param {SavedState} saved
 */
export function resortEverything(saved) {
  recreateMissingDefaults(saved);
  for (const entry of Object.values(saved.tasks)) entry.partCats = {};
}

/**
 * The categories and every task's choices, as text, so a sort can be undone.
 * @param {SavedState} saved
 * @returns {string}
 */
export function snapshotCategories(saved) {
  const choicesByTask = Object.fromEntries(Object.entries(saved.tasks).map(([taskId, entry]) => [taskId, entry.partCats]));
  return JSON.stringify({ cats: saved.cats, pc: choicesByTask });
}

/**
 * Put back what snapshotCategories() saved (tasks that are gone since are skipped).
 * @param {SavedState} saved
 * @param {string} snapshot
 */
export function restoreCategories(saved, snapshot) {
  const restored = JSON.parse(snapshot);
  saved.cats = restored.cats;
  for (const [taskId, partCats] of Object.entries(restored.pc)) {
    if (saved.tasks[taskId]) saved.tasks[taskId].partCats = /** @type {any} */ (partCats);
  }
}
