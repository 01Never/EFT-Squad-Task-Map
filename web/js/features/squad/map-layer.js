// @ts-check
// What the squad draws on the map of its own: each friend's drawings (read-only, in the friend's
// colour, under your own) and friends' positions (ticket 17: a small disc with a heading arrow and
// their name, under your own marker). Neither can be clicked (a friend's position only answers a
// pointer with its "Mike · 2 min ago" tooltip), and neither touches your task list, readiness, Bring
// list, selection, view or saved data. Everything here came from friends, so numbers are checked
// before they reach an SVG attribute, colours go through safeFriendColor() and names are set as
// text. Squadmates' tasks are task markers (features/tasks/map-layer.js, ticket 27).
import { app } from "../../app/state.js";
import { createSvgElement } from "../../app/dom.js";
import { applyView } from "../../map/view.js";
import { floorBadge, arrowRotation } from "../../map/projection.js";
import { allFriends, friendsShowingDrawings } from "./friends.js";
import { renderSquadChipsInPlace } from "./panel.js";
import {
  safeFriendColor,
  friendDisplayName,
  ownValue,
  friendPositionsOnMap,
  friendPositionTooltip,
  msUntilNextFriendPositionChange,
} from "./rules.js";
import { warnOnce } from "./safe.js";

/** @import { SquadFriend, Stroke, FriendPosition } from "../../app/types.js" */

// Used when a stroke's width isn't a usable number (game units).
const FALLBACK_STROKE_WIDTH = 2;

// ---------------------------------------------------------------- friends' drawings

/** Redraw every shown friend's strokes on the open map (the layer is under your own drawings). */
export function renderFriendDrawings() {
  const layer = app.mapView.layers.friendDrawings;
  layer.innerHTML = "";
  for (const friend of friendsShowingDrawings()) {
    drawFriendStrokesSafely(layer, friend);
  }
}

/**
 * Redraw one friend's strokes only (their drawing changed): the other friends' stay as they are.
 * Switching them off (or a friend leaving) just removes the group.
 * @param {string} playerId
 */
export function renderFriendDrawingsOf(playerId) {
  const layer = app.mapView.layers.friendDrawings;
  const oldGroup = [...layer.children].find((group) => group.getAttribute("data-friend") === playerId);
  const friend = friendsShowingDrawings().find((candidate) => candidate.playerId === playerId);
  if (!friend) {
    if (oldGroup) oldGroup.remove();
    return;
  }
  const newGroup = drawFriendStrokesSafely(layer, friend);
  if (oldGroup) {
    if (newGroup) oldGroup.replaceWith(newGroup);
    else oldGroup.remove();
  }
}

/**
 * drawFriendStrokes, but a friend whose data breaks it is skipped (and noted once in the console).
 * @param {SVGGElement} layer
 * @param {SquadFriend} friend
 * @returns {SVGGElement | null}
 */
function drawFriendStrokesSafely(layer, friend) {
  try {
    return drawFriendStrokes(layer, friend);
  } catch (error) {
    warnOnce("drawings", error);
    return null;
  }
}

/**
 * One friend's strokes on the open map, in one group, in the friend's colour (the strokes' own
 * colours are ignored: you can tell whose is whose).
 * @param {SVGGElement} layer
 * @param {SquadFriend} friend
 * @returns {SVGGElement}
 */
function drawFriendStrokes(layer, friend) {
  const mapView = app.mapView;
  const group = createSvgElement("g", { "data-friend": friend.playerId, "pointer-events": "none" }, layer);
  const color = safeFriendColor(friend.color);
  const strokes = ownValue(friend.share && friend.share.draw, mapView.key);
  if (!Array.isArray(strokes)) return group;
  for (const stroke of strokes) {
    const points = svgPointsOfStroke(stroke);
    if (!points) continue;
    const width = typeof stroke.w === "number" && stroke.w >= 0 ? stroke.w : FALLBACK_STROKE_WIDTH;
    const attributes = {
      points,
      fill: "none",
      stroke: color,
      "stroke-width": width * mapView.projection.unit,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    };
    createSvgElement("polyline", attributes, group);
  }
  return group;
}

/**
 * A stroke's points as an SVG "x,y x,y" list, or null when it isn't a list of number pairs.
 * @param {Stroke} stroke
 * @returns {string | null}
 */
function svgPointsOfStroke(stroke) {
  if (!stroke || !Array.isArray(stroke.pts) || !stroke.pts.length) return null;
  const projection = app.mapView.projection;
  const pairs = [];
  for (const point of stroke.pts) {
    const isPair = Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
    if (!isPair) return null;
    const [x, y] = projection.toSvg(point[0], point[1]);
    pairs.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return pairs.join(" ");
}

// ---------------------------------------------------------------- friends' positions (ticket 17)

// A friend's position is clearly smaller than yours (your disc is 12 with a white edge): a disc
// in their colour with a dark edge, the same heading arrow scaled down, and their name.
const FRIEND_PLAYER_RADIUS = 8;
const FRIEND_PLAYER_ARROW = "M0,-5.3L3.7,1.3H1.2V5.3H-1.2V1.3H-3.7Z";
// Over 5 minutes old: half see-through. A static attribute, never animated (SPEC §7.3, fourth case).
const FADED_FRIEND_PLAYER_OPACITY = 0.5;
const SVG_FONT = "bender, Arial, sans-serif";

/** The one timer for the next time a friend's position fades or goes (null when none is due). */
let positionRefreshTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);

/**
 * Draw the friends whose position is on the open map (their ◎ Pos switch on, not over 30 minutes
 * old), then set the timer for the next fade or hide moment. Friends' positions never move your
 * view and never feed Find me, Follow, auto-center or the closest extract: those read only your
 * own position (app.gps).
 */
export function renderFriendPlayers() {
  const mapView = app.mapView;
  if (!mapView) return;
  const layer = mapView.layers.friendPlayers;
  layer.innerHTML = "";
  try {
    for (const shown of friendPositionsOnMap(allFriends(), app.saved, mapView.key, Date.now())) {
      drawFriendPlayerSafely(layer, shown.friend, shown.position, shown.isFaded);
    }
  } finally {
    scheduleFriendPositionRefresh();
  }
}

/** Redraw friends' positions and put them at screen size (a change that isn't a full redraw). */
export function renderFriendPlayersAndApplyView() {
  renderFriendPlayers();
  if (app.mapView) applyView();
}

/**
 * Set the one timer for the next moment a friend's position fades (5 min) or goes (30 min),
 * replacing the one before. It is not a loop: it fires once, redraws, and sets the next one only
 * if another change is coming. Called after every redraw of the positions and every `squad` event.
 */
export function scheduleFriendPositionRefresh() {
  clearTimeout(positionRefreshTimer);
  positionRefreshTimer = null;
  if (!app.mapView) return;
  const waitMs = msUntilNextFriendPositionChange(allFriends(), Date.now());
  if (waitMs === null) return;
  positionRefreshTimer = setTimeout(onFriendPositionAged, waitMs);
}

/** A friend's position just faded or went: redraw it and the chips ("on Customs", ◎ Pos). */
function onFriendPositionAged() {
  positionRefreshTimer = null;
  if (!app.mapView) return; // the next map you open draws (and times) them
  renderSquadChipsInPlace();
  renderFriendPlayersAndApplyView();
}

/**
 * drawFriendPlayer, but a friend whose data breaks it is skipped (and noted once in the console).
 * @param {SVGGElement} layer
 * @param {SquadFriend} friend
 * @param {FriendPosition} position checked by rules.js friendPositionOf()
 * @param {boolean} isFaded
 */
function drawFriendPlayerSafely(layer, friend, position, isFaded) {
  try {
    drawFriendPlayer(layer, friend, position, isFaded);
  } catch (error) {
    warnOnce("positions", error);
  }
}

/**
 * One friend's position: `g.friend-player[data-friend]` holding a disc that turns with their
 * heading and, upright beside it, their name and floor badge. Mirrors your own marker
 * (features/find-me/map-layer.js): the same projection, arrow rotation and floor badge rule.
 * @param {SVGGElement} layer
 * @param {SquadFriend} friend
 * @param {FriendPosition} position
 * @param {boolean} isFaded
 */
function drawFriendPlayer(layer, friend, position, isFaded) {
  const mapView = app.mapView;
  const [svgX, svgY] = mapView.projection.toSvg(position.x, position.z);
  if (!Number.isFinite(svgX) || !Number.isFinite(svgY)) return;
  const color = safeFriendColor(friend.color);
  const marker = createSvgElement(
    "g",
    {
      class: isFaded ? "friend-player faded" : "friend-player",
      "data-friend": friend.playerId,
      opacity: isFaded ? FADED_FRIEND_PLAYER_OPACITY : null,
      "pointer-events": "none",
    },
    layer,
  );
  const headingDegrees = arrowRotation(mapView.config, position.yaw).toFixed(1);
  drawFriendDisc(marker, svgX, svgY, headingDegrees, color, friend, position);
  const floor = floorBadge(mapView.config, position.x, position.y, position.z);
  drawFriendLabel(marker, svgX, svgY, color, friendDisplayName(friend.name), floor);
}

/**
 * The part that turns with the friend's heading: their disc and arrow. The disc is the only thing
 * that takes the pointer, for its tooltip, which is worked out each time you point at it.
 * @param {SVGGElement} marker
 * @param {number} svgX
 * @param {number} svgY
 * @param {string} headingDegrees
 * @param {string} color
 * @param {SquadFriend} friend
 * @param {FriendPosition} position
 */
function drawFriendDisc(marker, svgX, svgY, headingDegrees, color, friend, position) {
  const discAttributes = { class: "sc", "data-x": svgX, "data-y": svgY, "data-r": headingDegrees };
  const disc = createSvgElement("g", discAttributes, marker);
  const dotAttributes = {
    class: "friend-player-dot",
    r: FRIEND_PLAYER_RADIUS,
    fill: color,
    stroke: "#000",
    "stroke-width": 1.5,
    "pointer-events": "visiblePainted",
  };
  const dot = createSvgElement("circle", dotAttributes, disc);
  const tooltip = createSvgElement("title", {}, dot);
  tooltip.textContent = friendPositionTooltip(friend, position, Date.now());
  dot.addEventListener("pointerenter", () => {
    tooltip.textContent = friendPositionTooltip(friend, position, Date.now());
  });
  // a thin dark edge keeps the white arrow readable on a light friend colour
  const arrow = {
    d: FRIEND_PLAYER_ARROW,
    fill: "#fff",
    stroke: "#000",
    "stroke-width": 1.2,
    "paint-order": "stroke",
  };
  createSvgElement("path", arrow, disc);
}

/**
 * The part that stays upright: the friend's name in their colour and, off the ground floor, the
 * floor badge at the disc's top right (SPEC §7.3).
 * @param {SVGGElement} marker
 * @param {number} svgX
 * @param {number} svgY
 * @param {string} color
 * @param {string} name already cleaned by friendDisplayName(); set as text
 * @param {string | null} floor
 */
function drawFriendLabel(marker, svgX, svgY, color, name, floor) {
  const upright = createSvgElement("g", { class: "sc", "data-x": svgX, "data-y": svgY }, marker);
  const labelAttributes = {
    class: "friend-player-name",
    x: 12,
    y: 4,
    "font-size": 11,
    "font-weight": 700,
    "font-family": SVG_FONT,
    fill: color,
    stroke: "#000",
    "stroke-width": 2.6,
    "paint-order": "stroke",
  };
  const label = createSvgElement("text", labelAttributes, upright);
  label.textContent = name;
  if (!floor) return;
  const badge = { cx: 7.5, cy: -7.5, r: 4.8, fill: "#000", stroke: "#fff", "stroke-width": 1 };
  createSvgElement("circle", badge, upright);
  const floorAttributes = {
    x: 7.5,
    y: -5,
    "text-anchor": "middle",
    "font-size": 7,
    "font-weight": 700,
    "font-family": SVG_FONT,
    fill: "#fff",
  };
  const floorText = createSvgElement("text", floorAttributes, upright);
  floorText.textContent = floor;
}
