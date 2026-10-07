// @ts-check
// Squad in the right-hand panel and the task popup: a chip per friend (colour dot, name, "online"
// or "last seen 2 h", and two toggles: drawings and tasks), the "Shared with squad" filter, the
// "Also: Mike, Sam" line on rows and in the popup, per-friend progress in the popup, and the
// "Friends' tasks" block at the bottom of the list. Every friend text goes through escapeHtml(),
// every colour through safeFriendColor(); a friend's name or colour never goes into a script, a
// URL or an unescaped attribute. The rules are in rules.js; what is drawn on the map is in
// map-layer.js.
import { app } from "../../app/state.js";
import { escapeHtml, findElement } from "../../app/dom.js";
import { save } from "../../app/saving.js";
import { renderMapPage } from "../../map/map-page.js";
import { partsOnMap } from "../tasks/task-list.js";
import { isInSquad, allFriends, friendsShowingTasks, friendsAlsoDoingTask } from "./friends.js";
import { renderFriendDrawingsOf } from "./map-layer.js";
import {
  safeFriendColor,
  friendDisplayName,
  friendStatusText,
  friendPrefsOf,
  setFriendPref,
  friendTasksOf,
  friendsOwnTasksOnMap,
  isSharedOnlyFilterOn,
  setSharedOnlyFilter,
  alsoText,
  progressSummaryText,
} from "./rules.js";

/** @import { SquadFriend } from "../../app/types.js" */
/** @import { Task, Part } from "../../app/types.js" */

const CHIPS_SECTION_ID = "squad-section";

// ---------------------------------------------------------------- the chips and the filter

/**
 * The Squad section at the top of the Tasks tab: one chip per friend and "Shared with squad".
 * Always one element (empty when you aren't in a squad or have no friends yet), so it can be
 * replaced on its own when a friend comes online or goes away.
 */
export function renderSquadSection() {
  return `<div id="${CHIPS_SECTION_ID}">${renderSquadSectionContent()}</div>`;
}

function renderSquadSectionContent() {
  const friends = allFriends();
  if (!friends.length) return "";
  const chips = friends.map(renderFriendChip).join("");
  return `<div class="sec squad"><h4>Squad</h4><div class="squad-chips">${chips}</div>
    <div class="tools">${renderSharedOnlyChip()}</div></div>`;
}

/**
 * Redraw just the chips (a friend came online or went away). The rest of the panel, and whatever
 * you are typing in it, stays as it is.
 */
export function renderSquadChipsInPlace() {
  const section = findElement("#" + CHIPS_SECTION_ID);
  if (section) section.innerHTML = renderSquadSectionContent();
}

/** @param {SquadFriend} friend */
function renderFriendChip(friend) {
  const prefs = friendPrefsOf(app.saved, friend.playerId);
  const id = escapeHtml(friend.playerId);
  const name = escapeHtml(friendDisplayName(friend.name));
  const isSharingTasks = friendTasksOf(friend) !== null;
  const tasksTitle = isSharingTasks ? `Show ${name}'s tasks` : `${name} isn't sharing tasks`;
  return `<div class="squad-chip${friend.online ? " online" : ""}" data-friend="${id}" style="--friend:${safeFriendColor(friend.color)}">
    <span class="squad-dot"></span>
    <span class="squad-who"><b class="squad-name">${name}</b><span class="squad-state">${escapeHtml(friendStatusText(friend, Date.now()))}</span></span>
    <button class="squad-toggle" data-squad-drawings="${id}" aria-pressed="${prefs.drawings}" title="Show ${name}'s drawings">✎ Draw</button>
    <button class="squad-toggle${isSharingTasks ? "" : " dim"}" data-squad-tasks="${id}" aria-pressed="${prefs.tasks}" title="${tasksTitle}">☰ Tasks</button>
  </div>`;
}

/** "Shared with squad" and how many of the tasks on this map a shown friend also has. */
function renderSharedOnlyChip() {
  const isOn = isSharedOnlyFilterOn(app.saved);
  const taskIds = new Set();
  for (const row of partsOnMap(app.mapView.key)) {
    if (friendsAlsoDoingTask(row.task.id).length) taskIds.add(row.task.id);
  }
  const count = taskIds.size ? ` <span class="n">${taskIds.size}</span>` : "";
  return `<button class="chip" data-act="squadonly" aria-pressed="${isOn}" title="Show only the tasks a friend whose tasks you show also has">👥 Shared with squad${count}</button>`;
}

// ---------------------------------------------------------------- the chips' clicks

/**
 * A friend's ✎ Draw toggle: their lines on the map appear or go. Only their layer is redrawn.
 * @param {HTMLElement} button
 */
export function onFriendDrawingsToggled(button) {
  const playerId = button.dataset.squadDrawings;
  const isOn = !friendPrefsOf(app.saved, playerId).drawings;
  setFriendPref(app.saved, playerId, "drawings", isOn);
  save();
  renderSquadChipsInPlace();
  renderFriendDrawingsOf(playerId);
}

/**
 * A friend's ☰ Tasks toggle: their tasks join (or leave) the badges, the "Also:" lines, the
 * filter, the "Friends' tasks" block and the map.
 * @param {HTMLElement} button
 */
export function onFriendTasksToggled(button) {
  const playerId = button.dataset.squadTasks;
  const isOn = !friendPrefsOf(app.saved, playerId).tasks;
  setFriendPref(app.saved, playerId, "tasks", isOn);
  save();
  renderMapPage();
}

/** "Shared with squad": only the tasks a shown friend also has, in the list and on the map. */
function onSharedOnlyClicked() {
  setSharedOnlyFilter(app.saved, !isSharedOnlyFilterOn(app.saved));
  save();
  renderMapPage();
}

/** The squad's buttons with a data-act, for the panel's click router. */
export const SQUAD_SECTION_ACTIONS = {
  squadonly: onSharedOnlyClicked,
};

// ---------------------------------------------------------------- "Also: Mike, Sam" and progress

/**
 * "Also: Mike, Sam" under a task row's name; "" when no shown friend has the task.
 * @param {string} taskId
 */
export function renderAlsoOnRow(taskId) {
  const text = alsoText(friendsAlsoDoingTask(taskId));
  return text ? `<span class="also">${escapeHtml(text)}</span>` : "";
}

/**
 * The popup's two squad lines: "Also: Mike, Sam" and each friend's progress on this part
 * ("Mike 2/5 · Sam ✓"). Nothing when no shown friend has the task.
 * @param {Task} task
 * @param {Part} part
 */
export function renderSquadLinesForPopup(task, part) {
  const friends = friendsAlsoDoingTask(task.id);
  if (!friends.length) return "";
  const also = escapeHtml(alsoText(friends));
  const progress = escapeHtml(progressSummaryText(part, task.id, friends));
  return `<div class="m squad-also">${also}</div><div class="m squad-progress">${progress}</div>`;
}

// ---------------------------------------------------------------- the "Friends' tasks" block

/**
 * The bottom of the list: for each friend whose tasks you show, the tasks on this map that you
 * don't have, with their progress. Read-only: you can't open, tick or move them, and they never
 * count for your readiness or Bring list.
 */
export function renderFriendsTasksSection() {
  const groups = friendsShowingTasks().map(renderFriendTasksGroup).filter(Boolean);
  if (!groups.length) return "";
  return `<div class="sec squad-tasks"><h4>Friends' tasks</h4>${groups.join("")}</div>`;
}

/**
 * @param {SquadFriend} friend
 * @returns {string} "" when the friend has nothing here
 */
function renderFriendTasksGroup(friend) {
  const theirTasks = friendsOwnTasksOnMap(friend, app.saved, app.taskById, app.mapView.key);
  if (!theirTasks.length) return "";
  const name = escapeHtml(friendDisplayName(friend.name));
  const rows = theirTasks.map(({ task, percent }) => renderFriendTaskRow(task, percent)).join("");
  return `<div class="squad-group" data-friend="${escapeHtml(friend.playerId)}" style="--friend:${safeFriendColor(friend.color)}">
    <div class="squad-grouphead"><span class="squad-dot"></span><b>${name}</b><small>${theirTasks.length} here</small></div>${rows}</div>`;
}

/**
 * @param {Task} task
 * @param {number} percent
 */
function renderFriendTaskRow(task, percent) {
  return `<div class="squad-task"><span class="nm">${escapeHtml(task.name)}<span class="tr">${escapeHtml(task.trader)}</span></span><span class="pct">${percent}%</span></div>`;
}
