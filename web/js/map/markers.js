// @ts-check
// Drawing one marker on the map: the category's shape and colour, and its badges (floor, "!" when
// you're missing something, split-task corner, sub-task dot, done tick). Which markers to draw and
// why is up to the features (features/tasks/map-layer.js).
import { createSvgElement } from "../app/dom.js";
import { markerShapePath } from "./marker-shapes.js";

/** @import { MarkerItem } from "../app/state.js" */

const SVG_FONT = "bender, Arial, sans-serif";

// A marker of a part you're not ready for is drawn at half opacity (SPEC §7.3, one of the two
// see-through cases).
const NOT_READY_MARKER_OPACITY = 0.5;

// Marker sizes (SVG units at zoom 1, kept at screen size by the "sc" class): task spots and the
// smaller sub-task pins.
const TASK_MARKER_RADIUS = 8.5;
const SUB_TASK_MARKER_RADIUS = 6.5;

// Taps within this radius around a marker's centre hit it (an invisible circle).
const MARKER_TAP_RADIUS = 15;

// Colours inside the markers (SVG attributes, so not CSS variables).
const WHITE = "#fff";
const BLACK = "#000";
const NOT_READY_BADGE_COLOR = "#ffd43b"; // the same yellow as the "!" in the task list

/**
 * Draw a marker into `layer` and return its group. `markerKey` lets a tap find the marker item
 * again (data-k).
 * @param {SVGGElement} layer
 * @param {MarkerItem} marker
 * @param {string} markerKey
 * @returns {SVGGElement}
 */
export function drawMarker(layer, marker, markerKey) {
  const opacity = marker.ready === false ? NOT_READY_MARKER_OPACITY : 1;
  const group = createSvgElement(
    "g",
    { class: "sc mk", "data-x": marker.x, "data-y": marker.y, "data-k": markerKey, style: "cursor:pointer", opacity },
    layer,
  );
  const radius = marker.kind === "sub" ? SUB_TASK_MARKER_RADIUS : TASK_MARKER_RADIUS;
  if (marker.kind === "possible") drawPossibleSpot(group, marker, radius);
  else drawExactSpot(group, marker, radius);
  if (marker.f) drawFloorBadge(group, marker.f);
  if (marker.ready === false) drawNotReadyBadge(group);
  if (marker.split) drawSplitBadge(group);
  createSvgElement("circle", { r: MARKER_TAP_RADIUS, fill: "transparent" }, group);
  return group;
}

/** A possible spot (the item may be here): white shape with a coloured edge and a "?". */
function drawPossibleSpot(group, marker, radius) {
  createSvgElement("path", { d: markerShapePath(marker.icon, radius), fill: WHITE, stroke: marker.color, "stroke-width": 3.2 }, group);
  const questionMark = createSvgElement(
    "text",
    { y: 3.8, "text-anchor": "middle", "font-size": 10.5, "font-weight": 700, "font-family": SVG_FONT, fill: BLACK },
    group,
  );
  questionMark.textContent = "?";
}

/** An exact spot: the shape in the category's colour; a sub-task pin has a white dot, a done one a tick. */
function drawExactSpot(group, marker, radius) {
  createSvgElement("path", { d: markerShapePath(marker.icon, radius), fill: marker.color, stroke: BLACK, "stroke-width": 2 }, group);
  if (marker.kind === "sub") {
    createSvgElement("circle", { r: 2.3, fill: WHITE, stroke: BLACK, "stroke-width": 1 }, group);
  }
  if (marker.done) {
    const tick = { d: "M-3.5,.5L-1,3L4,-3", fill: "none", stroke: WHITE, "stroke-width": 2.4, "stroke-linecap": "round" };
    createSvgElement("path", tick, group);
  }
}

/** The floor ("2", "B"…) in a black circle, top right. */
function drawFloorBadge(group, floor) {
  createSvgElement("circle", { cx: 8.5, cy: -8.5, r: 5.8, fill: BLACK, stroke: WHITE, "stroke-width": 1.2 }, group);
  const text = createSvgElement(
    "text",
    { x: 8.5, y: -5.3, "text-anchor": "middle", "font-size": 9, "font-weight": 700, "font-family": SVG_FONT, fill: WHITE },
    group,
  );
  text.textContent = floor;
}

/** "!" in a yellow circle, top left: you're missing something this needs. */
function drawNotReadyBadge(group) {
  createSvgElement("circle", { cx: -8.5, cy: -8.5, r: 5.8, fill: NOT_READY_BADGE_COLOR, stroke: BLACK, "stroke-width": 1.2 }, group);
  const text = createSvgElement(
    "text",
    { x: -8.5, y: -5.2, "text-anchor": "middle", "font-size": 10, "font-weight": 700, "font-family": SVG_FONT, fill: BLACK },
    group,
  );
  text.textContent = "!";
}

/** A small square with a dashed cross, bottom right: this is one part of a split task. */
function drawSplitBadge(group) {
  createSvgElement("rect", { x: 3.5, y: 3.5, width: 10, height: 10, rx: 2, fill: BLACK, stroke: WHITE, "stroke-width": 1 }, group);
  const cross = { d: "M8.5,5.5V11.5M5.8,8.5H11.2", stroke: WHITE, "stroke-width": 1.4, "stroke-dasharray": "1.6 1" };
  createSvgElement("path", cross, group);
}
