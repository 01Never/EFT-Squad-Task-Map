// @ts-check
// Sub-tasks in the panel: the "Sub-tasks" box in an open task row (each note with done, floor,
// Pin / Move pin, remove pin, delete; and "Add a sub-task…"), and the handlers for them.
import { app } from "../../app/state.js";
import { escapeHtml, findElement } from "../../app/dom.js";
import { save } from "../../app/saving.js";
import { newId } from "../../app/saved-data.js";
import { mapDisplayName } from "../../app/game-data.js";
import { renderMapPage, setMapMode } from "../../map/map-page.js";
import { renderPanel } from "../../panel/panel.js";
import { SUB_TASK_FLOOR_OPTIONS, SUB_TASK_MAX_LENGTH, newSubTask, unpinSubTask, pinPlace } from "./rules.js";

/** @import { Task, SubTask } from "../../app/types.js" */

// The panel sits under the map below this width (the same breakpoint as the CSS): placing a pin
// scrolls up to the map first.
const NARROW_LAYOUT = "(max-width:860px)";

/**
 * The "Sub-tasks" box of an open task row.
 * @param {Task} task
 */
export function renderSubTasksBox(task) {
  const subTasks = app.saved.subs.filter((subTask) => subTask.task === task.id);
  return `<div class="subs"><h5>Sub-tasks</h5>${subTasks.map(renderSubTaskRow).join("")}
      <div class="addsub"><input type="text" placeholder="Add a sub-task…" data-addsub="${escapeHtml(task.id)}" maxlength="${SUB_TASK_MAX_LENGTH}"><button class="btn sm" data-act="addsub">Add</button></div></div>`;
}

/**
 * One sub-task: done box, text ("pinned on Customs" when its pin is on another map), floor,
 * Pin / Move pin, remove pin (when pinned here), delete.
 * @param {SubTask} subTask
 */
function renderSubTaskRow(subTask) {
  const place = pinPlace(subTask, app.mapView.key);
  const elsewhere = place === "elsewhere" ? ` <span class="tag">pinned on ${escapeHtml(mapDisplayName(subTask.map))}</span>` : "";
  const removePin = place === "here" ? '<button class="ib" data-act="unpinsub" title="Remove marker">⌫</button>' : "";
  return `<div class="sub${subTask.done ? " done" : ""}" data-sub="${subTask.id}"><input type="checkbox" ${subTask.done ? "checked" : ""} data-act="subdone" title="Done"><span class="t">${escapeHtml(subTask.text)}${elsewhere}</span>
  ${renderFloorSelect(subTask)}
  <button class="btn sm line" data-act="place">${place === "here" ? "Move pin" : "Pin"}</button>${removePin}<button class="ib" data-act="delsub" title="Delete sub-task">✕</button></div>`;
}

/** The floor badge for the pin ("G" = ground). */
function renderFloorSelect(subTask) {
  const options = SUB_TASK_FLOOR_OPTIONS.map(
    (floor) => `<option value="${floor}" ${(subTask.f || "") === floor ? "selected" : ""}>${floor || "G"}</option>`,
  ).join("");
  return `<select data-subfloor title="Floor badge for this marker">${options}</select>`;
}

// ---------------------------------------------------------------- handlers

/**
 * The sub-task a button or field belongs to.
 * @param {Element} element
 */
function subTaskAround(element) {
  const id = element.closest("[data-sub]").getAttribute("data-sub");
  return app.saved.subs.find((subTask) => subTask.id === id);
}

/** "Add" (or Enter in the box): a new sub-task under this task; the box keeps focus. */
function onAddClicked(button) {
  const taskRow = button.closest(".task");
  const taskId = taskRow.getAttribute("data-task");
  const input = taskRow.querySelector("[data-addsub]");
  const text = input.value.trim();
  if (!text) return;
  app.saved.subs.push(newSubTask(newId(), taskId, text));
  save();
  renderPanel();
  findElement("#panel").querySelector(`[data-addsub="${CSS.escape(taskId)}"]`)?.focus();
}

/** @param {HTMLInputElement} checkbox */
function onDoneClicked(checkbox) {
  subTaskAround(checkbox).done = checkbox.checked;
  save();
  renderMapPage();
}

function onDeleteClicked(button) {
  const id = button.closest("[data-sub]").getAttribute("data-sub");
  app.saved.subs = app.saved.subs.filter((subTask) => subTask.id !== id);
  save();
  renderMapPage();
}

function onRemovePinClicked(button) {
  unpinSubTask(subTaskAround(button));
  save();
  renderMapPage();
}

/** "Pin" / "Move pin": the next click on the map places it (map/input.js → placeSubTaskPinAt). */
function onPinClicked(button) {
  app.mapView.placingSubTaskId = button.closest("[data-sub]").getAttribute("data-sub");
  setMapMode("place");
  if (matchMedia(NARROW_LAYOUT).matches) scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * The floor badge picked.
 * @param {HTMLSelectElement} select
 */
export function onFloorChanged(select) {
  subTaskAround(select).f = select.value;
  save();
  renderMapPage();
}

/**
 * Enter in "Add a sub-task…" works like the Add button.
 * @param {HTMLInputElement} input
 */
export function onAddBoxEnter(input) {
  input.closest(".task").querySelector('[data-act="addsub"]').click();
}

/** The sub-task buttons with a data-act, for the panel's click router. */
export const SUB_TASK_ACTIONS = {
  addsub: onAddClicked,
  subdone: onDoneClicked,
  delsub: onDeleteClicked,
  unpinsub: onRemovePinClicked,
  place: onPinClicked,
};
