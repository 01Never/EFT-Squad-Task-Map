// @ts-check
// Map picker: how many of your tasks each map card counts, and which tasks aren't on any map this
// app has. Plain functions only: no DOM, no network. panel.js draws the picker.
import { isPartOnMap, isPartDone, isOffMapTask, mapsOfTask } from "../tasks/rules.js";

/** @import { Task, Part } from "../../app/types.js" */

/**
 * The number on each map's card: your tasks with a part on that map that isn't done yet.
 * @param {Task[]} tasks your active tasks
 * @param {string[]} mapKeys the maps with a card
 * @param {(task: Task) => Part[]} partsOf a task's parts, split or whole as you chose
 * @param {Record<string, true | number>} ticks
 * @returns {Record<string, number>} by map key
 */
export function countTasksPerMap(tasks, mapKeys, partsOf, ticks) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const mapKey of mapKeys) {
    const hasWorkHere = (task) => partsOf(task).some((part) => isPartOnMap(part, mapKey, task) && !isPartDone(part, ticks));
    counts[mapKey] = tasks.filter(hasWorkHere).length;
  }
  return counts;
}

/**
 * Your tasks that don't show on any map card: hand-ins and builds with nothing on a map
 * (`offMap`, by name), and tasks only on maps without art here, such as Labs (`onOtherMaps`).
 * @param {Task[]} tasks your active tasks
 * @param {string[]} mapKeys the maps with a card
 */
export function tasksNotOnAMapCard(tasks, mapKeys) {
  const offMap = tasks.filter(isOffMapTask).sort((first, second) => first.name.localeCompare(second.name));
  const isOnACard = (task) => mapsOfTask(task).some((mapKey) => mapKeys.includes(mapKey));
  const onOtherMaps = tasks.filter((task) => !isOffMapTask(task) && !isOnACard(task));
  return { offMap, onOtherMaps };
}
