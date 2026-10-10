// @ts-check
// The squad as the page reads it: who your friends are (from the last `squad` view the server
// sent), which of them you chose to show, and what the tasks, the markers and the filter need to
// know about them. Reads app.squad and app.saved; changes nothing. The decisions are in rules.js.
import { app } from "../../app/state.js";
import {
  friendsWithDrawingsOn,
  friendsWithTasksOn,
  friendsAlsoDoing,
  isSharedOnlyFilterOn,
  isSharedOnlyFilterInEffect,
  isHiddenBySharedOnlyFilter,
  safeFriendColor,
} from "./rules.js";

/** @import { SquadFriend } from "../../app/types.js" */

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

/** Friends whose tasks you show (and who share them). */
export function friendsShowingTasks() {
  return friendsWithTasksOn(allFriends(), app.saved);
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
