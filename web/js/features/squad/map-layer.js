// @ts-check
// What the squad draws on the map of its own: each friend's drawings (read-only, in the friend's
// colour, under your own). They can't be clicked and touch nothing of yours. Everything here came
// from friends, so numbers are checked before they reach an SVG attribute and colours go through
// safeFriendColor(). Squadmates' tasks are task markers (features/tasks/map-layer.js, ticket 27).
import { app } from "../../app/state.js";
import { createSvgElement } from "../../app/dom.js";
import { friendsShowingDrawings } from "./friends.js";
import { safeFriendColor, ownValue } from "./rules.js";
import { warnOnce } from "./safe.js";

/** @import { SquadFriend, Stroke } from "../../app/types.js" */

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
