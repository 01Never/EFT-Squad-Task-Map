// Extracts: highlights the closest of "your" extracts after a GPS position (ticket 03): a ring
// on the extract, a dashed line from you to it with the distance, and "Closest: …" in the
// position bar. The rules are in rules.js. Everything here is drawn once per update; nothing
// animates inside the map SVG.
import { app, prefs } from "../../store.js";
import { esc, mk } from "../../util.js";
import { apply, panTo, extractList } from "../../map.js";
import { positionOnThisMap } from "../find-me/map-layer.js";
import { extractsThatCount, closestExtract, approximateDistanceText } from "./rules.js";

const SVG_FONT = "bender, Arial, sans-serif";

/**
 * Draw (or clear) the closest-extract highlight. Called after a new position, after marking or
 * unmarking an extract, after an extract chip changes, and on every full re-render.
 */
export function renderClosestExtract() {
  const mapView = app.M;
  if (!mapView || !mapView.gClosest) {
    return;
  }
  mapView.gClosest.innerHTML = "";
  const barPart = document.getElementById("gpsbar-closest");
  if (barPart) {
    barPart.innerHTML = "";
  }
  const position = positionOnThisMap();
  if (!position) {
    return;
  }
  const mapPrefs = prefs(mapView.key);
  const { candidates, basis } = extractsThatCount(extractList(), mapPrefs.extMarked || {}, mapPrefs.ext);
  const best = closestExtract(position, candidates);
  if (!best) {
    return;
  }
  drawHighlight(mapView, position, best.extract, approximateDistanceText(best.distanceMeters));
  renderBarPart(barPart, best, basis);
  apply(); // gives the new ring and label their on-screen size
}

/** A ring on the extract and a dashed line from you to it, with the distance at the midpoint. */
function drawHighlight(mapView, position, extract, distanceText) {
  const layer = mapView.gClosest;
  const [fromX, fromY] = mapView.proj.toSvg(position.x, position.z);
  const [toX, toY] = mapView.proj.toSvg(extract.x, extract.z);
  const linePoints = `${fromX.toFixed(2)},${fromY.toFixed(2)} ${toX.toFixed(2)},${toY.toFixed(2)}`;

  // The line keeps the same on-screen width at any zoom (non-scaling stroke).
  mk("polyline", { points: linePoints, fill: "none", stroke: "#000", "stroke-width": 5, "stroke-linecap": "round", "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, layer);
  mk("polyline", { points: linePoints, fill: "none", style: "stroke:var(--player)", "stroke-width": 2.5, "stroke-dasharray": "9 6", "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, layer);

  const ring = mk("g", { class: "sc", "data-x": toX, "data-y": toY, "pointer-events": "none" }, layer);
  mk("circle", { r: 16, fill: "none", stroke: "#000", "stroke-width": 5.5 }, ring);
  mk("circle", { r: 16, fill: "none", style: "stroke:var(--player)", "stroke-width": 3 }, ring);

  const middle = mk("g", { class: "sc", "data-x": (fromX + toX) / 2, "data-y": (fromY + toY) / 2, "pointer-events": "none" }, layer);
  const label = mk("text", {
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
  barPart.innerHTML = ` · <span title="${esc(tooltip)}">${heading}:</span> <button class="lnk" id="gpsclosest">${esc(best.extract.n)} · ${distanceText}</button>`;
  const button = document.getElementById("gpsclosest");
  if (button) {
    button.onclick = () => centreOnExtract(best.extract);
  }
}

/** Centre the map on an extract without changing the zoom. */
function centreOnExtract(extract) {
  const [svgX, svgY] = app.M.proj.toSvg(extract.x, extract.z);
  panTo(svgX, svgY);
}
