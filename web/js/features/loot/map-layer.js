// @ts-check
// Loot spots on the map (ticket 08): small neutral tiles with a sign (or the item's icon), a
// floor badge like task markers, bubbles with a count where spots crowd together, and a popup
// when you tap one. Only spots in and near the view are drawn, and they're redrawn once the view
// stops moving, so the map never carries thousands of markers. Loot is never selected like a task
// and never touches readiness or the Bring list. The rules are in rules.js.
import { app } from "../../app/state.js";
import { createSvgElement, escapeHtml, findElement } from "../../app/dom.js";
import { floorBadge } from "../../map/projection.js";
import { svgUnitsPerPixel, screenSizeTransform, zoomViewAt } from "../../map/view.js";
import { renderPanel } from "../../panel/panel.js";
import { lootOfMap } from "./loot-data.js";
import { TILE_SIZE, FLOOR_BADGE_SIZE, tilePicture, bubblePicture, bubbleSize, floorBadgePicture } from "./marker-images.js";
import {
  LOOSE_CHIP,
  lootChoicesOf,
  lootSpotsShown,
  spotsNearView,
  groupNearbySpots,
  lootGlyph,
  lootSpotName,
  summarizeSpots,
  itemName,
} from "./rules.js";

/** @import { MapLoot, LootSpot, SpotGroup } from "./rules.js" */
/** @import { ViewBox } from "../../app/state.js" */

/**
 * @typedef {LootSpot & { svgX: number, svgY: number, f: string | null }} PlacedLootSpot A spot at
 * its map position, with its floor badge.
 */

/**
 * @typedef {object} LootOnMap The loot drawn on the open map (app.mapView.loot).
 * @property {MapLoot} loot
 * @property {string} choicesKey the chips that were on when `placed` was made
 * @property {PlacedLootSpot[]} placed every spot the chips show
 * @property {SpotGroup<PlacedLootSpot>[]} groups what's drawn now (a marker's data-i is its index)
 * @property {ViewBox | null} drawnView the view they were drawn for
 * @property {PlacedLootSpot[] | null} popupSpots what the popup shows, if it's open
 * @property {ReturnType<typeof setTimeout>} [redrawTimer]
 */

// Spots closer than this on screen share one bubble (ticket 08 performance: bounded marker count).
const GROUP_CELL_PIXELS = 34;

// The view must stay still this long before the spots are redrawn for it (one redraw per gesture).
const REDRAW_AFTER_VIEW_STOPS_MS = 150;

// Tapping a bubble zooms in this much around it (until the spots split, or the zoom can't go closer).
const BUBBLE_ZOOM_IN_FACTOR = 2.5;

// A loose spot can have dozens of possible items; the popup lists this many, then "and n more".
const MAX_ITEMS_IN_POPUP = 12;

// Taps within this radius around a marker's centre hit it (an invisible circle).
const MARKER_TAP_RADIUS = 10;

// Ticket 07 serves item icons here. Without it (not merged yet, or the icon can't be fetched) the
// marker shows its sign instead.
const ITEM_ICON_URL = (itemId) => `/icons/${itemId}.webp`;
const ITEM_ID_PATTERN = /^[0-9a-f]{24}$/;

// ---------------------------------------------------------------- the layer

/**
 * Draw the loot spots the chips show on the open map (loading the map's spots first if needed).
 * With every chip off, the layer is empty and nothing else runs.
 */
export function renderLoot() {
  const mapView = app.mapView;
  if (!mapView) return;
  const choices = lootChoicesOf(app.saved.prefs[mapView.key]);
  if (!Object.keys(choices).length) {
    clearLoot();
    return;
  }
  const loot = lootOfMap(mapView.key, onLootLoaded);
  if (!loot || !loot.available) {
    clearLoot();
    return;
  }
  const choicesKey = Object.keys(choices).sort().join();
  const previous = mapView.loot;
  const isSameSpots = previous && previous.loot === loot && previous.choicesKey === choicesKey;
  if (!isSameSpots) {
    if (previous) clearTimeout(previous.redrawTimer);
    mapView.loot = { loot, choicesKey, placed: placeSpots(loot, choices), groups: [], drawnView: null, popupSpots: null };
  }
  drawLootNearView();
  renderLootPopup();
}

/** The map's loot arrived from the server: draw it, and fill the panel's chips. */
function onLootLoaded() {
  renderLoot();
  renderPanel();
}

/** No loot on the map: empty layer, no popup. */
function clearLoot() {
  const mapView = app.mapView;
  if (mapView.loot) clearTimeout(mapView.loot.redrawTimer);
  mapView.layers.loot.replaceChildren();
  mapView.loot = null;
  renderLootPopup();
}

/**
 * Every spot the chips show, at its map position and with its floor badge (worked out once per
 * change of chips, not per redraw).
 * @param {MapLoot} loot
 * @param {Record<string, true>} choices
 * @returns {PlacedLootSpot[]}
 */
function placeSpots(loot, choices) {
  const { projection, config } = app.mapView;
  return lootSpotsShown(loot, choices).map((spot) => {
    const [svgX, svgY] = projection.toSvg(spot.x, spot.z);
    return { ...spot, svgX, svgY, f: floorBadge(config, spot.x, spot.y, spot.z) };
  });
}

/** Draw the spots in and near the view, grouped into bubbles where they crowd together. */
function drawLootNearView() {
  const mapView = app.mapView;
  const lootOnMap = mapView.loot;
  const scale = svgUnitsPerPixel();
  if (!isFinite(scale) || scale <= 0) return; // the map isn't laid out yet
  const nearby = spotsNearView(lootOnMap.placed, mapView.viewBox);
  const groups = groupNearbySpots(nearby, GROUP_CELL_PIXELS * scale);
  const fragment = document.createDocumentFragment();
  groups.forEach((group, index) => {
    const marker = group.spots.length === 1 ? drawSpot(fragment, group.spots[0], index) : drawBubble(fragment, group, index);
    marker.setAttribute("transform", screenSizeTransform(marker, scale));
  });
  mapView.layers.loot.replaceChildren(fragment);
  lootOnMap.groups = groups;
  lootOnMap.drawnView = { ...mapView.viewBox };
}

/**
 * Called on every view change (map/view.js applyView). When loot is drawn, it waits until the
 * view has stopped moving, then redraws for the new view. Nothing happens while loot is off.
 */
export function redrawLootWhenViewSettles() {
  const lootOnMap = app.mapView && app.mapView.loot;
  if (!lootOnMap) return;
  clearTimeout(lootOnMap.redrawTimer);
  lootOnMap.redrawTimer = setTimeout(redrawIfViewMoved, REDRAW_AFTER_VIEW_STOPS_MS);
}

function redrawIfViewMoved() {
  const mapView = app.mapView;
  if (!mapView || !mapView.loot) return;
  const drawn = mapView.loot.drawnView;
  const now = mapView.viewBox;
  const isSameView = drawn && drawn.x === now.x && drawn.y === now.y && drawn.w === now.w && drawn.h === now.h;
  if (!isSameView) drawLootNearView();
}

// ---------------------------------------------------------------- one marker

/**
 * One spot: a small tile with its sign (or its item's icon on a plain tile), and its floor badge.
 * @param {ParentNode} parent
 * @param {PlacedLootSpot} spot
 * @param {number} index
 * @returns {SVGGElement}
 */
function drawSpot(parent, spot, index) {
  const marker = createLootGroup(parent, spot.svgX, spot.svgY, index);
  const singleItem = spot.chip === LOOSE_CHIP && spot.items && spot.items.length === 1 ? spot.items[0] : null;
  const showsIcon = singleItem && ITEM_ID_PATTERN.test(singleItem) && !app.lootIconsMissing;
  const tile = drawPicture(marker, showsIcon ? tilePicture("") : tilePicture(lootGlyph(spot.chip)), TILE_SIZE, 0, 0);
  if (showsIcon) drawItemIcon(marker, tile, singleItem, spot.chip);
  if (spot.f) drawPicture(marker, floorBadgePicture(spot.f), FLOOR_BADGE_SIZE, 7, -7);
  createSvgElement("circle", { r: MARKER_TAP_RADIUS, fill: "transparent" }, marker);
  return marker;
}

/**
 * Several spots close together: a round bubble with how many.
 * @param {ParentNode} parent
 * @param {SpotGroup<PlacedLootSpot>} group
 * @param {number} index
 * @returns {SVGGElement}
 */
function drawBubble(parent, group, index) {
  const marker = createLootGroup(parent, group.svgX, group.svgY, index);
  marker.classList.add("lt-group");
  const count = group.spots.length;
  drawPicture(marker, bubblePicture(count), bubbleSize(count), 0, 0);
  return marker;
}

/**
 * The marker's group: kept at screen size like every "sc" group; "lt" is how a tap finds it.
 * @param {ParentNode} parent
 * @param {number} svgX
 * @param {number} svgY
 * @param {number} index
 * @returns {SVGGElement}
 */
function createLootGroup(parent, svgX, svgY, index) {
  const group = createSvgElement("g", { class: "sc lt", "data-x": svgX, "data-y": svgY, "data-i": index, style: "cursor:pointer" });
  parent.appendChild(group);
  return group;
}

/**
 * A square picture of `size` pixels centred on (x, y) of the marker.
 * @param {SVGGElement} marker
 * @param {string} url
 * @param {number} size
 * @param {number} x
 * @param {number} y
 * @returns {SVGImageElement}
 */
function drawPicture(marker, url, size, x, y) {
  const half = size / 2;
  return createSvgElement("image", { href: url, x: x - half, y: y - half, width: size, height: size }, marker);
}

/**
 * The item's icon (ticket 07's cache) on the plain tile. If it can't be loaded, the tile gets its
 * sign back, and no more icons are asked for until the page reloads.
 * @param {SVGGElement} marker
 * @param {SVGImageElement} tile
 * @param {string} itemId
 * @param {string} chipId
 */
function drawItemIcon(marker, tile, itemId, chipId) {
  const icon = drawPicture(marker, ITEM_ICON_URL(itemId), TILE_SIZE - 3, 0, 0);
  icon.addEventListener("error", () => {
    app.lootIconsMissing = true;
    icon.remove();
    tile.setAttribute("href", tilePicture(lootGlyph(chipId)));
  });
}

// ---------------------------------------------------------------- tapping and the popup

/**
 * A loot marker was tapped. A single spot opens its popup. A bubble zooms in around it so its
 * spots split; when the map can't zoom any closer, the popup lists what's there. Task selection
 * is left alone.
 * @param {Element} marker
 * @param {number} clientX
 * @param {number} clientY
 */
export function onLootTapped(marker, clientX, clientY) {
  const mapView = app.mapView;
  const lootOnMap = mapView.loot;
  const group = lootOnMap && lootOnMap.groups[Number(marker.getAttribute("data-i"))];
  if (!group) return;
  if (group.spots.length > 1) {
    const widthBefore = mapView.viewBox.w;
    zoomViewAt(1 / BUBBLE_ZOOM_IN_FACTOR, clientX, clientY);
    if (mapView.viewBox.w < widthBefore) return; // zoomed in: the bubble splits when the view settles
  }
  lootOnMap.popupSpots = group.spots;
  renderLootPopup();
}

/** Close the loot popup (its ×, or a tap on empty map). */
export function closeLootPopup() {
  const lootOnMap = app.mapView && app.mapView.loot;
  if (lootOnMap) lootOnMap.popupSpots = null;
  renderLootPopup();
}

/** Show the loot popup (top right of the map) for the tapped spot or bubble, or hide it. */
function renderLootPopup() {
  const stage = findElement("#stage");
  if (!stage) return;
  const lootOnMap = app.mapView && app.mapView.loot;
  const spots = lootOnMap && lootOnMap.popupSpots;
  let popup = findElement("#lootpop", stage);
  if (!spots) {
    if (popup) popup.hidden = true;
    return;
  }
  if (!popup) {
    popup = document.createElement("div");
    popup.id = "lootpop";
    popup.className = "lootpop";
    popup.addEventListener("click", onLootPopupClicked);
    stage.appendChild(popup);
  }
  popup.hidden = false;
  const loot = lootOnMap.loot;
  popup.innerHTML = spots.length === 1 ? renderSpotDetails(loot, spots[0]) : renderGroupDetails(loot, spots);
}

/**
 * One spot: its name, what kind of spot and which floor, and the items a loose spot can have.
 * @param {MapLoot} loot
 * @param {PlacedLootSpot} spot
 */
function renderSpotDetails(loot, spot) {
  const kind = spot.chip === LOOSE_CHIP ? "Loose loot" : "Container";
  const floor = spot.f ? `floor ${escapeHtml(spot.f)}` : "ground level";
  const items = spot.items && spot.items.length > 1 ? renderItemList(loot, spot.items) : "";
  return `<button class="x" title="Close">×</button><h3>${escapeHtml(lootSpotName(loot, spot))}</h3>
    <div class="m">${kind} · ${floor}</div>${items}`;
}

/**
 * The items a loose spot can have, the first MAX_ITEMS_IN_POPUP of them.
 * @param {MapLoot} loot
 * @param {string[]} itemIds
 */
function renderItemList(loot, itemIds) {
  const names = itemIds.slice(0, MAX_ITEMS_IN_POPUP).map((id) => `<li>${escapeHtml(itemName(loot, id))}</li>`);
  const more = itemIds.length > MAX_ITEMS_IN_POPUP ? `<li class="more">and ${itemIds.length - MAX_ITEMS_IN_POPUP} more</li>` : "";
  return `<div class="m">Can spawn here:</div><ul>${names.join("")}${more}</ul>`;
}

/**
 * A bubble the map can't split by zooming: how many of each.
 * @param {MapLoot} loot
 * @param {PlacedLootSpot[]} spots
 */
function renderGroupDetails(loot, spots) {
  const lines = summarizeSpots(loot, spots).map((line) => `<li>${line.count} × ${escapeHtml(line.name)}</li>`);
  const floors = [...new Set(spots.map((spot) => spot.f || "ground"))].join(", ");
  return `<button class="x" title="Close">×</button><h3>${spots.length} loot spots</h3>
    <div class="m">Floors: ${escapeHtml(floors)}</div><ul>${lines.join("")}</ul>`;
}

/** @param {MouseEvent} event */
function onLootPopupClicked(event) {
  if (/** @type {Element} */ (event.target).closest(".x")) closeLootPopup();
}
