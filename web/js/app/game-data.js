// @ts-check
// The game data from /api/data (tasks, maps' extracts) and the lookups built from it: tasks by id,
// objectives by id, task names for matching, map names. Reloaded when the server says it changed.
import { app } from "./state.js";
import { fetchJson } from "./api.js";
import { makeTaskNameMatcher } from "../features/scan/rules.js";
import { clearPartsCache } from "../features/tasks/rules.js";
import { rerenderPage } from "./routing.js";

/** @import { Objective } from "./types.js" */

// Maps that have tasks but no map art in this app (so they aren't in maps-config.json).
const NAMES_OF_MAPS_WITHOUT_ART = { "the-lab": "The Lab", labyrinth: "The Labyrinth" };

/** Build the lookups for freshly loaded game data. */
export function indexGameData() {
  app.taskById = {};
  for (const task of app.gameData.tasks) app.taskById[task.id] = task;
  app.taskNameMatcher = makeTaskNameMatcher(app.gameData.tasks);
  clearPartsCache();
}

/** Load the game data and the status again (the server sent "data"), then redraw the page. */
export async function reloadGameData() {
  app.gameData = await fetchJson("/api/data");
  app.status = await fetchJson("/api/status");
  indexGameData();
  rerenderPage();
}

/**
 * A map's display name ("Streets of Tarkov"); the key itself for a map nobody named.
 * @param {string} mapKey
 */
export function mapDisplayName(mapKey) {
  const config = app.mapConfigs.find((candidate) => candidate.key === mapKey) || /** @type {any} */ ({});
  return config.name || NAMES_OF_MAPS_WITHOUT_ART[mapKey] || mapKey;
}

/** @type {{ data: object, byId: Map<string, Objective> } | null} */
let objectiveIndex = null;

/**
 * An objective by its id (for the tick buttons, which only carry the id), or null.
 * @param {string} objectiveId
 * @returns {Objective | null}
 */
export function objectiveById(objectiveId) {
  if (!objectiveIndex || objectiveIndex.data !== app.gameData) {
    objectiveIndex = { data: app.gameData, byId: new Map() };
    for (const task of app.gameData.tasks) {
      for (const objective of task.objs) objectiveIndex.byId.set(objective.id, objective);
    }
  }
  return objectiveIndex.byId.get(objectiveId) || objectiveInIndexedTasks(objectiveId);
}

/**
 * The same search through app.taskById. It only differs from the index while new game data is
 * loading (the data is replaced before the tasks are re-indexed), as in v2.
 * @param {string} objectiveId
 */
function objectiveInIndexedTasks(objectiveId) {
  for (const task of Object.values(app.taskById)) {
    const objective = task.objs.find((candidate) => candidate.id === objectiveId);
    if (objective) return objective;
  }
  return null;
}
