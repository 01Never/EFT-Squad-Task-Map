// @ts-check
// Sub-tasks: your own notes under a task, optionally pinned on a map with a floor badge.
// Plain functions only: no DOM, no network.

/** @import { SubTask } from "../../app/types.js" */

/** The floor badges a sub-task pin can have ("" = ground, shown as "G"). */
export const SUB_TASK_FLOOR_OPTIONS = ["", "2", "3", "4", "5", "B"];

// A sub-task's text is at most this long (the input box's limit).
export const SUB_TASK_MAX_LENGTH = 140;

/**
 * A new sub-task: not done, not pinned anywhere yet.
 * @param {string} id
 * @param {string} taskId
 * @param {string} text
 * @returns {SubTask}
 */
export function newSubTask(id, taskId, text) {
  return { id, task: taskId, text, done: false, map: null, x: null, z: null, f: "" };
}

/**
 * Take a sub-task's pin off the map (the sub-task stays).
 * @param {SubTask} subTask
 */
export function unpinSubTask(subTask) {
  subTask.x = subTask.z = null;
  subTask.map = null;
}

/**
 * Where a sub-task's pin is, seen from the open map: "here", "elsewhere" (another map) or "none".
 * @param {SubTask} subTask
 * @param {string} openMapKey
 * @returns {"here" | "elsewhere" | "none"}
 */
export function pinPlace(subTask, openMapKey) {
  if (subTask.x == null) return "none";
  return subTask.map === openMapKey ? "here" : "elsewhere";
}
