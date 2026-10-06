// @ts-check
// Drawing on the map (✎ Draw): your saved lines in their layer, the drawing bar (colours, width,
// undo/redo, clear, show), and drawing a line with the mouse or a finger. map/input.js passes the
// pointer events here while the map is in draw mode. The rules are in rules.js.
import { app } from "../../app/state.js";
import { findElement, createSvgElement } from "../../app/dom.js";
import { save } from "../../app/saving.js";
import { mapPrefs } from "../../app/map-prefs.js";
import { clientToSvgPoint, svgUnitsPerPixel } from "../../map/view.js";
import { setMapMode } from "../../map/map-page.js";
import { DRAW_COLORS, DRAW_WIDTH_MIN_PIXELS, DRAW_WIDTH_MAX_PIXELS, strokeForSaving } from "./rules.js";

/** Your saved lines on this map (nothing when "Show" is off). */
export function renderDrawings() {
  const mapView = app.mapView;
  const layer = mapView.layers.drawings;
  layer.innerHTML = "";
  if (!mapPrefs(mapView.key).drawOn) return;
  const projection = mapView.projection;
  for (const stroke of app.saved.draw[mapView.key] || []) {
    const points = stroke.pts.map((point) => projection.toSvg(point[0], point[1]).map((value) => value.toFixed(2)).join(",")).join(" ");
    createSvgElement(
      "polyline",
      { points, fill: "none", stroke: stroke.c, "stroke-width": stroke.w * projection.unit, "stroke-linecap": "round", "stroke-linejoin": "round" },
      layer,
    );
  }
}

// ---------------------------------------------------------------- the drawing bar

/** The drawing bar, while draw mode is on. */
export function renderDrawingBar() {
  const bar = findElement("#drawbar");
  const mapView = app.mapView;
  const saved = app.saved;
  if (!bar || bar.hidden) return;
  const strokes = saved.draw[mapView.key] || [];
  const colorButtons = DRAW_COLORS.map(
    (color) => `<button class="sw" data-c="${color}" style="background:${color}" aria-pressed="${saved.dcolor === color}" title="${color}"></button>`,
  ).join("");
  bar.innerHTML =
    colorButtons +
    `<input type="color" id="dcol" value="${saved.dcolor}" title="Custom colour"><input type="range" id="dw" min="${DRAW_WIDTH_MIN_PIXELS}" max="${DRAW_WIDTH_MAX_PIXELS}" value="${saved.dwidth}" title="Line width"><button id="dundo" ${strokes.length ? "" : "disabled"}>↶ Undo</button><button id="dredo" ${mapView.redoStrokes.length ? "" : "disabled"}>↷ Redo</button><button id="dclear">Clear</button><button id="dshow" aria-pressed="${mapPrefs(mapView.key).drawOn}">Show</button>`;
}

/**
 * A click on the drawing bar: a colour, Undo, Redo, Clear (after a confirm) or Show. Every click
 * saves and redraws the bar and the lines.
 * @param {MouseEvent} event
 */
function onDrawingBarClicked(event) {
  const button = /** @type {HTMLElement} */ (event.target).closest("button");
  if (!button) return;
  const mapView = app.mapView;
  const saved = app.saved;
  if (button.dataset.c) saved.dcolor = button.dataset.c;
  else if (button.id === "dundo") undoStroke();
  else if (button.id === "dredo") redoStroke();
  else if (button.id === "dclear") clearStrokesAfterConfirm();
  else if (button.id === "dshow") mapPrefs(mapView.key).drawOn = !mapPrefs(mapView.key).drawOn;
  save();
  renderDrawingBar();
  renderDrawings();
}

/** "Clear": every line on this map goes, after a confirm (and can't be redone). */
function clearStrokesAfterConfirm() {
  const mapView = app.mapView;
  const strokes = app.saved.draw[mapView.key] || [];
  if (strokes.length && confirm("Clear all your drawings on this map?")) {
    mapView.redoStrokes = [];
    app.saved.draw[mapView.key] = [];
  }
}

/**
 * The custom colour picker and the width slider change as you move them.
 * @param {Event} event
 */
function onDrawingBarInput(event) {
  const field = /** @type {HTMLInputElement} */ (event.target);
  if (field.id === "dcol") app.saved.dcolor = field.value;
  if (field.id === "dw") app.saved.dwidth = +field.value;
  save();
}

/** Wire up the ✎ Draw button and the drawing bar. Called when a map opens. */
export function bindDrawing() {
  findElement("#bdraw").onclick = () => setMapMode(app.mapView.mode === "draw" ? "pan" : "draw");
  findElement("#drawbar").addEventListener("click", onDrawingBarClicked);
  findElement("#drawbar").addEventListener("input", onDrawingBarInput);
}

// ---------------------------------------------------------------- undo and redo (also Ctrl+Z / Ctrl+Shift+Z)

/** Take back the last line on this map (it can be redone). */
export function undoStroke() {
  const mapView = app.mapView;
  const strokes = app.saved.draw[mapView.key] || [];
  if (!strokes.length) return;
  mapView.redoStrokes.push(strokes.pop());
  save();
  renderDrawings();
  renderDrawingBar();
}

/** Put back the last line that was taken back. */
export function redoStroke() {
  const mapView = app.mapView;
  if (!mapView.redoStrokes.length) return;
  const saved = app.saved;
  (saved.draw[mapView.key] = saved.draw[mapView.key] || []).push(mapView.redoStrokes.pop());
  save();
  renderDrawings();
  renderDrawingBar();
}

// ---------------------------------------------------------------- drawing a line

/**
 * A finger or the mouse went down in draw mode: start a line, at the chosen width in screen pixels.
 * @param {number} clientX
 * @param {number} clientY
 */
export function startStroke(clientX, clientY) {
  const mapView = app.mapView;
  const saved = app.saved;
  const [svgX, svgY] = clientToSvgPoint(clientX, clientY);
  const widthSvgUnits = +(saved.dwidth * svgUnitsPerPixel()).toFixed(3);
  const element = createSvgElement(
    "polyline",
    { fill: "none", stroke: saved.dcolor, "stroke-width": widthSvgUnits, "stroke-linecap": "round", "stroke-linejoin": "round" },
    mapView.layers.drawings,
  );
  mapView.strokeInProgress = { pts: [[svgX, svgY]], w: widthSvgUnits, c: saved.dcolor, el: element };
}

/**
 * The pointer moved while drawing: the line follows it.
 * @param {number} clientX
 * @param {number} clientY
 */
export function extendStroke(clientX, clientY) {
  const stroke = app.mapView.strokeInProgress;
  stroke.pts.push(clientToSvgPoint(clientX, clientY));
  stroke.el.setAttribute("points", stroke.pts.map((point) => point.join(",")).join(" "));
}

/** The pointer was released: save the line (simplified, in game coordinates). Redo starts over. */
export function finishStroke() {
  const mapView = app.mapView;
  const stroke = mapView.strokeInProgress;
  const saved = app.saved;
  const strokeToSave = strokeForSaving(stroke.pts, stroke.w, stroke.c, mapView.projection);
  (saved.draw[mapView.key] = saved.draw[mapView.key] || []).push(strokeToSave);
  mapView.redoStrokes = [];
  mapView.strokeInProgress = null;
  save();
  renderDrawings();
  renderDrawingBar();
}

/** A second finger (pinch) or a cancelled pointer: the line being drawn is dropped. */
export function cancelStroke() {
  const mapView = app.mapView;
  if (!mapView.strokeInProgress) return;
  mapView.strokeInProgress.el.remove();
  mapView.strokeInProgress = null;
}
