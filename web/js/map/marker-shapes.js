// @ts-check
// The marker shapes a category can use, drawn as SVG paths around (0, 0): for markers on the map
// and the small swatches in the panel. Drawing only; which category uses which shape is saved data.

/** The shapes, in the order the category menu offers them (and new categories take them). */
export const MARKER_SHAPES = ["circle", "square", "diamond", "triangle", "star", "hexagon"];

/**
 * SVG path data for a shape of about `radius` around (0, 0). Unknown shapes are circles.
 * Each shape is scaled a little so they look about the same size.
 * @param {string} shape
 * @param {number} radius
 * @returns {string}
 */
export function markerShapePath(shape, radius) {
  if (shape === "square") return `M${-radius * 0.85},${-radius * 0.85}h${radius * 1.7}v${radius * 1.7}h${-radius * 1.7}z`;
  if (shape === "diamond") return `M0,${-radius * 1.15}L${radius * 1.15},0L0,${radius * 1.15}L${-radius * 1.15},0z`;
  if (shape === "triangle") return `M0,${-radius * 1.2}L${radius * 1.1},${radius * 0.8}L${-radius * 1.1},${radius * 0.8}z`;
  if (shape === "hexagon") return hexagonPath(radius);
  if (shape === "star") return starPath(radius);
  return `M${radius},0A${radius},${radius} 0 1 1 ${-radius},0A${radius},${radius} 0 1 1 ${radius},0z`;
}

/** Six corners, starting at 30°: a corner points straight up and one straight down. */
function hexagonPath(radius) {
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i + Math.PI / 6;
    corners.push(`${(radius * 1.05 * Math.cos(angle)).toFixed(2)},${(radius * 1.05 * Math.sin(angle)).toFixed(2)}`);
  }
  return "M" + corners.join("L") + "z";
}

/** Five points: alternating outer and inner corners, starting at the top. */
function starPath(radius) {
  const corners = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const cornerRadius = i % 2 ? radius * 0.55 : radius * 1.25;
    corners.push(`${(cornerRadius * Math.cos(angle)).toFixed(2)},${(cornerRadius * Math.sin(angle)).toFixed(2)}`);
  }
  return "M" + corners.join("L") + "z";
}

/**
 * A small inline SVG of a category's shape and colour, for the panel (HTML text).
 * @param {string} shape
 * @param {string} color
 * @param {number} [sizePixels]
 * @returns {string}
 */
export function renderShapeSwatch(shape, color, sizePixels = 16) {
  return `<svg width="${sizePixels}" height="${sizePixels}" viewBox="-12 -12 24 24" aria-hidden="true" style="flex:none"><path d="${markerShapePath(shape, 9)}" fill="${color}" stroke="#000" stroke-width="2"/></svg>`;
}
