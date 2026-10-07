// @ts-check
// Tasks in the panel: each task row (or split part), its open details (objectives, sub-tasks,
// "Move to", Don't split, Remove), "Add a task by name", pins and "Pinned only", and the handlers
// for those. Categories and their menus are in category-panel.js.
import { app } from "../../app/state.js";
import { escapeHtml, findElement, showToast } from "../../app/dom.js";
import { save } from "../../app/saving.js";
import { mapDisplayName } from "../../app/game-data.js";
import { renderMapPage } from "../../map/map-page.js";
import { renderShapeSwatch } from "../../map/marker-shapes.js";
import { ACTION_LABELS, partLabel, mapsOfTask, isObjectiveOnMap, partProgressPercent, canTaskSplit } from "./rules.js";
import { isMovedByHand, movePartTo, resetPartCategory } from "./categories.js";
import { taskEntry, partsOf, partsOnMap, categoryOf, activateTask } from "./task-list.js";
import { selectPartFromList, clearSelectionAndOpenRow } from "./selection.js";
import { renderObjectiveLine, onTickCounterClicked } from "./objective-line.js";
import { isPartPossible, countKeysNeeded } from "../readiness/rules.js";
import { openMapKeyList } from "../keys/key-lists.js";
import { renderSubTasksBox } from "../sub-tasks/panel.js";
import { renderAlsoOnRow } from "../squad/panel.js";

/** @import { PartOnMap, Task } from "../../app/types.js" */

// ---------------------------------------------------------------- a task row

/**
 * A task's row (or one part's, when the task is split), with its details when it's open.
 * @param {PartOnMap} row
 */
export function renderTaskRow(row) {
  const mapView = app.mapView;
  const isOpen = mapView.expandedPartKey === row.part.key;
  const isSelected = mapView.selectedPartKey === row.part.key;
  const classes = `task${isSelected ? " sel" : ""}${row.done ? " isdone" : ""}`;
  const details = isOpen ? renderTaskDetails(row) : "";
  return `<div class="${classes}" data-part="${escapeHtml(row.part.key)}" data-task="${escapeHtml(row.task.id)}">
    <div class="trow-wrap">${renderRowButton(row)}${renderPinButton(row.task)}</div>${details}</div>`;
}

/** The clickable row: shape, name (and part), trader line, "!" when not ready, keys, progress. */
function renderRowButton(row) {
  const { task, part, cat } = row;
  const saved = app.saved;
  const isReady = row.done || isPartPossible(part, saved.ticks, saved.have, openMapKeyList());
  const keysNeeded = countKeysNeeded(task, part, app.mapView.key);
  const notReadyBadge = !isReady ? '<span class="bang" title="You don\'t have everything this needs">!</span>' : "";
  const keysBadge = keysNeeded ? `<span class="kb" title="Keys needed">🔑 ${keysNeeded}</span>` : "";
  const progress = row.done ? "✓" : partProgressPercent(part, saved.ticks) + "%";
  return `<button class="trow" data-act="open">${renderShapeSwatch(cat.icon, cat.color, 15)}<span class="nm">${renderRowName(row)}<span class="tr">${renderRowSubtitle(row)}</span>${renderAlsoOnRow(task.id)}</span>${notReadyBadge}${keysBadge}<span class="pct">${progress}</span></button>`;
}

/** The task's name, plus "◫ part 2/3" for a split part. */
function renderRowName(row) {
  const { task, part } = row;
  const partBadge = part.split
    ? ` <span class="partof" title="This task is split; this row is one part of it">◫ part ${part.index + 1}/${part.total}</span>`
    : "";
  return escapeHtml(task.name) + partBadge;
}

/** "Trader · kills · also Customs": the trader, the part's kind, and the task's other maps. */
function renderRowSubtitle(row) {
  const { task, part } = row;
  const otherMaps = otherMapNames(task);
  const kind = part.split ? " · " + escapeHtml(ACTION_LABELS[part.action]) : "";
  const alsoOn = otherMaps.length ? " · also " + escapeHtml(otherMaps.join(", ")) : "";
  return escapeHtml(task.trader) + kind + alsoOn;
}

/** @param {Task} task */
function otherMapNames(task) {
  return mapsOfTask(task)
    .filter((mapKey) => mapKey !== app.mapView.key)
    .map(mapDisplayName);
}

/** @param {Task} task */
function renderPinButton(task) {
  const entry = app.saved.tasks[task.id] || /** @type {any} */ ({});
  return `<button class="ib pinb${entry.pinned ? " on" : ""}" data-act="pin" title="${entry.pinned ? "Unpin" : "Pin"}">📌</button>`;
}

// ---------------------------------------------------------------- an open row

/** The open row: wiki link, notes about splitting and other maps, objectives, sub-tasks, actions. */
function renderTaskDetails(row) {
  return `<div class="tbody">
    ${renderDetailsTopLine(row.task)}
    ${renderSplitNote(row)}
    ${renderOtherMapsNote(row.task)}
    ${renderObjectiveList(row)}
    ${renderSubTasksBox(row.task)}
    ${renderDetailsActions(row)}
  </div>`;
}

/** @param {Task} task */
function renderDetailsTopLine(task) {
  const entry = app.saved.tasks[task.id] || /** @type {any} */ ({});
  const wiki = task.wiki
    ? `<a class="wiki" href="${escapeHtml(task.wiki)}" target="_blank" rel="noopener">📖 Wiki: ${escapeHtml(task.name)} ↗</a>`
    : "";
  const inGame = entry.gamePct != null ? `<span class="meta">in-game ${entry.gamePct}%</span>` : "";
  return `<div class="tb-top">${wiki}${inGame}</div>`;
}

/** For a split part: which part this is, and a chip per other part that jumps to it. */
function renderSplitNote(row) {
  const { task, part } = row;
  if (!part.split) return "";
  const otherParts = partsOf(task).filter((candidate) => candidate.key !== part.key);
  const chips = otherParts.map((otherPart) => {
    const category = categoryOf(task, otherPart);
    return `<button class="pchip" data-goto="${escapeHtml(otherPart.key)}" style="--pc:${category.color}">${escapeHtml(ACTION_LABELS[otherPart.action])} → ${escapeHtml(category.name)}</button>`;
  });
  return `<div class="meta">This task is split by kind of work. This row is <b>${escapeHtml(partLabel(part))}</b>. Other parts: ${chips.join(" ")}</div>`;
}

/** @param {Task} task */
function renderOtherMapsNote(task) {
  const otherMaps = otherMapNames(task);
  if (!otherMaps.length) return "";
  return `<div class="meta">Also on ${escapeHtml(otherMaps.join(", "))}; objectives elsewhere are greyed out.</div>`;
}

/** This map's objectives first, then the greyed-out ones on other maps. */
function renderObjectiveList(row) {
  const { task, part } = row;
  const mapKey = app.mapView.key;
  const here = part.objs.filter((objective) => isObjectiveOnMap(objective, mapKey, task));
  const away = part.objs.filter((objective) => !isObjectiveOnMap(objective, mapKey, task));
  const lines = here.map((objective) => renderObjectiveLine(objective)).join("") + away.map((objective) => renderObjectiveLine(objective, false)).join("");
  return `<ul class="objs">${lines}</ul>`;
}

/** "Move [this part] to …", reset, Don't split, Remove task. */
function renderDetailsActions(row) {
  const { task, part, cat } = row;
  const saved = app.saved;
  const entry = saved.tasks[task.id] || /** @type {any} */ ({});
  const options = saved.cats
    .map((category) => `<option value="${escapeHtml(category.id)}" ${category.id === cat.id ? "selected" : ""}>${escapeHtml(category.name)}</option>`)
    .join("");
  const reset = isMovedByHand(saved, task, part)
    ? `<button class="lnk" data-act="unmove" title="Put it back in its default category">reset</button>`
    : "";
  const dontSplit = canTaskSplit(task)
    ? `<label class="chk"><input type="checkbox" data-nosplit="${escapeHtml(task.id)}" ${entry.noSplit ? "checked" : ""}> Don't split</label>`
    : "";
  return `<div class="acts">Move ${part.split ? "this part" : ""} to <select data-move="${escapeHtml(part.key)}">${options}</select>
      ${reset}
      ${dontSplit}
      <button class="btn sm danger" data-act="remove" style="margin-left:auto" title="Take this task off your list">Remove task</button></div>`;
}

// ---------------------------------------------------------------- add a task by name

/** The "Add a task by name…" box, with every task not on your list as a suggestion. */
export function renderAddTaskBox() {
  const saved = app.saved;
  const notOnList = app.gameData.tasks.filter((task) => !(saved.tasks[task.id] && saved.tasks[task.id].active));
  const suggestions = notOnList.map((task) => `<option value="${escapeHtml(task.name)}">`).join("");
  return `<input type="search" id="addtask" list="alltasks" placeholder="Add a task by name…" autocomplete="off"><datalist id="alltasks">${suggestions}</datalist>`;
}

/**
 * Add the task with this name (typed, so misspellings are matched like scanned names).
 * @param {string} typedName
 */
export function addTaskByName(typedName) {
  const name = String(typedName || "").trim();
  if (!name) return;
  const matched = app.taskNameMatcher.match(name);
  if (!matched) {
    showToast(`No task called “${name}”`);
    return;
  }
  const task = matched.task;
  if (app.saved.tasks[task.id] && app.saved.tasks[task.id].active) {
    showToast(`“${task.name}” is already on your list`);
    return;
  }
  activateTask(task.id, "manual");
  save();
  const isOnThisMap = partsOnMap(app.mapView.key).some((row) => row.task.id === task.id);
  renderMapPage();
  const maps = mapsOfTask(task).map(mapDisplayName).join(", ") || "no map (hand-in / build)";
  showToast(isOnThisMap ? `Added “${task.name}”` : `Added “${task.name}” — it's on ${maps}`);
  const input = findElement("#addtask");
  if (input) input.value = "";
}

// ---------------------------------------------------------------- pins

/** The "📌 Pinned only" chip and toolbar button: only pinned tasks in the list, on the map and in the Bring list. */
export function togglePinnedOnly() {
  app.saved.pinnedOnly = !app.saved.pinnedOnly;
  save();
  renderMapPage();
}

/** @param {HTMLElement} button */
function onPinClicked(button) {
  const entry = taskEntry(button.closest(".task").getAttribute("data-task"));
  entry.pinned = !entry.pinned;
  save();
  renderMapPage();
}

function onClearPinsClicked() {
  for (const entry of Object.values(app.saved.tasks)) entry.pinned = false;
  save();
  renderMapPage();
}

// ---------------------------------------------------------------- row handlers

/** A row was clicked: open (and select) it, or close it when it's open. */
function onRowClicked(button) {
  const partKey = button.closest(".task").getAttribute("data-part");
  if (app.mapView.expandedPartKey === partKey) {
    clearSelectionAndOpenRow();
    renderMapPage();
  } else {
    selectPartFromList(partKey);
  }
}

/** An "other part" chip in a split task's details. */
export function onOtherPartClicked(button) {
  const partKey = button.dataset.goto;
  const isOnThisMap = partsOnMap(app.mapView.key).some((row) => row.part.key === partKey);
  if (isOnThisMap) selectPartFromList(partKey);
  else showToast("That part isn't on this map");
}

/** − or + on an objective counter in the list. */
export function onCounterButtonClicked(button) {
  onTickCounterClicked(button.dataset.obj, +button.dataset.tick);
}

/** "reset": back to the default category. */
function onResetCategoryClicked(button) {
  const row = button.closest(".task");
  const entry = taskEntry(row.getAttribute("data-task"));
  resetPartCategory(entry, row.getAttribute("data-part"));
  save();
  renderMapPage();
}

/** "Remove task": off the list (a scan or accepting it in the game brings it back). */
function onRemoveTaskClicked(button) {
  const taskId = button.closest(".task").getAttribute("data-task");
  const task = app.taskById[taskId];
  if (!confirm(`Take “${task.name}” off your list? (A scan or accepting it in-game brings it back.)`)) return;
  app.saved.tasks[taskId].active = false;
  app.saved.tasks[taskId].pinned = false;
  clearSelectionAndOpenRow();
  save();
  renderMapPage();
}

/**
 * "Move to" picked a category.
 * @param {HTMLSelectElement} select its data-move is the part key
 */
export function onMoveToChanged(select) {
  const partKey = select.dataset.move;
  const [taskId] = partKey.split(":");
  const entry = taskEntry(taskId);
  entry.partCats = entry.partCats || {};
  const part = partsOf(app.taskById[taskId]).find((candidate) => candidate.key === partKey);
  movePartTo(entry, partKey, part, select.value);
  save();
  renderMapPage();
}

/**
 * "Don't split" ticked or unticked: the rows change, so nothing stays selected.
 * @param {HTMLInputElement} checkbox
 */
export function onDontSplitChanged(checkbox) {
  const entry = taskEntry(checkbox.dataset.nosplit);
  entry.noSplit = checkbox.checked;
  clearSelectionAndOpenRow();
  save();
  renderMapPage();
}

/** The task rows' buttons with a data-act, for the panel's click router. */
export const TASK_ROW_ACTIONS = {
  open: onRowClicked,
  pin: onPinClicked,
  pinnedonly: togglePinnedOnly,
  clearpins: onClearPinsClicked,
  unmove: onResetCategoryClicked,
  remove: onRemoveTaskClicked,
};
