// @ts-check
// The one way to the task list on screen: each game mode has its own list (ticket 22), and the
// page shows the one of the mode in Settings. Every feature reads and changes tasks, ticks, the
// bag and sub-tasks through currentList(), never through app.saved directly.
import { app } from "./state.js";
import { knownGameMode } from "./game-modes.js";
import { taskListOf } from "./saved-data.js";

/** @import { SavedState, TaskList } from "./types.js" */

/**
 * The game mode whose list is shown: the one in Settings ("regular" before the status loads).
 * @returns {string}
 */
export function shownGameMode() {
  const settings = app.status && app.status.settings;
  return knownGameMode(settings && settings.gameMode);
}

/**
 * The shown mode's list: `{tasks, ticks, used, have, subs}`, changed in place by its callers.
 * @param {SavedState} [saved] app.saved when not given
 * @returns {TaskList}
 */
export function currentList(saved = app.saved) {
  return taskListOf(saved, shownGameMode());
}
