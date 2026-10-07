// @ts-check
// What the squad draws on the map: each friend's drawings (read-only, in the friend's colour,
// under your own) and, for friends whose tasks you show, small markers for the tasks you don't
// have. Neither layer can be clicked, and neither touches your task list, readiness, Bring list,
// selection or saved data. Everything here came from friends, so numbers are checked before they
// reach an SVG attribute and colours go through safeFriendColor().
import { app } from "../../app/state.js";
import { createSvgElement } from "../../app/dom.js";
import { applyView } from "../../map/view.js";
import { spotsOfPart } from "../tasks/map-layer.js";
import { friendsShowingDrawings, friendsShowingTasks } from "./friends.js";
import { safeFriendColor, friendsOwnTasksOnMap, openPartsOnMap } from "./rules.js";

/** @import { SquadFriend, Stroke } from "../../app/types.js" */

// A friend's marker is smaller than yours (a task spot is 8.5), a plain dot in the friend's colour.
const FRIEND_MARKER_RADIUS = 5;
// Two friends on the same spot are drawn this many screen pixels apart.
const FRIEND_MARKER_SPREAD_PIXELS = 6;
// Used when a stroke's width isn't a usable number (game units).
const FALLBACK_STROKE_WIDTH = 2;

// ---------------------------------------------------------------- friends' drawings

/** Redraw every shown friend's strokes on the open map (the layer is under your own drawings). */
export function renderFriendDrawings() {
  const layer = app.mapView.layers.friendDrawings;
  layer.innerHTML = "";
  for (const friend of friendsShowingDrawings()) {
    drawFriendStrokes(layer, friend);
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
  const newGroup = drawFriendStrokes(layer, friend);
  if (oldGroup) oldGroup.replaceWith(newGroup);
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
  const strokes = friend.share && friend.share.draw && friend.share.draw[mapView.key];
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

// ---------------------------------------------------------------- friends' other tasks

/**
 * Small markers for the open parts of tasks a shown friend has and you don't, on the open map,
 * in the friend's colour. Drawn under your own markers; not clickable.
 */
export function renderFriendTaskMarkers() {
  const mapView = app.mapView;
  const layer = mapView.layers.friendTasks;
  layer.innerHTML = "";
  const friends = friendsShowingTasks();
  friends.forEach((friend, friendIndex) => {
    drawFriendTaskMarkers(layer, friend, friendIndex, friends.length);
  });
}

/** Redraw the friends' markers and put them at screen size (after a change that isn't a full redraw). */
export function renderFriendTaskMarkersAndApplyView() {
  renderFriendTaskMarkers();
  applyView();
}

/**
 * @param {SVGGElement} layer
 * @param {SquadFriend} friend
 * @param {number} friendIndex which of the shown friends this is (spreads markers on one spot)
 * @param {number} friendCount
 */
function drawFriendTaskMarkers(layer, friend, friendIndex, friendCount) {
  const mapView = app.mapView;
  const color = safeFriendColor(friend.color);
  const spreadPixels = (friendIndex - (friendCount - 1) / 2) * FRIEND_MARKER_SPREAD_PIXELS;
  const theirTasks = friendsOwnTasksOnMap(friend, app.saved, app.taskById, mapView.key);
  for (const { task, ticks } of theirTasks) {
    for (const part of openPartsOnMap(task, ticks, mapView.key)) {
      for (const spot of spotsOfPart(task, part, ticks)) {
        drawFriendMarker(layer, spot, color, spreadPixels);
      }
    }
  }
}

/**
 * One small dot at a spot: filled for an exact spot, white with a coloured edge for a possible one.
 * @param {SVGGElement} layer
 * @param {{ x: number, y: number, kind: string }} spot
 * @param {string} color
 * @param {number} spreadPixels
 */
function drawFriendMarker(layer, spot, color, spreadPixels) {
  const group = createSvgElement(
    "g",
    { class: "sc friend-marker", "data-x": spot.x, "data-y": spot.y, "data-ox": spreadPixels, "pointer-events": "none" },
    layer,
  );
  const isPossible = spot.kind === "possible";
  const circle = {
    r: FRIEND_MARKER_RADIUS,
    fill: isPossible ? "#fff" : color,
    stroke: isPossible ? color : "#000",
    "stroke-width": isPossible ? 2.4 : 1.6,
  };
  createSvgElement("circle", circle, group);
}
