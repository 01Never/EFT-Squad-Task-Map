// @ts-check
// AI Categorize: what the page sends with each request (the chat so far, the categories, the parts
// in scope), applying the changes you ticked, and undoing them. Plain functions only: no DOM, no
// network. The model itself runs on the server (internal/features/aicategorize).
import { newCategory, insertBeforeUnsorted } from "../tasks/categories.js";
import { partLabel } from "../tasks/rules.js";

/** @import { SavedState, Task, Part, Category, TaskEntry, PartCategoryChoice } from "../../app/types.js" */

/**
 * @typedef {object} PartInScope A part the AI may move.
 * @property {Task} task
 * @property {Part} part
 * @property {Category} cat the category it's in now
 */

/**
 * @typedef {object} Assignment One proposed move, as the server returns it.
 * @property {string} part_id the part key
 * @property {string} name
 * @property {string} from
 * @property {string} category the category's name
 * @property {string} reason
 */

/**
 * @typedef {object} AiResult The model's answer.
 * @property {string} reply
 * @property {Assignment[]} assignments
 * @property {{ name: string, color?: string, icon?: string }[]} new_categories
 * @property {unknown[]} [dropped] invalid suggestions the server left out
 * @property {string} model
 * @property {number} [wiki_calls]
 */

/**
 * @typedef {object} AppliedChanges What applying changed, so it can be undone.
 * @property {Record<string, PartCategoryChoice | null>} parts each moved part's previous choice (null = none)
 * @property {string[]} cats ids of the categories it created
 */

/**
 * @typedef {object} ChatMessage A message in the chat: yours, or the AI's answer.
 * @property {"user" | "bot"} role
 * @property {string} [text] yours
 * @property {boolean} [working] the answer is still coming
 * @property {string} [log] what the server says it's doing meanwhile
 * @property {AiResult} [result]
 * @property {string} [error]
 * @property {number} [applied] how many changes you applied
 * @property {AppliedChanges | null} [undo]
 * @property {boolean} [discarded]
 * @property {boolean} [undone]
 */

/**
 * The chat so far, as the model sees it: your messages, and each answer with what you did with it
 * (applied, undone or discarded), so a follow-up like "now undo the Woods ones" makes sense.
 * @param {ChatMessage[]} chat
 * @returns {{ role: string, content: string }[]}
 */
export function chatHistoryForRequest(chat) {
  const history = [];
  for (const message of chat) {
    if (message.role === "user") {
      history.push({ role: "user", content: message.text });
    } else if (message.result) {
      history.push({ role: "assistant", content: message.result.reply + whatThePlayerDid(message) });
    }
  }
  return history;
}

/** @param {ChatMessage} message */
function whatThePlayerDid(message) {
  if (message.applied) return ` [Player applied ${message.applied} of the proposed changes.]`;
  if (message.undone) return " [Player applied, then undid these changes.]";
  if (message.discarded) return " [Player discarded these changes.]";
  return "";
}

/**
 * Every category with how many of the parts in scope are in it.
 * @param {Category[]} categories
 * @param {PartInScope[]} parts
 */
export function categoriesForRequest(categories, parts) {
  return categories.map((category) => ({
    name: category.name,
    builtin: category.builtin,
    color: category.color,
    count: parts.filter((inScope) => inScope.cat.id === category.id).length,
  }));
}

/**
 * The parts in scope as the model gets them: key, task, objectives, label, current category.
 * @param {PartInScope[]} parts
 */
export function partsForRequest(parts) {
  return parts.map((inScope) => ({
    id: inScope.part.key,
    taskId: inScope.task.id,
    objIds: inScope.part.objs.map((objective) => objective.id),
    label: partLabel(inScope.part),
    category: inScope.cat.name,
  }));
}

/**
 * Apply the changes you ticked: first every new category the answer proposes (unless one with
 * that name, in any case, exists), then each move, as if you'd moved the part by hand.
 * @param {SavedState} saved changed in place
 * @param {AiResult} result
 * @param {Assignment[]} chosen
 * @param {(taskId: string) => TaskEntry} taskEntry the task's entry, created when missing
 * @param {() => string} newCategoryId
 * @returns {AppliedChanges}
 */
export function applyAssignments(saved, result, chosen, taskEntry, newCategoryId) {
  /** @type {AppliedChanges} */
  const undo = { parts: {}, cats: [] };
  const categoryIdFor = (name) => {
    let category = saved.cats.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (!category) {
      /** @type {{ color?: string, icon?: string }} */
      const proposed = result.new_categories.find((candidate) => candidate.name === name) || {};
      category = newCategory(saved.cats, newCategoryId(), name, { color: proposed.color, icon: proposed.icon });
      insertBeforeUnsorted(saved.cats, category);
      undo.cats.push(category.id);
    }
    return category.id;
  };
  result.new_categories.forEach((proposed) => categoryIdFor(proposed.name));
  for (const assignment of chosen) {
    const taskId = assignment.part_id.split(":")[0];
    const entry = taskEntry(taskId);
    const previous = entry.partCats[assignment.part_id];
    undo.parts[assignment.part_id] = previous ? { ...previous } : null;
    entry.partCats[assignment.part_id] = { cat: categoryIdFor(assignment.category), manual: true };
  }
  return undo;
}

/**
 * Undo an apply: every moved part gets its previous choice back, and each category the apply
 * created is removed unless something is in it now.
 * @param {SavedState} saved changed in place
 * @param {AppliedChanges} undo
 * @param {(taskId: string) => TaskEntry} taskEntry
 */
export function undoAssignments(saved, undo, taskEntry) {
  for (const [partKey, previous] of Object.entries(undo.parts)) {
    const entry = taskEntry(partKey.split(":")[0]);
    if (previous) entry.partCats[partKey] = previous;
    else delete entry.partCats[partKey];
  }
  for (const categoryId of undo.cats) {
    if (!isCategoryUsed(saved, categoryId)) {
      saved.cats = saved.cats.filter((category) => category.id !== categoryId);
    }
  }
}

/**
 * Whether any task has a part you put in this category.
 * @param {SavedState} saved
 * @param {string} categoryId
 */
function isCategoryUsed(saved, categoryId) {
  return Object.values(saved.tasks).some((entry) =>
    Object.values(entry.partCats || {}).some((choice) => choice.cat === categoryId),
  );
}
