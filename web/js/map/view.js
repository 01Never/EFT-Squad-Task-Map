// @ts-check
// The part of the map on screen (the SVG viewBox): pan, zoom, fit, and keeping the overlays in
// place. Markers and labels are groups with class "sc" that keep their screen size at any zoom.
// No feature rules here; features call these to move the view.
import { app } from "../app/state.js";
import { placeSelectionFlash } from "./selection-flash.js";
import { placeFindMeOverlays } from "../features/find-me/map-layer.js";

/** @import { ViewBox } from "../app/state.js" */

// Zoom limits: in to 1/40 of the whole map's width, out to 1.8 times it.
const CLOSEST_ZOOM_MAP_WIDTH_PARTS = 40;
const FARTHEST_ZOOM_MAP_WIDTHS = 1.8;

// Fitting the view to a task's spots never zooms closer than 1/3.5 of the map's width, so a
// single spot still shows its surroundings.
const CLOSEST_FIT_MAP_WIDTH_PARTS = 3.5;

// A map area smaller than this (hidden, or mid-layout) keeps its view as it is.
const MIN_MAP_AREA_PIXELS = 10;

/**
 * SVG units per screen pixel at the current zoom.
 * @returns {number}
 */
export function svgUnitsPerPixel() {
  return app.mapView.viewBox.w / app.mapView.svg.getBoundingClientRect().width;
}

let isFramePending = false;

/** Apply the view at the next animation frame (pan and zoom gestures: at most once per frame). */
export function applyViewSoon() {
  if (isFramePending) return;
  isFramePending = true;
  requestAnimationFrame(() => {
    isFramePending = false;
    if (app.mapView) applyView();
  });
}

/**
 * Show the current view: set the viewBox, keep every "sc" group at its screen size (its
 * data-x/y position, data-ox/oy offset in pixels, data-s scale, data-r rotation), and move the
 * HTML overlays (selection flash, find-me pulse and chip) to their spots.
 */
export function applyView() {
  const { svg, viewBox } = app.mapView;
  svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
  const scale = svgUnitsPerPixel();
  svg.querySelectorAll(".sc").forEach((group) => group.setAttribute("transform", screenSizeTransform(group, scale)));
  if (isFinite(scale) && scale > 0) app.mapView.svgUnitsPerPixel = scale;
  placeSelectionFlash();
  placeFindMeOverlays();
}

/**
 * The transform that puts an "sc" group at its map position and keeps it at its screen size.
 * @param {Element} group
 * @param {number} scale SVG units per pixel
 */
function screenSizeTransform(group, scale) {
  const data = /** @type {SVGGElement} */ (group).dataset;
  const x = +data.x + (+data.ox || 0) * scale;
  const y = +data.y + (+data.oy || 0) * scale;
  const rotation = data.r ? ` rotate(${data.r})` : "";
  return `translate(${x},${y}) scale(${scale * (+data.s || 1)})${rotation}`;
}

/**
 * Move the view so (x, y) in map (SVG) coordinates is in the middle, keeping the zoom.
 * @param {number} x
 * @param {number} y
 */
export function panTo(x, y) {
  const mapView = app.mapView;
  if (!mapView) return;
  mapView.viewBox = { ...mapView.viewBox, x: x - mapView.viewBox.w / 2, y: y - mapView.viewBox.h / 2 };
  applyView();
}

/** When the map area changes size (window resized, task list hidden/shown), keep the same centre and zoom. */
export function keepViewOnResize() {
  const mapView = app.mapView;
  if (!mapView || !mapView.svgUnitsPerPixel) return;
  const area = mapView.svg.getBoundingClientRect();
  if (area.width < MIN_MAP_AREA_PIXELS || area.height < MIN_MAP_AREA_PIXELS) return;
  const centreX = mapView.viewBox.x + mapView.viewBox.w / 2;
  const centreY = mapView.viewBox.y + mapView.viewBox.h / 2;
  const width = area.width * mapView.svgUnitsPerPixel;
  const height = area.height * mapView.svgUnitsPerPixel;
  mapView.viewBox = { x: centreX - width / 2, y: centreY - height / 2, w: width, h: height };
  applyView();
}

/**
 * Zoom and pan so `box` (SVG units) fills the map area with `padding` around it, keeping the
 * screen's aspect ratio. Never closer than CLOSEST_FIT_MAP_WIDTH_PARTS.
 * @param {ViewBox} box
 * @param {number} padding SVG units
 */
export function fitViewTo(box, padding) {
  const mapView = app.mapView;
  const area = mapView.svg.getBoundingClientRect();
  const aspectRatio = area.width / Math.max(area.height, 1);
  let { x, y, w, h } = box;
  const minimumSize = mapView.homeView.w / CLOSEST_FIT_MAP_WIDTH_PARTS;
  if (w < minimumSize) {
    x -= (minimumSize - w) / 2;
    w = minimumSize;
  }
  if (h < minimumSize) {
    y -= (minimumSize - h) / 2;
    h = minimumSize;
  }
  w += padding * 2;
  h += padding * 2;
  x -= padding;
  y -= padding;
  if (w / h > aspectRatio) {
    const newHeight = w / aspectRatio;
    y -= (newHeight - h) / 2;
    h = newHeight;
  } else {
    const newWidth = h * aspectRatio;
    x -= (newWidth - w) / 2;
    w = newWidth;
  }
  mapView.viewBox = { x, y, w, h };
  applyView();
}

/**
 * Zoom by `factor` (above 1 = out) around a point on screen, which stays where it is.
 * @param {number} factor
 * @param {number} clientX
 * @param {number} clientY
 */
export function zoomViewAt(factor, clientX, clientY) {
  const mapView = app.mapView;
  const area = mapView.svg.getBoundingClientRect();
  const { viewBox, homeView } = mapView;
  const pointX = viewBox.x + ((clientX - area.left) / area.width) * viewBox.w;
  const pointY = viewBox.y + ((clientY - area.top) / area.height) * viewBox.h;
  const closest = homeView.w / CLOSEST_ZOOM_MAP_WIDTH_PARTS;
  const farthest = homeView.w * FARTHEST_ZOOM_MAP_WIDTHS;
  const newWidth = Math.min(Math.max(viewBox.w * factor, closest), farthest);
  const actualFactor = newWidth / viewBox.w;
  mapView.viewBox = {
    x: pointX - (pointX - viewBox.x) * actualFactor,
    y: pointY - (pointY - viewBox.y) * actualFactor,
    w: newWidth,
    h: viewBox.h * actualFactor,
  };
  applyViewSoon();
}

/**
 * A point on screen in map (SVG) coordinates.
 * @param {number} clientX
 * @param {number} clientY
 * @returns {number[]} [x, y]
 */
export function clientToSvgPoint(clientX, clientY) {
  const mapView = app.mapView;
  const area = mapView.svg.getBoundingClientRect();
  return [
    mapView.viewBox.x + ((clientX - area.left) / area.width) * mapView.viewBox.w,
    mapView.viewBox.y + ((clientY - area.top) / area.height) * mapView.viewBox.h,
  ];
}

/**
 * Run `run` once the user isn't dragging or pinching the map: now if no finger or button is down,
 * otherwise when the last one lets go. Only the latest request is kept. (Ticket 02: a new position
 * must not yank the map out from under a drag.)
 * @param {() => void} run
 */
export function afterUserLetsGo(run) {
  const mapView = app.mapView;
  if (!mapView) return;
  if (mapView.pointersDown) mapView.afterGesture = run;
  else run();
}
