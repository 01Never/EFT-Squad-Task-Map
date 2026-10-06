// @ts-check
// Extracts on the map: each extract and transit whose kind the chips show (solid when you marked
// it, see-through otherwise), marking one with a click, and the closest of "your" extracts after a
// GPS position (ticket 03): a ring on it, a dashed line from you with the distance, and
// "Closest: …" in the position bar. The rules are in rules.js. Everything here is drawn once per
// update; nothing animates inside the map SVG.
import { app } from "../../app/state.js";
import { escapeHtml, createSvgElement } from "../../app/dom.js";
import { save } from "../../app/saving.js";
import { mapPrefs } from "../../app/map-prefs.js";
import { applyView, panTo } from "../../map/view.js";
import { renderPanel } from "../../panel/panel.js";
import { positionOnThisMap } from "../find-me/map-layer.js";
import {
  EXTRACT_KIND_COLORS,
  extractsAndTransits,
  extractsThatCount,
  closestExtract,
  approximateDistanceText,
  toggleExtractMark,
} from "./rules.js";

/** @import { Extract } from "./rules.js" */

const SVG_FONT = "bender, Arial, sans-serif";

// SPEC §7.3: an extract you haven't marked is see-through (one of the two allowed cases), so the
// ones you marked stand out.
const UNMARKED_EXTRACT_OPACITY = 0.45;
const UNMARKED_AREA_OPACITY = 0.6;

/** Every extract and transit of the open map, each with its kind. */
export function extractsOfOpenMap() {
  return extractsAndTransits(app.mapView.mapInfo);
}

// ---------------------------------------------------------------- the extracts layer

/** Draw the extracts whose kind is shown, then the closest-extract highlight (marks change it). */
export function renderExtracts() {
  const mapView = app.mapView;
  const layer = mapView.layers.extracts;
  layer.innerHTML = "";
  const prefs = mapPrefs(mapView.key);
  const marked = prefs.extMarked || {};
  for (const extract of extractsOfOpenMap()) {
    if (!prefs.ext[extract.k]) continue;
    drawExtract(layer, extract, !!marked[extract.n]);
  }
  applyView();
  renderClosestExtract(); // ticket 03: marks and chips change which extract is closest
}

/**
 * One extract: its area (if the data has one), a diamond in its kind's colour (with a white frame
 * when marked), its name, and a tap area.
 * @param {SVGGElement} layer
 * @param {Extract} extract
 * @param {boolean} isMarked
 */
function drawExtract(layer, extract, isMarked) {
  const color = EXTRACT_KIND_COLORS[extract.k];
  if (extract.ol) drawExtractArea(layer, extract.ol, color, isMarked);
  const [x, y] = app.mapView.projection.toSvg(extract.x, extract.z);
  const group = createSvgElement(
    "g",
    {
      class: "sc ex" + (isMarked ? " on" : ""),
      "data-x": x,
      "data-y": y,
      "data-name": extract.n,
      style: "cursor:pointer",
      opacity: isMarked ? 1 : UNMARKED_EXTRACT_OPACITY,
    },
    layer,
  );
  if (isMarked) {
    const frame = { x: -9, y: -9, width: 18, height: 18, transform: "rotate(45)", fill: "none", stroke: "#fff", "stroke-width": 2 };
    createSvgElement("rect", frame, group);
  }
  const diamond = { x: -6, y: -6, width: 12, height: 12, transform: "rotate(45)", fill: color, stroke: "#000", "stroke-width": 1.8 };
  createSvgElement("rect", diamond, group);
  const name = createSvgElement(
    "text",
    {
      x: isMarked ? 13 : 11,
      y: 4.5,
      "font-size": isMarked ? 14.5 : 13,
      "font-family": SVG_FONT,
      "font-weight": 700,
      fill: "#fff",
      stroke: "#000",
      "stroke-width": 3,
      "paint-order": "stroke",
    },
    group,
  );
  name.textContent = extract.n;
  createSvgElement("circle", { r: 14, fill: "transparent" }, group);
}

/** The extract's area: dashed and faint until marked. */
function drawExtractArea(layer, outline, color, isMarked) {
  const projection = app.mapView.projection;
  const points = outline.map((point) => projection.toSvg(point[0], point[1]).map((value) => value.toFixed(2)).join(",")).join(" ");
  createSvgElement(
    "polygon",
    {
      points,
      fill: color,
      "fill-opacity": isMarked ? 0.18 : 0.06,
      stroke: color,
      "stroke-width": isMarked ? 2.2 : 1.4,
      "stroke-dasharray": isMarked ? null : "5 4",
      "vector-effect": "non-scaling-stroke",
      opacity: isMarked ? 1 : UNMARKED_AREA_OPACITY,
      "pointer-events": "none",
    },
    layer,
  );
}

/**
 * An extract was clicked on the map: mark it as yours, or unmark it.
 * @param {string} name
 */
export function onExtractTapped(name) {
  const prefs = mapPrefs(app.mapView.key);
  prefs.extMarked = prefs.extMarked || {};
  toggleExtractMark(prefs.extMarked, name);
  save();
  renderExtracts();
  renderPanel();
}

// ---------------------------------------------------------------- the closest extract

/**
 * Draw (or clear) the closest-extract highlight. Called after a new position, after marking or
 * unmarking an extract, after an extract chip changes, and on every full re-render.
 */
export function renderClosestExtract() {
  const mapView = app.mapView;
  if (!mapView || !mapView.layers.closestExtract) {
    return;
  }
  mapView.layers.closestExtract.innerHTML = "";
  const barPart = document.getElementById("gpsbar-closest");
  if (barPart) {
    barPart.innerHTML = "";
  }
  const position = positionOnThisMap();
  if (!position) {
    return;
  }
  const prefs = mapPrefs(mapView.key);
  const { candidates, basis } = extractsThatCount(extractsOfOpenMap(), prefs.extMarked || {}, prefs.ext);
  const best = closestExtract(position, candidates);
  if (!best) {
    return;
  }
  drawHighlight(mapView, position, best.extract, approximateDistanceText(best.distanceMeters));
  renderBarPart(barPart, best, basis);
  applyView(); // gives the new ring and label their on-screen size
}

/** A ring on the extract and a dashed line from you to it, with the distance at the midpoint. */
function drawHighlight(mapView, position, extract, distanceText) {
  const layer = mapView.layers.closestExtract;
  const [fromX, fromY] = mapView.projection.toSvg(position.x, position.z);
  const [toX, toY] = mapView.projection.toSvg(extract.x, extract.z);
  const linePoints = `${fromX.toFixed(2)},${fromY.toFixed(2)} ${toX.toFixed(2)},${toY.toFixed(2)}`;

  // The line keeps the same on-screen width at any zoom (non-scaling stroke).
  createSvgElement("polyline", { points: linePoints, fill: "none", stroke: "#000", "stroke-width": 5, "stroke-linecap": "round", "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, layer);
  createSvgElement("polyline", { points: linePoints, fill: "none", style: "stroke:var(--player)", "stroke-width": 2.5, "stroke-dasharray": "9 6", "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, layer);

  const ring = createSvgElement("g", { class: "sc", "data-x": toX, "data-y": toY, "pointer-events": "none" }, layer);
  createSvgElement("circle", { r: 16, fill: "none", stroke: "#000", "stroke-width": 5.5 }, ring);
  createSvgElement("circle", { r: 16, fill: "none", style: "stroke:var(--player)", "stroke-width": 3 }, ring);

  const middle = createSvgElement("g", { class: "sc", "data-x": (fromX + toX) / 2, "data-y": (fromY + toY) / 2, "pointer-events": "none" }, layer);
  const label = createSvgElement("text", {
    y: -6, "text-anchor": "middle", "font-size": 13, "font-weight": 700, "font-family": SVG_FONT,
    fill: "#fff", stroke: "#000", "stroke-width": 3.5, "paint-order": "stroke",
  }, middle);
  label.textContent = distanceText;
}

/** " · Closest: Crash Site · ~180 m" in the position bar. Clicking the name centres on that extract. */
function renderBarPart(barPart, best, basis) {
  if (!barPart) {
    return;
  }
  const heading = basis === "shown" ? "Closest shown" : "Closest";
  const tooltip = basis === "shown"
    ? "Closest of the extracts shown by the chips (no extract marked yet). Straight-line distance."
    : "Closest of the extracts you marked. Straight-line distance.";
  const distanceText = approximateDistanceText(best.distanceMeters);
  barPart.innerHTML = ` · <span title="${escapeHtml(tooltip)}">${heading}:</span> <button class="lnk" id="gpsclosest">${escapeHtml(best.extract.n)} · ${distanceText}</button>`;
  const button = document.getElementById("gpsclosest");
  if (button) {
    button.onclick = () => centreOnExtract(best.extract);
  }
}

/** Centre the map on an extract without changing the zoom. */
function centreOnExtract(extract) {
  const [svgX, svgY] = app.mapView.projection.toSvg(extract.x, extract.z);
  panTo(svgX, svgY);
}
