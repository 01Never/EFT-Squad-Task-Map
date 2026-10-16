// @ts-check
// The popup at the bottom right of the map for the selected part (or the marker you clicked):
// name, trader, category and progress, Wiki and Pin buttons, the sub-task you clicked, and its
// objectives on this map with their tick controls.
import { app } from "../../app/state.js";
import { currentList } from "../../app/current-list.js";
import { escapeHtml, findElement } from "../../app/dom.js";
import { save } from "../../app/saving.js";
import { renderMapPage } from "../../map/map-page.js";
import { partLabel, partProgressPercent, isObjectiveOnMap, togglePinnedTask } from "./rules.js";
import { listedPartsOnMap } from "./task-list.js";
import { deselectPart } from "./selection.js";
import { renderObjectiveLine, onTickBoxChanged, onTickCounterClicked } from "./objective-line.js";
import { renderSquadLinesForPopup } from "../squad/panel.js";

/** @import { PartOnMap } from "../../app/types.js" */

/** Show the popup for the selected part, or hide it when nothing is selected. */
export function renderPopup() {
  const mapView = app.mapView;
  const popup = findElement("#pop");
  if (!popup) return;
  const row = mapView.popup && mapView.selectedPartKey && listedPartsOnMap(mapView.key).find((candidate) => candidate.part.key === mapView.selectedPartKey);
  if (!row) {
    popup.style.display = "none";
    return;
  }
  popup.style.setProperty("--c", row.cat.color);
  popup.style.display = "block";
  popup.innerHTML = renderPopupContent(row);
}

/** @param {PartOnMap} row */
function renderPopupContent(row) {
  const { task, part, cat } = row;
  const mapView = app.mapView;
  const entry = currentList().tasks[task.id] || /** @type {any} */ ({});
  const partText = part.split ? " · " + escapeHtml(partLabel(part)) : "";
  const wiki = task.wiki ? `<a class="wiki" href="${escapeHtml(task.wiki)}" target="_blank" rel="noopener">📖 Wiki ↗</a>` : "";
  const clickedSubTask = "sub" in mapView.popup && mapView.popup.sub;
  const subTaskLine = clickedSubTask ? `<div style="margin-bottom:6px;color:#fff">Sub-task: ${escapeHtml(clickedSubTask.text)}</div>` : "";
  const objectivesHere = part.objs.filter((objective) => isObjectiveOnMap(objective, mapView.key, task));
  // A squadmate's task you don't have (ticket 26): their progress is in the squad lines, not yours.
  const myProgress = row.notMine ? " · not on your list" : ` · ${partProgressPercent(part, currentList().ticks)}%`;
  const canTick = !row.notMine;
  const objectiveLines = objectivesHere.map((objective) => renderObjectiveLine(objective, true, canTick)).join("");
  return `<button class="x" title="Close">×</button><h3>${escapeHtml(task.name)}</h3><div class="m">${escapeHtml(task.trader)} · ${escapeHtml(cat.name)}${partText}${myProgress}</div>
    ${renderSquadLinesForPopup(task, part)}
    <div class="popacts">${wiki}<button class="btn sm line" data-pin="${escapeHtml(task.id)}">${entry.pinned ? "📌 Unpin" : "📌 Pin"}</button></div>
    ${subTaskLine}
    <ul class="objs">${objectiveLines}</ul>`;
}

/**
 * A click in the popup: × deselects; Pin pins or unpins the task; − / + count.
 * @param {MouseEvent} event
 */
function onPopupClicked(event) {
  const target = /** @type {Element} */ (event.target);
  if (target.closest(".x")) {
    deselectPart();
    return;
  }
  const pinButton = target.closest("[data-pin]");
  if (pinButton) {
    // also a squadmate's task you don't have: kept as a pin only (ticket 26)
    togglePinnedTask(currentList(), pinButton.getAttribute("data-pin"));
    save();
    renderMapPage();
    return;
  }
  const counterButton = /** @type {HTMLElement | null} */ (target.closest("[data-tick]"));
  if (counterButton) onTickCounterClicked(counterButton.dataset.obj, +counterButton.dataset.tick);
}

/**
 * A tick box in the popup changed.
 * @param {Event} event
 */
function onPopupChanged(event) {
  const checkbox = /** @type {HTMLInputElement | null} */ (/** @type {Element} */ (event.target).closest("[data-tickbox]"));
  if (checkbox) onTickBoxChanged(checkbox.dataset.tickbox, checkbox.checked);
}

/** Wire up the popup. Called when a map opens. */
export function bindPopup() {
  findElement("#pop").addEventListener("click", onPopupClicked);
  findElement("#pop").addEventListener("change", onPopupChanged);
}
