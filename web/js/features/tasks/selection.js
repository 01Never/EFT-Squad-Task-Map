// @ts-check
// Selecting a part (2.0.1): its row opens with a white outline, its markers grow and flash, and the
// popup shows it. From the list, the map zooms to its spots; from a marker, the list scrolls to
// its row. Esc, a click on empty map or the popup's × deselects and closes the row.
import { app } from "../../app/state.js";
import { fitViewTo } from "../../map/view.js";
import { renderMapPage } from "../../map/map-page.js";
import { partsOnMap } from "./task-list.js";
import { spotsOfPart } from "./map-layer.js";
import { subTaskPinPoints } from "../sub-tasks/map-layer.js";

/** @import { MarkerItem } from "../../app/state.js" */

// Zooming to a selected part leaves 1/25 of the map's width around its spots.
const SELECTION_PADDING_MAP_WIDTH_PARTS = 25;

/**
 * Select a part from the list (a row, or an "other part" chip): zoom to its spots and sub-task pins.
 * Nothing happens when the part isn't on this map.
 * @param {string} partKey
 */
export function selectPartFromList(partKey) {
  const row = selectPart(partKey, null);
  if (!row) return;
  const mapView = app.mapView;
  const points = [...spotsOfPart(row.task, row.part), ...subTaskPinPoints(row.task.id)];
  if (!points.length) return;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  fitViewTo(box, mapView.homeView.w / SELECTION_PADDING_MAP_WIDTH_PARTS);
}

/**
 * Select the part of a marker you clicked: the popup shows that marker (a sub-task pin shows its
 * sub-task), and the list scrolls to the row.
 * @param {MarkerItem} marker
 */
export function selectPartFromMarker(marker) {
  const row = selectPart(marker.part.key, marker);
  if (!row) return;
  const rowElement = document.querySelector(`.task[data-part="${CSS.escape(marker.part.key)}"] .trow-wrap`);
  if (rowElement) rowElement.scrollIntoView({ block: "center", behavior: "smooth" });
}

/**
 * Make the part the selected and open one, and redraw. Returns its row, or null when it isn't on
 * the open map.
 * @param {string} partKey
 * @param {MarkerItem | null} marker
 */
function selectPart(partKey, marker) {
  const mapView = app.mapView;
  if (!mapView) return null;
  const row = partsOnMap(mapView.key).find((candidate) => candidate.part.key === partKey);
  if (!row) return null;
  mapView.selectedPartKey = partKey;
  mapView.expandedPartKey = partKey;
  mapView.popup = marker || { task: row.task, part: row.part };
  renderMapPage();
  return row;
}

/** Deselect: no flash, no popup, and the row it had opened closes (so the next click selects it again). */
export function deselectPart() {
  const mapView = app.mapView;
  mapView.selectedPartKey = null;
  mapView.expandedPartKey = null;
  mapView.popup = null;
  renderMapPage();
}

/** Forget the selection and the open row without redrawing (the caller redraws). */
export function clearSelectionAndOpenRow() {
  const mapView = app.mapView;
  mapView.selectedPartKey = null;
  mapView.expandedPartKey = null;
  mapView.popup = null;
}
