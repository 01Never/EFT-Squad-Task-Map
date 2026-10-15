// @ts-check
// The squad as the page reads it: who your friends are (from the last `squad` view the server
// sent), which of them you chose to show, and what the tasks, the markers and the filter need to
// know about them. Reads app.squad and app.saved; changes nothing. The decisions are in rules.js.
import { app } from "../../app/state.js";
import { shownGameMode } from "../../app/current-list.js";
import {
  friendsWithDrawingsOn,
  friendsWithTasksOn,
  friendsAlsoDoing,
  isSharedOnlyFilterOn,
  isSharedOnlyFilterInEffect,
  isHiddenBySharedOnlyFilter,
  safeFriendColor,
  friendBoxes,
  friendOnlyRowsOnMap,
} from "./rules.js";
import { warnOnce } from "./safe.js";

/** @import { SquadFriend, PartOnMap } from "../../app/types.js" */

// At most this many friend dots fit in a marker's bottom-left badge slot.
const MAX_SQUAD_DOTS_ON_MARKER = 3;

/** Whether this copy is in a squad. */
export function isInSquad() {
  return !!(app.squad && app.squad.settings.joined);
}

/**
 * Every friend the server knows (online or not), sorted by name.
 * @returns {SquadFriend[]}
 */
export function allFriends() {
  return isInSquad() ? app.squad.friends : [];
}

/** Friends whose drawings you show. */
export function friendsShowingDrawings() {
  return friendsWithDrawingsOn(allFriends(), app.saved);
}

/** Friends whose tasks you show (and who share them, for the game mode you're shown). */
export function friendsShowingTasks() {
  return friendsWithTasksOn(allFriends(), app.saved, shownGameMode());
}

/**
 * The friends you show who also have this task active.
 * @param {string} taskId
 */
export function friendsAlsoDoingTask(taskId) {
  return friendsAlsoDoing(taskId, friendsShowingTasks());
}

/**
 * The colours of the friends who also have this task, for the marker's dots (at most three).
 * @param {string} taskId
 * @returns {string[]}
 */
export function squadColorsForTask(taskId) {
  return friendsAlsoDoingTask(taskId)
    .slice(0, MAX_SQUAD_DOTS_ON_MARKER)
    .map((friend) => safeFriendColor(friend.color));
}

/**
 * Who has this task: a colour box and name per shown friend (rules.js: friendBoxes).
 * @param {string} taskId
 */
export function friendBoxesForTask(taskId) {
  if (!isInSquad()) return [];
  return friendBoxes(taskId, friendsShowingTasks());
}

/**
 * The rows of squadmates' tasks you don't have on this map (ticket 26, rules.js:
 * friendOnlyRowsOnMap). A friend's data that breaks it shows none of them (noted once).
 * @param {string} mapKey
 * @returns {PartOnMap[]}
 */
export function friendOnlyPartsOnMap(mapKey) {
  if (!isInSquad()) return [];
  const friends = friendsShowingTasks();
  if (!friends.length) return [];
  try {
    return friendOnlyRowsOnMap(friends, app.saved, shownGameMode(), app.taskById, mapKey);
  } catch (error) {
    warnOnce("friend-only rows", error);
    return [];
  }
}

/**
 * Whether anyone you show shares tasks, so "Shared with squad" has something to filter by.
 */
export function canSquadFilterApply() {
  return friendsShowingTasks().length > 0;
}

/**
 * Whether "Shared with squad" filters right now (on, and a shown friend shares tasks).
 */
export function isSquadFilterInEffect() {
  return isInSquad() && isSharedOnlyFilterInEffect(app.saved, friendsShowingTasks());
}

/**
 * Whether "Shared with squad" hides this task: the filter is in effect and no shown friend has it.
 * @param {string} taskId
 */
export function isHiddenBySquadFilter(taskId) {
  if (!isInSquad() || !isSharedOnlyFilterOn(app.saved)) return false; // quick exit for every row
  return isHiddenBySharedOnlyFilter(taskId, app.saved, friendsShowingTasks());
}
