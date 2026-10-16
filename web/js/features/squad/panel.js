// @ts-check
// Squad in the right-hand panel and the task popup: a chip per friend (colour dot, name, "online"
// or "last seen 2 h", "on Customs" while their position is on another map, and three toggles:
// drawings, tasks and position), the "Shared with squad" filter, who has a task (a colour box and
// name per friend) on rows and in the popup, and per-friend progress in the popup. Squadmates'
// tasks you don't have are rows of the task list itself (ticket 26: features/tasks, rows from
// friends.js friendOnlyPartsOnMap). Every friend text goes through escapeHtml(),
// every colour through safeFriendColor(); a friend's name or colour never goes into a script, a
// URL or an unescaped attribute. The rules are in rules.js; what is drawn on the map is in
// map-layer.js.
import { app } from "../../app/state.js";
import { shownGameMode } from "../../app/current-list.js";
import { escapeHtml, findElement } from "../../app/dom.js";
import { save } from "../../app/saving.js";
import { renderMapPage } from "../../map/map-page.js";
import { partsOnMap } from "../tasks/task-list.js";
import {
  allFriends,
  friendsAlsoDoingTask,
  friendBoxesForTask,
  canSquadFilterApply,
  isSquadFilterInEffect,
} from "./friends.js";
import { renderFriendDrawingsOf, renderFriendPlayersAndApplyView } from "./map-layer.js";
import { warnOnce } from "./safe.js";
import {
  safeFriendColor,
  friendDisplayName,
  friendStatusText,
  friendPrefsOf,
  setFriendPref,
  friendTasksOf,
  friendTasksButtonTitle,
  isSharedOnlyFilterOn,
  setSharedOnlyFilter,
  progressPieces,
  currentFriendPosition,
  friendElsewhereText,
} from "./rules.js";

/** @import { SquadFriend } from "../../app/types.js" */
/** @import { Task, Part } from "../../app/types.js" */

const CHIPS_SECTION_ID = "squad-section";

// Why "Shared with squad" can't be used: it would hide every task you have.
const SHARED_ONLY_UNAVAILABLE_TITLE =
  "Nobody whose tasks you show is sharing them yet. Switch on a friend's ☰ Tasks " +
  "(they turn on Share my tasks in their Settings)";
const SHARED_ONLY_TITLE = "Show only the tasks a friend whose tasks you show also has";

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
  const chips = friends.map((friend) => skipOnError("chip", () => renderFriendChip(friend))).join("");
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

/**
 * Run one friend's rendering; a friend whose data breaks it is skipped ("") and noted once.
 * @param {string} what
 * @param {() => string} render
 */
function skipOnError(what, render) {
  try {
    return render();
  } catch (error) {
    warnOnce(what, error);
    return "";
  }
}

/** @param {SquadFriend} friend */
function renderFriendChip(friend) {
  const nowMs = Date.now();
  const prefs = friendPrefsOf(app.saved, friend.playerId);
  const id = escapeHtml(friend.playerId);
  const name = escapeHtml(friendDisplayName(friend.name));
  const myMode = shownGameMode();
  const isSharingTasks = friendTasksOf(friend, myMode) !== null;
  const tasksTitle = escapeHtml(friendTasksButtonTitle(friend, myMode));
  return `<div class="squad-chip${friend.online ? " online" : ""}" data-friend="${id}" style="--friend:${safeFriendColor(friend.color)}">
    <span class="squad-chip-dot"></span>
    <span class="squad-who"><b class="squad-name"><bdi>${name}</bdi></b><span class="squad-state">${escapeHtml(friendStatusText(friend, nowMs))}${renderElsewhere(friend, nowMs)}</span></span>
    <button class="squad-toggle" data-squad-drawings="${id}" aria-pressed="${prefs.drawings}" title="Show ${name}'s drawings">✎ Draw</button>
    <button class="squad-toggle${isSharingTasks ? "" : " dim"}" data-squad-tasks="${id}" aria-pressed="${prefs.tasks}" title="${tasksTitle}">☰ Tasks</button>
    ${renderPositionToggle(friend, prefs.position, nowMs)}
  </div>`;
}

/**
 * The chip's ◎ Pos switch (ticket 17): dimmed, like ☰ Tasks, while the friend has no position to
 * show (out of raid, not sharing it, or over 30 minutes old).
 * @param {SquadFriend} friend
 * @param {boolean} isOn
 * @param {number} nowMs
 */
function renderPositionToggle(friend, isOn, nowMs) {
  const id = escapeHtml(friend.playerId);
  const name = escapeHtml(friendDisplayName(friend.name));
  const hasPosition = currentFriendPosition(friend, nowMs) !== null;
  const title = hasPosition
    ? `Show ${name}'s position`
    : `${name} has no recent position (not in a raid, or not sharing it)`;
  return `<button class="squad-toggle${hasPosition ? "" : " dim"}" data-squad-position="${id}"
    aria-pressed="${isOn}" title="${title}">◎ Pos</button>`;
}

/**
 * " · on Customs" after the chip's status while the friend's position is on another map; "".
 * @param {SquadFriend} friend
 * @param {number} nowMs
 */
function renderElsewhere(friend, nowMs) {
  const mapKey = app.mapView ? app.mapView.key : null;
  const text = friendElsewhereText(friend, app.saved, mapKey, mapNameByKey(), nowMs);
  return text ? `<span class="squad-where"> · ${escapeHtml(text)}</span>` : "";
}

/**
 * The maps' display names by key, from maps-config.json ("customs" → "Customs").
 * @returns {Record<string, string>}
 */
function mapNameByKey() {
  /** @type {Record<string, string>} */
  const names = {};
  for (const config of app.mapConfigs) names[config.key] = config.name;
  return names;
}

/**
 * "Shared with squad" and how many of the tasks on this map a shown friend also has. Greyed out
 * (and never shown as on) while no friend you show shares tasks: then it filters nothing.
 */
function renderSharedOnlyChip() {
  if (!canSquadFilterApply()) {
    return `<button class="chip" data-act="squadonly" aria-pressed="false" disabled title="${SHARED_ONLY_UNAVAILABLE_TITLE}">👥 Shared with squad</button>`;
  }
  const isOn = isSquadFilterInEffect();
  const taskIds = new Set();
  for (const row of partsOnMap(app.mapView.key)) {
    if (friendsAlsoDoingTask(row.task.id).length) taskIds.add(row.task.id);
  }
  const count = taskIds.size ? ` <span class="n">${taskIds.size}</span>` : "";
  return `<button class="chip" data-act="squadonly" aria-pressed="${isOn}" title="${SHARED_ONLY_TITLE}">👥 Shared with squad${count}</button>`;
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
 * A friend's ☰ Tasks toggle: their tasks join (or leave) the badges, the colour boxes on rows,
 * the filter, the rows of their tasks you don't have, and the map.
 * @param {HTMLElement} button
 */
export function onFriendTasksToggled(button) {
  const playerId = button.dataset.squadTasks;
  const isOn = !friendPrefsOf(app.saved, playerId).tasks;
  setFriendPref(app.saved, playerId, "tasks", isOn);
  save();
  renderMapPage();
}

/**
 * A friend's ◎ Pos toggle (ticket 17): their position on the map (and "on Customs" on their chip)
 * appears or goes. Only the chips and the positions layer are redrawn.
 * @param {HTMLElement} button
 */
export function onFriendPositionToggled(button) {
  const playerId = button.dataset.squadPosition;
  const isOn = !friendPrefsOf(app.saved, playerId).position;
  setFriendPref(app.saved, playerId, "position", isOn);
  save();
  renderSquadChipsInPlace();
  renderFriendPlayersAndApplyView();
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

// ---------------------------------------------------------------- who has it, and progress

/**
 * Who has this task, under a task row's name (ticket 26): a colour box and a name per shown
 * friend who has it. "" when nobody does.
 * @param {string} taskId
 */
export function renderFriendBoxesOnRow(taskId) {
  return skipOnError("friend boxes", () => {
    const boxes = friendBoxesForTask(taskId);
    return boxes.length ? `<span class="squad-boxes">${boxes.map(renderFriendBox).join("")}</span>` : "";
  });
}

/**
 * One friend's box: their colour (already checked by safeFriendColor) and their name, isolated.
 * @param {{ playerId: string, name: string, color: string }} box
 */
function renderFriendBox(box) {
  const id = escapeHtml(box.playerId);
  return `<span class="squad-box" data-friend="${id}" style="--friend:${box.color}"><span class="squad-swatch"></span><bdi>${escapeHtml(box.name)}</bdi></span>`;
}

/**
 * The popup's two squad lines: who has the task (colour boxes) and each friend's progress on this
 * part ("Mike 2/5 · Sam ✓"). Nothing when no shown friend has the task.
 * @param {Task} task
 * @param {Part} part
 */
export function renderSquadLinesForPopup(task, part) {
  return skipOnError("popup lines", () => {
    const boxes = friendBoxesForTask(task.id);
    if (!boxes.length) return "";
    const progress = progressPieces(part, task.id, friendsAlsoDoingTask(task.id))
      .map((piece) => `<bdi>${escapeHtml(piece.name)}</bdi> ${escapeHtml(piece.text)}`)
      .join(" · ");
    const boxesHtml = boxes.map(renderFriendBox).join("");
    return `<div class="m squad-boxes">${boxesHtml}</div><div class="m squad-progress">${progress}</div>`;
  });
}
