// @ts-check
// Tasks on the map: a marker per spot of every shown part (plus sub-task pins), zones as outlines,
// overlapping markers spread around their spot, the selected part's markers bigger and flashing.
// The "!" and fading come from readiness; the drawing itself is map/markers.js.
import { app } from "../../app/state.js";
import { createSvgElement } from "../../app/dom.js";
import { floorBadge } from "../../map/projection.js";
import { drawMarker } from "../../map/markers.js";
import { applyView } from "../../map/view.js";
import { renderSelectionFlash } from "../../map/selection-flash.js";
import { isObjectiveDone, isObjectiveOnMap, placesNamedByExtractObjective } from "./rules.js";
import { partsOnMap, isShownOnMap } from "./task-list.js";
import { isObjectivePossible } from "../readiness/rules.js";
import { subTaskMarkerItems } from "../sub-tasks/map-layer.js";
import { squadColorsForTask } from "../squad/friends.js";
import { markerIconItem, itemIconUrl, showsItemIcons } from "../icons/rules.js";

/** @import { Task, Part, Objective, PartOnMap } from "../../app/types.js" */
/** @import { MarkerItem } from "../../app/state.js" */

// Markers closer than 1/3 SVG unit count as the same spot and are spread around it in a circle
// of this many screen pixels, so each stays clickable.
const SAME_SPOT_GRID_PER_SVG_UNIT = 3;
const OVERLAP_SPREAD_PIXELS = 11;

// The selected part's markers are drawn this much bigger (and on top).
const SELECTED_MARKER_SCALE = 1.5;

// Zones: a light fill in the category's colour; a dotted, faded outline when you're not ready.
const ZONE_FILL_OPACITY = 0.13;
const NOT_READY_ZONE_OPACITY = 0.55;

/**
 * @typedef {object} Spot A place on the open map where an objective happens.
 * @property {number} x SVG position
 * @property {number} y
 * @property {"exact" | "possible"} kind possible = the quest item may be here
 * @property {string | null} f floor badge
 * @property {number[][]} [ol] the zone's outline, in game [x, z]
 * @property {Objective} [o]
 */

/**
 * The spots of one objective on the open map: its zones, its possible spots, or (for an extract
 * objective without either) the extracts its text names.
 * @param {Task} task
 * @param {Objective} objective
 * @returns {Spot[]}
 */
function spotsOfObjective(task, objective) {
  const mapView = app.mapView;
  const mapKey = mapView.key;
  const projection = mapView.projection;
  const spots = [];
  for (const zone of objective.zones) {
    if (zone.m !== mapKey) continue;
    const [x, y] = projection.toSvg(zone.x, zone.z);
    spots.push({ x, y, kind: "exact", f: floorBadge(mapView.config, zone.x, zone.y, zone.z), ol: zone.ol });
  }
  for (const spotSet of objective.poss) {
    if (spotSet.m !== mapKey) continue;
    for (const point of spotSet.p) {
      const [x, y] = projection.toSvg(point[0], point[2]);
      spots.push({ x, y, kind: "possible", f: floorBadge(mapView.config, point[0], point[1], point[2]) });
    }
  }
  if (!spots.length && objective.type === "extract" && isObjectiveOnMap(objective, mapKey, task)) {
    for (const place of placesNamedByExtractObjective(objective, mapView.mapInfo)) {
      const [x, y] = projection.toSvg(place.x, place.z);
      spots.push({ x, y, kind: "exact", f: null });
    }
  }
  return spots;
}

/**
 * The spots of a part's objectives on the open map that aren't done yet, each with its objective.
 * `ticks` are yours unless the squad layer asks for a friend's.
 * @param {Task} task
 * @param {Part} part
 * @param {Record<string, true | number>} [ticks]
 * @returns {Spot[]}
 */
export function spotsOfPart(task, part, ticks = app.saved.ticks) {
  const spots = [];
  for (const objective of part.objs) {
    if (isObjectiveDone(objective, ticks) || !isObjectiveOnMap(objective, app.mapView.key, task)) continue;
    for (const spot of spotsOfObjective(task, objective)) spots.push({ ...spot, o: objective });
  }
  return spots;
}

/** Draw every shown part's zones and markers, and the selection flash on the selected part. */
export function renderTaskMarkers() {
  const mapView = app.mapView;
  const { taskMarkers, zones } = mapView.layers;
  taskMarkers.innerHTML = "";
  zones.innerHTML = "";
  mapView.markerItemByKey = {};
  const { items, firstShownRowByTask } = partMarkerItems();
  items.push(...subTaskMarkerItems(firstShownRowByTask));
  spreadOverlappingMarkers(items);
  const isSelected = (item) => mapView.selectedPartKey === item.part.key;
  items.sort((first, second) => Number(isSelected(first)) - Number(isSelected(second))); // the selected part on top
  const flashPoints = [];
  items.forEach((item, index) => {
    const markerKey = "m" + index;
    mapView.markerItemByKey[markerKey] = item;
    const group = drawMarker(taskMarkers, item, markerKey);
    if (item.ox) {
      group.dataset.ox = String(item.ox);
      group.dataset.oy = String(item.oy);
    }
    if (isSelected(item)) {
      group.dataset.s = String(SELECTED_MARKER_SCALE);
      flashPoints.push({ x: item.x, y: item.y, ox: item.ox, oy: item.oy });
    }
  });
  applyView();
  renderSelectionFlash(flashPoints);
}

/**
 * A marker item per spot of every shown part (drawing each spot's zone on the way), and the first
 * shown row of each task (sub-task pins take its look).
 * @returns {{ items: MarkerItem[], firstShownRowByTask: Map<string, PartOnMap> }}
 */
function partMarkerItems() {
  const mapView = app.mapView;
  const bag = app.saved.have;
  const withIcons = showsItemIcons(app.saved);
  const items = [];
  const firstShownRowByTask = new Map();
  for (const row of partsOnMap(mapView.key)) {
    if (!isShownOnMap(row)) continue;
    const { task, part, cat } = row;
    if (!firstShownRowByTask.has(task.id)) firstShownRowByTask.set(task.id, row);
    const squadColors = squadColorsForTask(task.id);
    for (const spot of spotsOfPart(task, part)) {
      const isReady = isObjectivePossible(spot.o, bag);
      if (spot.ol) drawZone(spot.ol, cat.color, isReady);
      const iconItem = iconItemOfSpot(spot, withIcons);
      items.push({ ...spot, task, part, icon: cat.icon, color: cat.color, squadColors, iconItem, ready: isReady, split: part.split });
    }
  }
  return { items, firstShownRowByTask };
}

/**
 * The item picture an exact spot shows instead of its category shape (ticket 07), or null: where
 * you place something (mark, plant), when Settings has item icons on.
 * @param {Spot} spot
 * @param {boolean} withIcons
 * @returns {MarkerItem["iconItem"]}
 */
function iconItemOfSpot(spot, withIcons) {
  if (!withIcons || spot.kind !== "exact" || !spot.o) return null;
  const item = markerIconItem(spot.o);
  return item ? { url: itemIconUrl(item.id), hasAlternatives: item.hasAlternatives } : null;
}

/**
 * A zone's outline (SPEC §7.3: zones are see-through, one of the two allowed cases).
 * @param {number[][]} outline game [x, z] points
 * @param {string} color
 * @param {boolean} isReady
 */
function drawZone(outline, color, isReady) {
  const projection = app.mapView.projection;
  const points = outline.map((point) => projection.toSvg(point[0], point[1]).map((value) => value.toFixed(2)).join(",")).join(" ");
  createSvgElement(
    "polygon",
    {
      points,
      fill: color,
      "fill-opacity": ZONE_FILL_OPACITY,
      stroke: color,
      "stroke-width": 1.8,
      "stroke-dasharray": isReady ? null : "4 3",
      "vector-effect": "non-scaling-stroke",
      opacity: isReady ? 1 : NOT_READY_ZONE_OPACITY,
      "pointer-events": "none",
    },
    app.mapView.layers.zones,
  );
}

/**
 * Markers on the same spot are spread evenly around it, starting at the top (ox/oy, in pixels).
 * @param {MarkerItem[]} items
 */
function spreadOverlappingMarkers(items) {
  /** @type {Record<string, MarkerItem[]>} */
  const itemsBySpot = {};
  for (const item of items) {
    const spotKey = Math.round(item.x * SAME_SPOT_GRID_PER_SVG_UNIT) + "," + Math.round(item.y * SAME_SPOT_GRID_PER_SVG_UNIT);
    (itemsBySpot[spotKey] = itemsBySpot[spotKey] || []).push(item);
  }
  for (const sameSpot of Object.values(itemsBySpot)) {
    if (sameSpot.length < 2) continue;
    sameSpot.forEach((item, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / sameSpot.length;
      item.ox = Math.cos(angle) * OVERLAP_SPREAD_PIXELS;
      item.oy = Math.sin(angle) * OVERLAP_SPREAD_PIXELS;
    });
  }
}
