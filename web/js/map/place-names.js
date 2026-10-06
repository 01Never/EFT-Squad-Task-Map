// @ts-check
// Place names on the map (the "Place names" chip), from the labels in maps-config.json. A label
// with a height range shows only on the floor it belongs to.
import { app } from "../app/state.js";
import { createSvgElement } from "../app/dom.js";
import { mapPrefs } from "../app/map-prefs.js";
import { applyView } from "./view.js";

/** @import { MapLabel, MapFloorLayer } from "../app/types.js" */

const SVG_FONT = "bender, Arial, sans-serif";

// With the ground floor shown, a label belongs to the ground when it starts below this height
// (metres), or below the map's own top height if that's lower.
const GROUND_LABEL_MAX_BOTTOM_METERS = 10;

// A label without a bottom (top) height reaches down (up) forever.
const NO_BOTTOM = -1e9;
const NO_TOP = 1e9;

/**
 * Whether a place name shows with this floor: labels without heights always show; with the
 * ground floor shown, labels starting low enough; with a floor shown, labels whose height range
 * overlaps one of the floor's.
 * @param {MapLabel} label
 * @param {MapFloorLayer | undefined} floorLayer undefined = ground
 * @param {number} mapTopHeight
 */
export function isPlaceNameShown(label, floorLayer, mapTopHeight) {
  if (label.bottom == null && label.top == null) return true;
  if (!floorLayer) return (label.bottom ?? NO_BOTTOM) < Math.min(mapTopHeight, GROUND_LABEL_MAX_BOTTOM_METERS);
  return floorLayer.extents.some(
    (extent) => (label.bottom ?? NO_BOTTOM) < extent.height[1] && (label.top ?? NO_TOP) > extent.height[0],
  );
}

/** Draw the place names for the floor shown (nothing when the chip is off). */
export function renderPlaceNames() {
  const mapView = app.mapView;
  const layer = mapView.layers.placeNames;
  layer.innerHTML = "";
  if (!mapPrefs(mapView.key).labels) return;
  const config = mapView.config;
  const mapTopHeight = config.heightRange ? config.heightRange[1] : GROUND_LABEL_MAX_BOTTOM_METERS;
  const floorLayer = config.layers.find((floor) => floor.svgLayer === mapView.floor);
  for (const label of config.labels) {
    if (!isPlaceNameShown(label, floorLayer, mapTopHeight)) continue;
    drawPlaceName(layer, label);
  }
  applyView();
}

/** @param {SVGGElement} layer @param {MapLabel} label */
function drawPlaceName(layer, label) {
  const [x, y] = app.mapView.projection.toSvg(label.x, label.z);
  const group = createSvgElement("g", { class: "sc", "data-x": x, "data-y": y, "pointer-events": "none" }, layer);
  const text = createSvgElement(
    "text",
    {
      "text-anchor": "middle",
      "font-size": 13,
      "font-family": SVG_FONT,
      "font-weight": 700,
      fill: "#e0dfd6",
      stroke: "#000",
      "stroke-width": 3,
      "paint-order": "stroke",
      transform: label.r ? `rotate(${label.r})` : null,
    },
    group,
  );
  text.textContent = label.t;
}
