// @ts-check
// Drawing: simplifying a drawn line and turning it into the saved form (game coordinates, so a
// drawing stays put if the map art changes). Plain functions only: no DOM, no network.

/** @import { Stroke } from "../../app/types.js" */

/** The colour buttons on the drawing bar (the colour picker next to them allows any colour). */
export const DRAW_COLORS = ["#ff4d4d", "#ffe084", "#2fbf3a", "#0292c0", "#f783ac", "#ffffff", "#ff922b", "#000000"];

// The line-width slider, in screen pixels at the zoom you draw at.
export const DRAW_WIDTH_MIN_PIXELS = 2;
export const DRAW_WIDTH_MAX_PIXELS = 16;

// A point closer than this fraction of the line's width to the simplified line is dropped:
// invisible at that width, and it keeps the saved data small.
const SIMPLIFY_TOLERANCE_OF_WIDTH = 0.25;

// A click without moving draws a dot: a second point this far (SVG units) to the right.
const DOT_LENGTH_SVG_UNITS = 0.05;

/**
 * Douglas–Peucker line simplification: keeps both ends, and recursively keeps the point farthest
 * from the line between them while it's more than `tolerance` away.
 * @param {number[][]} points [x, y] points
 * @param {number} tolerance
 * @returns {number[][]}
 */
export function simplifyStroke(points, tolerance) {
  if (points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  let farthestDistance = 0;
  let farthestIndex = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const distance = distanceToSegment(points[i], first, last);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = i;
    }
  }
  if (farthestDistance > tolerance) {
    const before = simplifyStroke(points.slice(0, farthestIndex + 1), tolerance);
    const after = simplifyStroke(points.slice(farthestIndex), tolerance);
    return before.slice(0, -1).concat(after);
  }
  return [first, last];
}

/** Distance from a point to the segment between `start` and `end`. */
function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  let along = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared;
  along = Math.max(0, Math.min(1, along));
  return Math.hypot(point[0] - start[0] - along * dx, point[1] - start[1] - along * dy);
}

/**
 * The line as it's saved: simplified, in game coordinates (2 decimals), with its width in game
 * units (3 decimals). A single point becomes a short dot.
 * @param {number[][]} svgPoints the points as drawn, in SVG units (changed: a dot gets its second point)
 * @param {number} widthSvgUnits
 * @param {string} color
 * @param {{ toGame: (x: number, y: number) => number[], unit: number }} projection
 * @returns {Stroke}
 */
export function strokeForSaving(svgPoints, widthSvgUnits, color, projection) {
  let points = svgPoints;
  if (points.length === 1) points.push([points[0][0] + DOT_LENGTH_SVG_UNITS, points[0][1]]);
  points = simplifyStroke(points, widthSvgUnits * SIMPLIFY_TOLERANCE_OF_WIDTH);
  const roundedGamePoint = (point) => projection.toGame(point[0], point[1]).map((value) => +value.toFixed(2));
  return {
    c: color,
    w: +(widthSvgUnits / projection.unit).toFixed(3),
    pts: points.map(roundedGamePoint),
  };
}
