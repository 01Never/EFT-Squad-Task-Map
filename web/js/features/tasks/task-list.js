// @ts-check
// Your task list as the page reads and changes it: active tasks, their parts on a map, ticks.
// These use the shared state (the shown game mode's list through currentList(), app.taskById);
// the rules themselves are in rules.js and categories.js. Nothing here draws or saves: callers
// call save() and re-render. listedPartsOnMap() adds squadmates' tasks you don't have (ticket 26)
// to your own rows, for selecting and the popup.
import { app } from "../../app/state.js";
import { blankTaskEntry } from "../../app/saved-data.js";
import { currentList } from "../../app/current-list.js";
import {
  partsOfTask,
  isTaskOnMap,
  isOffMapTask,
  isPartOnMap,
  isPartDone,
  activateTaskEntry,
  tickObjective,
  isRowShownOnMap,
} from "./rules.js";
import { categoryOfPart, defaultCategoryOfPart } from "./categories.js";
import { updateBagForTick } from "../readiness/rules.js";
import { isHiddenBySquadFilter, friendOnlyPartsOnMap } from "../squad/friends.js";

/** @import { Task, Part, Category, Objective, TaskEntry, TaskList, PartOnMap } from "../../app/types.js" */

/**
 * A task's saved entry in the given list (the shown one by default), created (not on the list)
 * the first time it's needed.
 * @param {string} taskId
 * @param {TaskList} [list]
 * @returns {TaskEntry}
 */
export function taskEntry(taskId, list = currentList()) {
  list.tasks[taskId] = list.tasks[taskId] || blankTaskEntry();
  return list.tasks[taskId];
}

/**
 * Tasks on your list that exist in the current game data, in the saved order.
 * @returns {Task[]}
 */
export function activeTasks() {
  const list = currentList();
  return Object.keys(list.tasks)
    .filter((taskId) => list.tasks[taskId].active && app.taskById[taskId])
    .map((taskId) => app.taskById[taskId]);
}

/**
 * Your tasks with anything on this map.
 * @param {string} mapKey
 */
export function activeTasksOnMap(mapKey) {
  return activeTasks().filter((task) => isTaskOnMap(task, mapKey));
}

/** Your tasks with nothing on a map (hand-ins, builds…). */
export function activeOffMapTasks() {
  return activeTasks().filter((task) => isOffMapTask(task));
}

/**
 * A task's parts, split or whole as you chose ("Don't split").
 * @param {Task} task
 * @returns {Part[]}
 */
export function partsOf(task) {
  const entry = currentList().tasks[task.id];
  return partsOfTask(task, !!(entry && entry.noSplit));
}

/**
 * @param {Task} task
 * @param {Part} part
 * @returns {Category}
 */
export function categoryOf(task, part) {
  return categoryOfPart(app.saved, currentList(), task, part);
}

/**
 * The parts of a row's task, as the list shows them: as you chose for yours, split by default for
 * a squadmate's task (ticket 26).
 * @param {PartOnMap} row
 * @returns {Part[]}
 */
export function partsOfRow(row) {
  return row.notMine ? partsOfTask(row.task, false) : partsOf(row.task);
}

/**
 * The category of another part of a row's task: yours as you sorted it, a squadmate's task's by
 * the default rules.
 * @param {PartOnMap} row
 * @param {Part} part
 * @returns {Category}
 */
export function categoryOfRowPart(row, part) {
  return row.notMine ? defaultCategoryOfPart(app.saved, part) : categoryOf(row.task, part);
}

/**
 * Every part of your tasks that's on this map, with its category and whether it's done or pinned.
 * Includes done parts and parts in hidden categories (the list shows them).
 * @param {string} mapKey
 * @returns {PartOnMap[]}
 */
export function partsOnMap(mapKey) {
  const list = currentList();
  const rows = [];
  for (const task of activeTasksOnMap(mapKey)) {
    const entry = list.tasks[task.id];
    for (const part of partsOf(task)) {
      if (!isPartOnMap(part, mapKey, task)) continue;
      const cat = categoryOf(task, part);
      rows.push({ task, part, cat, done: isPartDone(part, list.ticks), pinned: !!(entry && entry.pinned) });
    }
  }
  return rows;
}

/**
 * Whether a row is drawn on the map (category shown, not done, pinned if "Pinned only").
 * @param {PartOnMap} row
 */
export function isShownOnMap(row) {
  return isRowShownOnMap(row, app.saved.pinnedOnly) && !isHiddenBySquadFilter(row.task.id);
}

/**
 * Put a task on a list (from a scan or by hand): the shown game mode's list, unless another is
 * given (a scan keeps the list it started with). Game-log events: tasks/rules.js.
 * @param {string} taskId
 * @param {string} source "scan", "log" or "manual"
 * @param {Partial<TaskEntry>} [extra] fields to set as well (scan progress…)
 * @param {TaskList} [list]
 * @returns {boolean} true when it wasn't on the list before
 */
export function activateTask(taskId, source, extra = {}, list = currentList()) {
  return activateTaskEntry(taskEntry(taskId, list), source, extra, Date.now());
}

/**
 * Every row the list shows on this map: your parts (partsOnMap), then the parts of squadmates'
 * tasks you don't have (ticket 26, `notMine`). Selecting and the popup look rows up here.
 * Counts, readiness, the Bring list and your markers use partsOnMap(): yours only.
 * @param {string} mapKey
 * @returns {PartOnMap[]}
 */
export function listedPartsOnMap(mapKey) {
  return [...partsOnMap(mapKey), ...friendOnlyPartsOnMap(mapKey)];
}

/**
 * The task an objective belongs to, or undefined.
 * @param {Objective} objective
 * @returns {Task | undefined}
 */
function taskOfObjective(objective) {
  return Object.values(app.taskById).find((task) => task.objs.includes(objective));
}

/**
 * Set an objective's tick: true = done, false = not done, or a count. Ticking a marker or a
 * planted item also takes it out of your bag (readiness), and unticking gives it back.
 * Nothing happens for a task that isn't on your list (a squadmate's, ticket 26).
 * @param {Objective} objective
 * @param {boolean | number} value
 * @returns {boolean} false when refused
 */
export function setTick(objective, value) {
  const list = currentList();
  const task = taskOfObjective(objective);
  if (!task) return false;
  const { isDone, countChange } = tickObjective(list, task.id, objective, value);
  if (isDone) updateBagForTick(list, objective, countChange);
  return isDone;
}
