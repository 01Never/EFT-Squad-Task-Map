// @ts-check
// Your task list as the page reads and changes it: active tasks, their parts on a map, ticks.
// These use the shared state (app.saved, app.taskById); the rules themselves are in rules.js
// and categories.js. Nothing here draws or saves: callers call save() and re-render.
import { app } from "../../app/state.js";
import { blankTaskEntry } from "../../app/saved-data.js";
import {
  partsOfTask,
  isTaskOnMap,
  isOffMapTask,
  isPartOnMap,
  isPartDone,
  activateTaskEntry,
  finishTaskEntry,
  savedTickCount,
  clampedTickCount,
  storeTick,
  isRowShownOnMap,
} from "./rules.js";
import { categoryOfPart } from "./categories.js";
import { updateBagForTick } from "../readiness/rules.js";
import { isHiddenBySquadFilter } from "../squad/friends.js";

/** @import { Task, Part, Category, Objective, TaskEntry, PartOnMap } from "../../app/types.js" */

/**
 * A task's saved entry, created (not on the list) the first time it's needed.
 * @param {string} taskId
 * @returns {TaskEntry}
 */
export function taskEntry(taskId) {
  app.saved.tasks[taskId] = app.saved.tasks[taskId] || blankTaskEntry();
  return app.saved.tasks[taskId];
}

/**
 * Tasks on your list that exist in the current game data, in the saved order.
 * @returns {Task[]}
 */
export function activeTasks() {
  return Object.keys(app.saved.tasks)
    .filter((taskId) => app.saved.tasks[taskId].active && app.taskById[taskId])
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
  const entry = app.saved.tasks[task.id];
  return partsOfTask(task, !!(entry && entry.noSplit));
}

/**
 * @param {Task} task
 * @param {Part} part
 * @returns {Category}
 */
export function categoryOf(task, part) {
  return categoryOfPart(app.saved, task, part);
}

/**
 * Every part of your tasks that's on this map, with its category and whether it's done or pinned.
 * Includes done parts and parts in hidden categories (the list shows them).
 * @param {string} mapKey
 * @returns {PartOnMap[]}
 */
export function partsOnMap(mapKey) {
  const saved = app.saved;
  const rows = [];
  for (const task of activeTasksOnMap(mapKey)) {
    const entry = saved.tasks[task.id];
    for (const part of partsOf(task)) {
      if (!isPartOnMap(part, mapKey, task)) continue;
      const cat = categoryOf(task, part);
      rows.push({ task, part, cat, done: isPartDone(part, saved.ticks), pinned: !!(entry && entry.pinned) });
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
 * Put a task on your list (from a scan, the game log, or by hand).
 * @param {string} taskId
 * @param {string} source "scan", "log" or "manual"
 * @param {Partial<TaskEntry>} [extra] fields to set as well (scan progress…)
 * @returns {boolean} true when it wasn't on the list before
 */
export function activateTask(taskId, source, extra = {}) {
  return activateTaskEntry(taskEntry(taskId), source, extra, Date.now());
}

/**
 * Finished or failed in the game: off the list, ticks cleared, unpinned (see rules.js).
 * @param {string} taskId
 */
export function finishTask(taskId) {
  return finishTaskEntry(app.saved, taskId, app.taskById[taskId]);
}

/**
 * Set an objective's tick: true = done, false = not done, or a count. Ticking a marker or a
 * planted item also takes it out of your bag (readiness), and unticking gives it back.
 * @param {Objective} objective
 * @param {boolean | number} value
 */
export function setTick(objective, value) {
  const saved = app.saved;
  const oldCount = savedTickCount(objective, saved.ticks);
  const newCount = clampedTickCount(objective, value);
  storeTick(saved.ticks, objective, newCount);
  updateBagForTick(saved, objective, newCount - oldCount);
}
