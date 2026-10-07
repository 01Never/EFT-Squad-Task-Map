// @ts-check
// Mouse, touch and keyboard on the map: drag to pan, wheel / pinch / buttons to zoom, and taps,
// which go to whoever owns what was tapped (a task marker, an extract, a sub-task pin being
// placed). In draw mode the pointer draws instead (features/drawing).
import { app } from "../app/state.js";
import { findElement } from "../app/dom.js";
import { applyViewSoon, fitViewTo, zoomViewAt, svgUnitsPerPixel, keepViewOnResize } from "./view.js";
import { setMapMode } from "./map-page.js";
import { startStroke, extendStroke, finishStroke, cancelStroke, undoStroke, redoStroke } from "../features/drawing/map-layer.js";
import { placeSubTaskPinAt } from "../features/sub-tasks/map-layer.js";
import { selectPartFromMarker, deselectPart } from "../features/tasks/selection.js";
import { onExtractTapped } from "../features/extracts/map-layer.js";
import { onLootTapped, closeLootPopup } from "../features/loot/map-layer.js";

// A press that moves less than this many pixels in total (all directions) is a tap, not a drag.
const TAP_MAX_MOVE_PIXELS = 7;

// A pinch adds this much movement, so it never ends as a tap.
const PINCH_COUNTS_AS_MOVED_PIXELS = 99;

// One wheel notch zooms by this factor; the + and − buttons by this one.
const WHEEL_ZOOM_STEP = 1.15;
const BUTTON_ZOOM_STEP = 1.4;

/**
 * The gesture in progress on the open map: where each finger or mouse button is, how far it moved
 * since going down, and the last pinch (distance and middle point). Reset when a map opens.
 */
let gesture = { pointers: new Map(), movedPixels: 0, pinch: null };

/** Wire up the map's mouse, touch, wheel, zoom buttons, keyboard and resizing. Called when a map opens. */
export function bindMapInput() {
  const mapView = app.mapView;
  const svg = mapView.svg;
  gesture = { pointers: new Map(), movedPixels: 0, pinch: null };
  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("pointercancel", onPointerCancel);
  svg.addEventListener("wheel", onWheel, { passive: false });
  /** @returns {[number, number]} the middle of the map area on screen */
  const centreOfMap = () => {
    const area = svg.getBoundingClientRect();
    return [area.left + area.width / 2, area.top + area.height / 2];
  };
  findElement("#zin").onclick = () => zoomViewAt(1 / BUTTON_ZOOM_STEP, ...centreOfMap());
  findElement("#zout").onclick = () => zoomViewAt(BUTTON_ZOOM_STEP, ...centreOfMap());
  findElement("#zfit").onclick = () => fitViewTo(mapView.homeView, 0);
  mapView.onKeyDown = onKeyDown;
  mapView.resizeObserver = new ResizeObserver(() => keepViewOnResize());
  mapView.resizeObserver.observe(findElement("#stage"));
}

/** Start listening for keys (Esc, Ctrl+Z). Called last when a map opens; closeMap stops it. */
export function listenForMapKeys() {
  addEventListener("keydown", app.mapView.onKeyDown);
}

/** @param {PointerEvent} event */
function onPointerDown(event) {
  const mapView = app.mapView;
  mapView.svg.setPointerCapture(event.pointerId);
  gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  gesture.movedPixels = 0;
  mapView.pointersDown = gesture.pointers.size;
  if (gesture.pointers.size === 2) {
    gesture.pinch = null;
    cancelStroke();
  }
  if (mapView.mode === "draw" && gesture.pointers.size === 1) startStroke(event.clientX, event.clientY);
}

/** @param {PointerEvent} event */
function onPointerMove(event) {
  if (!gesture.pointers.has(event.pointerId)) return;
  const mapView = app.mapView;
  const previous = gesture.pointers.get(event.pointerId);
  const current = { x: event.clientX, y: event.clientY };
  gesture.pointers.set(event.pointerId, current);
  if (gesture.pointers.size === 2) {
    pinchZoom();
    return;
  }
  gesture.movedPixels += Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
  if (mapView.mode === "draw" && mapView.strokeInProgress) {
    extendStroke(current.x, current.y);
    return;
  }
  const scale = svgUnitsPerPixel();
  mapView.viewBox.x -= (current.x - previous.x) * scale;
  mapView.viewBox.y -= (current.y - previous.y) * scale;
  applyViewSoon();
}

/** Two fingers: zoom by how their distance changed, and pan by how their middle moved. */
function pinchZoom() {
  const mapView = app.mapView;
  const [first, second] = [...gesture.pointers.values()];
  const distance = Math.hypot(first.x - second.x, first.y - second.y);
  const middleX = (first.x + second.x) / 2;
  const middleY = (first.y + second.y) / 2;
  const previous = gesture.pinch;
  if (previous) {
    zoomViewAt(previous.distance / distance, middleX, middleY);
    const scale = svgUnitsPerPixel();
    mapView.viewBox.x -= (middleX - previous.middleX) * scale;
    mapView.viewBox.y -= (middleY - previous.middleY) * scale;
    applyViewSoon();
  }
  gesture.pinch = { distance, middleX, middleY };
  gesture.movedPixels += PINCH_COUNTS_AS_MOVED_PIXELS;
}

/** @param {PointerEvent} event */
function onPointerUp(event) {
  const mapView = app.mapView;
  const isTap = gesture.pointers.size === 1 && gesture.movedPixels < TAP_MAX_MOVE_PIXELS;
  if (mapView.mode === "draw" && mapView.strokeInProgress && gesture.pointers.size === 1) {
    finishStroke();
  } else if (isTap && mapView.mode === "place" && mapView.placingSubTaskId) {
    placeSubTaskPinAt(event.clientX, event.clientY);
  } else if (isTap && mapView.mode === "pan") {
    onMapTapped(event.clientX, event.clientY);
  }
  if (gesture.pointers.size <= 2) gesture.pinch = null;
  releasePointer(event.pointerId);
}

/** @param {PointerEvent} event */
function onPointerCancel(event) {
  gesture.pinch = null;
  cancelStroke();
  releasePointer(event.pointerId);
}

/**
 * A finger or button let go. When the last one does, run what was waiting for the gesture to end
 * (map/view.js afterUserLetsGo).
 * @param {number} pointerId
 */
function releasePointer(pointerId) {
  const mapView = app.mapView;
  gesture.pointers.delete(pointerId);
  mapView.pointersDown = gesture.pointers.size;
  if (!gesture.pointers.size && mapView.afterGesture) {
    const run = mapView.afterGesture;
    mapView.afterGesture = null;
    run();
  }
}

/**
 * A tap while panning: a task marker selects its part, an extract is marked or unmarked, a loot
 * spot shows what it is (without touching the selection), and a tap on empty map deselects and
 * closes the loot popup.
 * @param {number} clientX
 * @param {number} clientY
 */
function onMapTapped(clientX, clientY) {
  const mapView = app.mapView;
  const tapped = document.elementFromPoint(clientX, clientY);
  const marker = tapped && tapped.closest(".mk");
  const extract = tapped && tapped.closest(".ex");
  const lootMarker = tapped && tapped.closest(".lt");
  if (marker) {
    selectPartFromMarker(mapView.markerItemByKey[marker.getAttribute("data-k")]);
  } else if (extract) {
    onExtractTapped(extract.getAttribute("data-name"));
  } else if (lootMarker) {
    onLootTapped(lootMarker, clientX, clientY);
  } else {
    closeLootPopup();
    if (mapView.selectedPartKey) deselectPart();
  }
}

/** @param {WheelEvent} event */
function onWheel(event) {
  event.preventDefault();
  zoomViewAt(event.deltaY > 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP, event.clientX, event.clientY);
}

/**
 * Keys on the map page (not while typing): Ctrl+Z undoes the last drawing, Ctrl+Shift+Z redoes it;
 * Esc leaves draw / place mode, or else deselects.
 * @param {KeyboardEvent} event
 */
function onKeyDown(event) {
  const mapView = app.mapView;
  if (/** @type {Element} */ (event.target).matches("input,select,textarea")) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redoStroke();
    else undoStroke();
  }
  if (event.key !== "Escape") return;
  if (mapView.mode !== "pan" || mapView.placingSubTaskId) {
    setMapMode("pan");
    mapView.placingSubTaskId = null;
  } else if (mapView.selectedPartKey) {
    deselectPart();
  }
}
