// @ts-check
// Key doors on the map (ticket 09): a marker for every door and trunk a key on your list opens
// (a tile in the "your keys" colour with the key's icon, the floor badge, ⚡ when it needs power,
// friends' colour dots), the door's outline where the data has one, and with "All locked doors"
// the rest, dimmed. Tapping a door opens its popup: the key, the lock, the tasks that use it,
// friends who have it, and the loot likely behind it (highlighted while the popup is open).
// Like ticket 08's loot: only doors in and near the view are drawn, as cached pictures, redrawn
// once the view stops moving. Nothing is animated. The rules are in rules.js.
import { app } from "../../app/state.js";
import { createSvgElement, escapeHtml, findElement } from "../../app/dom.js";
import { save } from "../../app/saving.js";
import { floorBadge } from "../../map/projection.js";
import { svgUnitsPerPixel, screenSizeTransform, fitViewTo, zoomViewAt } from "../../map/view.js";
import { renderMapPage } from "../../map/map-page.js";
import { lootOfMap } from "../loot/loot-data.js";
import { spotsNearView, summarizeSpots } from "../loot/rules.js";
import { FLOOR_BADGE_SIZE, floorBadgePicture } from "../loot/marker-images.js";
import { safeFriendColor, friendDisplayName } from "../squad/rules.js";
import { isItemId, itemIconUrl } from "../icons/rules.js";
import { openMapKeyList, keysFriendsHaveOnOpenMap, friendsWithKeyOnOpenMap } from "./key-lists.js";
import { KEYS_COLOR, DOOR_TILE_SIZE, POWER_BADGE_SIZE, doorTilePicture, unknownDoorPicture, powerBadgePicture } from "./marker-images.js";
import {
  LOOT_BEHIND_DOOR_RADIUS_METERS,
  doorsToDraw,
  doorStatus,
  doorKeyName,
  locksOpenedBy,
  tasksUsingKey,
  lootNearDoor,
  addKeyToList,
} from "./rules.js";

/** @import { MapLoot } from "../loot/rules.js" */
/** @import { Lock, DoorStatus } from "./rules.js" */
/** @import { ViewBox } from "../../app/state.js" */

/**
 * @typedef {object} PlacedDoor A door at its map position.
 * @property {Lock} lock
 * @property {DoorStatus} status
 * @property {number} index the lock's index in the map's locks
 * @property {number} svgX
 * @property {number} svgY
 * @property {string | null} f floor badge
 * @property {string[]} friendColors colours of friends who have its key (at most 3)
 */

/**
 * @typedef {object} DoorsOnMap The doors drawn on the open map (app.mapView.keyDoors).
 * @property {MapLoot} loot
 * @property {PlacedDoor[]} placed every door to draw
 * @property {ViewBox | null} drawnView the view the markers were drawn for
 * @property {number | null} popupLockIndex the lock whose popup is open
 * @property {ReturnType<typeof setTimeout>} [redrawTimer]
 */

// The view must stay still this long before the doors are redrawn for it (as ticket 08's loot).
const REDRAW_AFTER_VIEW_STOPS_MS = 150;

// Doors for keys you don't have ("All locked doors", or only a friend's key) are drawn at this
// opacity: the second exception to "markers are fully opaque" (SPEC §7.3, CLAUDE.md).
const DIMMED_DOOR_OPACITY = 0.45;

// Taps within this radius around a door's centre hit it (an invisible circle).
const DOOR_TAP_RADIUS = 12;

// At most this many friend dots on a door (bottom left), as on task markers.
const MAX_FRIEND_DOTS = 3;

// Flying to a key's doors leaves this fraction of the map's width around them.
const FLY_PADDING_MAP_WIDTH_PARTS = 30;

// ... and zooms in to at most 1/12 of the map's width (fitting a task's spots stops at 1/3.5, too
// far out to tell a building's doors apart).
const FLY_CLOSEST_MAP_WIDTH_PARTS = 12;

// The popup lists at most this many tasks and loot lines.
const MAX_POPUP_LINES = 8;

// ---------------------------------------------------------------- the layer

/**
 * Draw the doors your keys open on the open map (loading the map's locks first if needed), plus,
 * with "All locked doors", the rest dimmed. With no key on the list, the toggle off and no friend
 * keys, the layer is empty and nothing else runs.
 */
export function renderKeyDoors() {
  const mapView = app.mapView;
  if (!mapView) return;
  const myKeys = openMapKeyList();
  const friendKeys = keysFriendsHaveOnOpenMap();
  const wantsDoors = myKeys.size > 0 || app.allDoorsShown || friendKeys.size > 0 || isPopupOpen();
  if (!wantsDoors) {
    clearKeyDoors();
    return;
  }
  const loot = lootOfMap(mapView.key, onDoorsLoaded);
  if (!loot || !loot.available) {
    clearKeyDoors();
    return;
  }
  const previous = mapView.keyDoors;
  if (previous) clearTimeout(previous.redrawTimer);
  const doors = doorsToDraw(loot, mapView.key, myKeys, app.allDoorsShown, friendKeys);
  const keepsPopup = previous && previous.loot === loot ? previous.popupLockIndex : null;
  mapView.keyDoors = { loot, placed: doors.map(placeDoor), drawnView: null, popupLockIndex: keepsPopup };
  drawLayerGroups();
  drawOutlines();
  drawDoorsNearView();
  renderDoorPopup();
}

/** The map's locks arrived from the server: draw the doors. */
function onDoorsLoaded() {
  renderKeyDoors();
}

/** Whether a door popup is open on this map. */
function isPopupOpen() {
  const doorsOnMap = app.mapView && app.mapView.keyDoors;
  return !!doorsOnMap && doorsOnMap.popupLockIndex !== null;
}

/** No doors on the map: empty layer, no popup. */
function clearKeyDoors() {
  const mapView = app.mapView;
  if (mapView.keyDoors) clearTimeout(mapView.keyDoors.redrawTimer);
  mapView.layers.keyDoors.replaceChildren();
  mapView.keyDoors = null;
  renderDoorPopup();
}

/**
 * A door at its map position, with its floor badge and friends' colours.
 * @param {{ lock: Lock, status: DoorStatus, index: number }} door
 * @returns {PlacedDoor}
 */
function placeDoor(door) {
  const { projection, config } = app.mapView;
  const { lock } = door;
  const [svgX, svgY] = projection.toSvg(lock.x, lock.z);
  const friends = door.status === "unknown" ? [] : friendsWithKeyOnOpenMap([lock.key]);
  const friendColors = friends.slice(0, MAX_FRIEND_DOTS).map((friend) => safeFriendColor(friend.color));
  return { ...door, svgX, svgY, f: floorBadge(config, lock.x, lock.y, lock.z), friendColors };
}

/** The layer's three groups, bottom to top: outlines, loot near the open door, door markers. */
function drawLayerGroups() {
  const layer = app.mapView.layers.keyDoors;
  layer.replaceChildren();
  createSvgElement("g", { "data-kd": "outlines" }, layer);
  createSvgElement("g", { "data-kd": "near" }, layer);
  createSvgElement("g", { "data-kd": "doors" }, layer);
}

/**
 * @param {"outlines" | "near" | "doors"} name
 * @returns {SVGGElement}
 */
function layerGroup(name) {
  return app.mapView.layers.keyDoors.querySelector(`[data-kd="${name}"]`);
}

/**
 * Door outlines, where the data has one (a door's footprint, not the room: 10 of 283 locks). Few
 * and small, so they're all drawn, under the markers.
 */
function drawOutlines() {
  const projection = app.mapView.projection;
  const group = layerGroup("outlines");
  for (const door of app.mapView.keyDoors.placed) {
    if (!door.lock.ol || door.lock.ol.length < 3) continue;
    const points = door.lock.ol.map((point) => projection.toSvg(point[0], point[1]).map((value) => value.toFixed(2)).join(",")).join(" ");
    const color = door.status === "unknown" ? "#8f8d80" : KEYS_COLOR;
    createSvgElement(
      "polygon",
      {
        class: "kd-outline",
        points,
        fill: color,
        "fill-opacity": 0.35,
        stroke: color,
        "stroke-width": 2,
        "vector-effect": "non-scaling-stroke",
        opacity: door.status === "mine" ? 1 : DIMMED_DOOR_OPACITY,
        "pointer-events": "none",
      },
      group,
    );
  }
}

/** Draw the door markers in and near the view. */
function drawDoorsNearView() {
  const mapView = app.mapView;
  const doorsOnMap = mapView.keyDoors;
  const scale = svgUnitsPerPixel();
  if (!isFinite(scale) || scale <= 0) return; // the map isn't laid out yet
  const fragment = document.createDocumentFragment();
  for (const door of spotsNearView(doorsOnMap.placed, mapView.viewBox)) {
    const marker = drawDoor(fragment, door);
    marker.setAttribute("transform", screenSizeTransform(marker, scale));
  }
  layerGroup("doors").replaceChildren(fragment);
  doorsOnMap.drawnView = { ...mapView.viewBox };
}

/**
 * Called on every view change (map/view.js applyView). When doors are drawn, waits until the view
 * has stopped moving, then redraws them for the new view. Nothing happens with no doors.
 */
export function redrawKeyDoorsWhenViewSettles() {
  const doorsOnMap = app.mapView && app.mapView.keyDoors;
  if (!doorsOnMap) return;
  clearTimeout(doorsOnMap.redrawTimer);
  doorsOnMap.redrawTimer = setTimeout(redrawIfViewMoved, REDRAW_AFTER_VIEW_STOPS_MS);
}

function redrawIfViewMoved() {
  const mapView = app.mapView;
  if (!mapView || !mapView.keyDoors) return;
  const drawn = mapView.keyDoors.drawnView;
  const now = mapView.viewBox;
  const isSameView = drawn && drawn.x === now.x && drawn.y === now.y && drawn.w === now.w && drawn.h === now.h;
  if (!isSameView) drawDoorsNearView();
}

// ---------------------------------------------------------------- one door

/**
 * One door: its tile (with the key's icon), floor badge, ⚡ badge, friends' dots and a tap area.
 * Doors for keys you don't have are dimmed.
 * @param {ParentNode} parent
 * @param {PlacedDoor} door
 * @returns {SVGGElement}
 */
function drawDoor(parent, door) {
  const isDimmed = door.status !== "mine";
  const marker = createSvgElement("g", {
    class: "sc kd" + (isDimmed ? " kd-dim" : ""),
    "data-x": door.svgX,
    "data-y": door.svgY,
    "data-lock": door.index,
    "data-key": door.lock.key,
    "data-status": door.status,
    opacity: isDimmed ? DIMMED_DOOR_OPACITY : null,
    style: "cursor:pointer",
  });
  parent.appendChild(marker);
  drawDoorTile(marker, door);
  if (door.f) drawPicture(marker, floorBadgePicture(door.f), FLOOR_BADGE_SIZE, 9, -9);
  if (door.lock.power) drawPicture(marker, powerBadgePicture(), POWER_BADGE_SIZE, 9, 9);
  door.friendColors.forEach((color, position) => {
    createSvgElement("circle", { class: "kd-friend", cx: -9 + position * 5, cy: 9, r: 2.8, fill: color, stroke: "#000", "stroke-width": 0.8 }, marker);
  });
  createSvgElement("circle", { r: DOOR_TAP_RADIUS, fill: "transparent" }, marker);
  return marker;
}

/**
 * The tile: "?" for an unknown key; else the key's icon on a plain tile, or the key sign when
 * icons can't be loaded.
 * @param {SVGGElement} marker
 * @param {PlacedDoor} door
 */
function drawDoorTile(marker, door) {
  if (door.status === "unknown") {
    drawPicture(marker, unknownDoorPicture(), DOOR_TILE_SIZE, 0, 0);
    return;
  }
  const showsIcon = isItemId(door.lock.key) && !app.lootIconsMissing;
  const tile = drawPicture(marker, doorTilePicture(!showsIcon), DOOR_TILE_SIZE, 0, 0);
  if (!showsIcon) return;
  const icon = drawPicture(marker, itemIconUrl(door.lock.key), DOOR_TILE_SIZE - 5, 0, 0);
  icon.addEventListener("error", () => {
    app.lootIconsMissing = true; // the same /icons/ route as loot: no more icons until a reload
    icon.remove();
    tile.setAttribute("href", doorTilePicture(true));
  });
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

// ---------------------------------------------------------------- flying to a key's doors

/**
 * Zoom to the doors a key opens on the open map (the panel's key names). With one door, its popup
 * opens too.
 * @param {string} keyId
 * @returns {boolean} false when the key opens nothing here (or the locks aren't loaded yet)
 */
export function flyToKeyDoors(keyId) {
  const mapView = app.mapView;
  const loot = lootOfMap(mapView.key, onDoorsLoaded);
  const locks = locksOpenedBy(loot, keyId, mapView.key);
  if (!locks.length) return false;
  const points = locks.map((lock) => mapView.projection.toSvg(lock.x, lock.z));
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  fitViewTo(box, mapView.homeView.w / FLY_PADDING_MAP_WIDTH_PARTS);
  zoomInOnTheMiddleTo(mapView.homeView.w / FLY_CLOSEST_MAP_WIDTH_PARTS);
  if (locks.length === 1) openDoorPopup(loot.locks.indexOf(locks[0]));
  return true;
}

/**
 * Zoom in around the middle of the map area until the view is `width` SVG units wide (never out).
 * @param {number} width
 */
function zoomInOnTheMiddleTo(width) {
  const mapView = app.mapView;
  if (mapView.viewBox.w <= width) return;
  const area = mapView.svg.getBoundingClientRect();
  zoomViewAt(width / mapView.viewBox.w, area.left + area.width / 2, area.top + area.height / 2);
}

// ---------------------------------------------------------------- tapping and the popup

/**
 * A door was tapped: its popup opens. Task selection is left alone.
 * @param {Element} marker
 */
export function onDoorTapped(marker) {
  openDoorPopup(Number(marker.getAttribute("data-lock")));
}

/**
 * @param {number} lockIndex
 */
function openDoorPopup(lockIndex) {
  const doorsOnMap = app.mapView && app.mapView.keyDoors;
  if (!doorsOnMap || !doorsOnMap.loot.locks[lockIndex]) return;
  doorsOnMap.popupLockIndex = lockIndex;
  renderDoorPopup();
}

/** Close the door popup (its ×, or a tap on empty map or another popup's marker). */
export function closeDoorPopup() {
  const doorsOnMap = app.mapView && app.mapView.keyDoors;
  if (doorsOnMap) doorsOnMap.popupLockIndex = null;
  renderDoorPopup();
}

/** Show the door popup (top right of the map) and highlight the loot near the door, or hide both. */
function renderDoorPopup() {
  const stage = findElement("#stage");
  if (!stage) return;
  const doorsOnMap = app.mapView && app.mapView.keyDoors;
  const lock = doorsOnMap && doorsOnMap.popupLockIndex !== null ? /** @type {Lock} */ (doorsOnMap.loot.locks[doorsOnMap.popupLockIndex]) : null;
  let popup = findElement("#keypop", stage);
  if (!lock) {
    if (popup) popup.hidden = true;
    if (doorsOnMap) layerGroup("near").replaceChildren();
    return;
  }
  if (!popup) {
    popup = document.createElement("div");
    popup.id = "keypop";
    popup.className = "keypop";
    popup.addEventListener("click", onDoorPopupClicked);
    stage.appendChild(popup);
  }
  popup.hidden = false;
  const nearby = lootNearDoor(doorsOnMap.loot, lock);
  popup.innerHTML = renderDoorDetails(doorsOnMap.loot, lock, nearby);
  highlightNearbyLoot(nearby);
}

/**
 * The popup's text: key, lock, your list, friends, tasks, nearby loot.
 * @param {MapLoot} loot
 * @param {Lock} lock
 * @param {ReturnType<typeof lootNearDoor>} nearby
 */
function renderDoorDetails(loot, lock, nearby) {
  const mapKey = app.mapView.key;
  const status = doorStatus(lock, mapKey, openMapKeyList());
  const keyName = doorKeyName(loot, lock, mapKey);
  const icon = status !== "unknown" && isItemId(lock.key) ? `<img src="${itemIconUrl(lock.key)}" alt="" onerror="this.remove()">` : "";
  return `<button class="x" title="Close">×</button><h3>${icon}<span>${escapeHtml(keyName)}</span></h3>
    <div class="m">${renderLockLine(lock)}</div>${renderListLine(status)}${renderFriendLines(lock, status)}
    ${renderTaskLines(lock, status)}${renderNearbyLoot(loot, nearby)}`;
}

/**
 * "Door · floor 2 · ⚡ needs power".
 * @param {Lock} lock
 */
function renderLockLine(lock) {
  const type = lock.type === "trunk" ? "Trunk" : lock.type === "door" ? "Door" : "Lock";
  const floor = floorBadge(app.mapView.config, lock.x, lock.y, lock.z);
  const floorText = floor ? `floor ${escapeHtml(floor)}` : "ground level";
  const power = lock.power ? " · ⚡ needs power" : "";
  return `${type} · ${floorText}${power}`;
}

/**
 * Whether the key is on your list, with a button to add it.
 * @param {DoorStatus} status
 */
function renderListLine(status) {
  if (status === "unknown") return `<p class="m">tarkov.dev doesn't say which key opens this yet.</p>`;
  if (status === "mine") return `<p class="kp-mine">On your key list ✓</p>`;
  return `<p class="m">Not on your key list. <button class="btn sm line" data-door-act="add">+ Add to my keys</button></p>`;
}

/**
 * "Mike has this key", one line per friend, in their colour.
 * @param {Lock} lock
 * @param {DoorStatus} status
 */
function renderFriendLines(lock, status) {
  if (status === "unknown") return "";
  const friends = friendsWithKeyOnOpenMap([lock.key]);
  return friends
    .map((friend) => {
      const dot = `<i class="kp-dot" style="background:${safeFriendColor(friend.color)}"></i>`;
      return `<p class="kp-friend">${dot}<bdi>${escapeHtml(friendDisplayName(friend.name))}</bdi> has this key</p>`;
    })
    .join("");
}

/**
 * The tasks on this map that need the key (yours marked).
 * @param {Lock} lock
 * @param {DoorStatus} status
 */
function renderTaskLines(lock, status) {
  if (status === "unknown") return "";
  const isActive = (task) => !!(app.saved.tasks[task.id] && app.saved.tasks[task.id].active);
  const tasks = tasksUsingKey(app.gameData.tasks, lock.key, app.mapView.key, isActive);
  if (!tasks.length) return `<h4>Tasks</h4><p class="m">No task here needs this key.</p>`;
  const lines = tasks.slice(0, MAX_POPUP_LINES).map(({ task, isActive: isMine }) => {
    const mine = isMine ? ' <span class="tag">on your list</span>' : "";
    return `<li>${escapeHtml(task.name)}${mine}</li>`;
  });
  const more = tasks.length > MAX_POPUP_LINES ? `<li class="more">and ${tasks.length - MAX_POPUP_LINES} more</li>` : "";
  return `<h4>Tasks that use this key</h4><ul>${lines.join("")}${more}</ul>`;
}

/**
 * "Nearby loot, approximate": what ticket 08's data has near the door, by kind.
 * @param {MapLoot} loot
 * @param {ReturnType<typeof lootNearDoor>} nearby
 */
function renderNearbyLoot(loot, nearby) {
  const heading = `<h4>Nearby loot, approximate</h4><p class="m">Within ${LOOT_BEHIND_DOOR_RADIUS_METERS} m, same floor. The data has the door, not the room's walls.</p>`;
  if (!nearby.length) return heading + `<p class="m kp-none">No loot spots within ${LOOT_BEHIND_DOOR_RADIUS_METERS} m.</p>`;
  const lines = summarizeSpots(loot, nearby).slice(0, MAX_POPUP_LINES);
  return heading + `<ul class="kp-loot">${lines.map((line) => `<li>${line.count} × ${escapeHtml(line.name)}</li>`).join("")}</ul>`;
}

/**
 * Rings on the loot spots near the open door (not animated; gone when the popup closes).
 * @param {ReturnType<typeof lootNearDoor>} nearby
 */
function highlightNearbyLoot(nearby) {
  const { projection } = app.mapView;
  const group = layerGroup("near");
  const scale = svgUnitsPerPixel();
  const fragment = document.createDocumentFragment();
  for (const spot of nearby) {
    const [svgX, svgY] = projection.toSvg(spot.x, spot.z);
    const ring = createSvgElement("g", { class: "sc kd-near", "data-x": svgX, "data-y": svgY, "pointer-events": "none" });
    createSvgElement("circle", { r: 8, fill: "none", stroke: "#000", "stroke-width": 4 }, ring);
    createSvgElement("circle", { r: 8, fill: "none", stroke: KEYS_COLOR, "stroke-width": 2 }, ring);
    fragment.appendChild(ring);
    if (isFinite(scale) && scale > 0) ring.setAttribute("transform", screenSizeTransform(ring, scale));
  }
  group.replaceChildren(fragment);
}

/** @param {MouseEvent} event */
function onDoorPopupClicked(event) {
  const target = /** @type {Element} */ (event.target);
  if (target.closest(".x")) {
    closeDoorPopup();
    return;
  }
  if (target.closest('[data-door-act="add"]')) onAddFromPopupClicked();
}

/** "+ Add to my keys" in the popup. */
function onAddFromPopupClicked() {
  const doorsOnMap = app.mapView.keyDoors;
  const lock = doorsOnMap && doorsOnMap.loot.locks[doorsOnMap.popupLockIndex];
  if (!lock) return;
  addKeyToList(app.saved, app.mapView.key, lock.key);
  save();
  renderMapPage(); // readiness, the Bring list and the panel follow the list
}
