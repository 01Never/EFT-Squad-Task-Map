// @ts-check
// The map's own layers, listed once, bottom to top (CODE-STYLE §1). Each is an empty SVG group
// added after the map art; the feature named next to it draws into it. A later layer covers an
// earlier one, so you're always on top and zones sit under everything.

/** @import { MapLayers } from "../app/state.js" */

import { createSvgElement } from "../app/dom.js";

/** @type {(keyof MapLayers)[]} */
const MAP_LAYERS_BOTTOM_TO_TOP = [
  "zones", // task zones (features/tasks/map-layer.js)
  "placeNames", // place names (map/place-names.js)
  "friendDrawings", // friends' drawings, read-only, under yours (features/squad/map-layer.js)
  "drawings", // your drawings (features/drawing/map-layer.js)
  "extracts", // extracts and transits (features/extracts/map-layer.js)
  "closestExtract", // the closest-extract ring and line (features/extracts/map-layer.js)
  "loot", // loot spots: small, under everything about tasks (features/loot/map-layer.js)
  "keyDoors", // doors your keys open, their outlines, loot near an open door (features/keys/map-layer.js)
  "friendTasks", // friends' other tasks: small markers in their colour (features/squad/map-layer.js)
  "taskMarkers", // task and sub-task markers (features/tasks/map-layer.js)
  "player", // you: marker, trail, "You" (features/find-me/map-layer.js)
];

/**
 * Add the layers to the map's SVG, in order, and return them by name.
 * @param {SVGSVGElement} svg
 * @returns {MapLayers}
 */
export function createMapLayers(svg) {
  const layers = /** @type {MapLayers} */ ({});
  for (const name of MAP_LAYERS_BOTTOM_TO_TOP) {
    layers[name] = createSvgElement("g", {}, svg);
  }
  return layers;
}
