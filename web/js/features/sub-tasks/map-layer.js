// @ts-check
// Sub-tasks on the map: a small pin for each sub-task placed on this map (drawn with the task
// markers, in its task's look), and placing a pin with a click ("Pin" / "Move pin" in the list).
import { app } from "../../app/state.js";
import { showToast } from "../../app/dom.js";
import { save } from "../../app/saving.js";
import { clientToSvgPoint } from "../../map/view.js";
import { setMapMode, renderMapPage } from "../../map/map-page.js";

/** @import { PartOnMap, SubTask } from "../../app/types.js" */
/** @import { MarkerItem } from "../../app/state.js" */

/**
 * Whether a sub-task has a pin on this map.
 * @param {SubTask} subTask
 * @param {string} mapKey
 */
export function isPinnedOnMap(subTask, mapKey) {
  return subTask.map === mapKey && subTask.x != null;
}

/**
 * A marker item per sub-task pinned on the open map, for tasks with a part shown on it (the pin
 * takes that part's category look). Hidden tasks hide their pins too.
 * @param {Map<string, PartOnMap>} firstShownRowByTask
 * @returns {MarkerItem[]}
 */
export function subTaskMarkerItems(firstShownRowByTask) {
  const mapView = app.mapView;
  const items = [];
  for (const subTask of app.saved.subs) {
    if (subTask.map !== mapView.key || subTask.x == null) continue;
    const row = firstShownRowByTask.get(subTask.task);
    if (!row) continue;
    const [x, y] = mapView.projection.toSvg(subTask.x, subTask.z);
    items.push({
      x,
      y,
      kind: "sub",
      f: subTask.f || null,
      task: row.task,
      part: row.part,
      sub: subTask,
      icon: row.cat.icon,
      color: row.cat.color,
      done: subTask.done,
    });
  }
  return items;
}

/**
 * Where a task's sub-task pins are on the open map (SVG), so selecting the task shows them too.
 * @param {string} taskId
 * @returns {{ x: number, y: number }[]}
 */
export function subTaskPinPoints(taskId) {
  const mapView = app.mapView;
  return app.saved.subs
    .filter((subTask) => subTask.task === taskId && isPinnedOnMap(subTask, mapView.key))
    .map((subTask) => {
      const [x, y] = mapView.projection.toSvg(subTask.x, subTask.z);
      return { x, y };
    });
}

/**
 * The map was clicked while placing a sub-task's pin: pin it there (game position, 2 decimals),
 * then go back to panning.
 * @param {number} clientX
 * @param {number} clientY
 */
export function placeSubTaskPinAt(clientX, clientY) {
  const mapView = app.mapView;
  const [svgX, svgY] = clientToSvgPoint(clientX, clientY);
  const [gameX, gameZ] = mapView.projection.toGame(svgX, svgY);
  const subTask = app.saved.subs.find((candidate) => candidate.id === mapView.placingSubTaskId);
  if (subTask) {
    subTask.map = mapView.key;
    subTask.x = +gameX.toFixed(2);
    subTask.z = +gameZ.toFixed(2);
    save();
  }
  setMapMode("pan");
  mapView.placingSubTaskId = null;
  renderMapPage();
  showToast("Marker placed");
}
