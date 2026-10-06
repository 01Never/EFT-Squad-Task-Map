// @ts-check
// Map projection: game position {x, z} ↔ the map art's SVG coordinates, after tarkov.dev
// src/pages/map/index.jsx (MIT): getCRS / applyRotation / pos + L.svgOverlay placement.
// Verified against tarkov.dev test vectors (projection.test.js). Keep every formula exactly as is.

/** @import { MapConfig } from "../app/types.js" */

/**
 * The projection for one map's art.
 * @param {MapConfig} config the map's entry in maps-config.json (transform, rotation, bounds)
 * @param {number[]} viewBox the art's viewBox: [x, y, width, height]
 * @returns {{ toSvg: (x: number, z: number) => number[], toGame: (svgX: number, svgY: number) => number[], unit: number }}
 *   `unit` is SVG units per game metre.
 */
export function makeProj(config, viewBox) {
  // tarkov.dev's transform [a, b, c, d]: pixel = (a·x' + b, −c·z' + d), where (x', z') is the
  // game position rotated by the map's rotation.
  const [scaleX, offsetX, negativeScaleY, offsetY] = config.transform;
  const scaleY = -negativeScaleY;
  const radians = ((config.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  /** Game (x, z) → tarkov.dev's pixel space. */
  const toPixels = (x, z) => {
    const rotatedX = x * cos - z * sin;
    const rotatedY = x * sin + z * cos;
    return [scaleX * rotatedX + offsetX, scaleY * rotatedY + offsetY];
  };

  // Where the corners of the art's bounds land in pixel space.
  const bounds = config.svgBounds || config.bounds;
  const latitudes = [bounds[0][1], bounds[1][1]];
  const longitudes = [bounds[0][0], bounds[1][0]];
  const corner1 = toPixels(Math.min(...longitudes), Math.max(...latitudes));
  const corner2 = toPixels(Math.max(...longitudes), Math.min(...latitudes));
  const pixelLeft = Math.min(corner1[0], corner2[0]);
  const pixelTop = Math.min(corner1[1], corner2[1]);
  const pixelWidth = Math.abs(corner1[0] - corner2[0]);
  const pixelHeight = Math.abs(corner1[1] - corner2[1]);

  // The art fills its viewBox keeping its aspect ratio, centred (as L.svgOverlay places it).
  const [viewX, viewY, viewWidth, viewHeight] = viewBox;
  const pixelsPerSvgUnit = Math.min(pixelWidth / viewWidth, pixelHeight / viewHeight);
  const marginX = (pixelWidth - viewWidth * pixelsPerSvgUnit) / 2;
  const marginY = (pixelHeight - viewHeight * pixelsPerSvgUnit) / 2;

  return {
    toSvg(x, z) {
      const [pixelX, pixelY] = toPixels(x, z);
      return [
        viewX + (pixelX - pixelLeft - marginX) / pixelsPerSvgUnit,
        viewY + (pixelY - pixelTop - marginY) / pixelsPerSvgUnit,
      ];
    },
    toGame(svgX, svgY) {
      const pixelX = (svgX - viewX) * pixelsPerSvgUnit + marginX + pixelLeft;
      const pixelY = (svgY - viewY) * pixelsPerSvgUnit + marginY + pixelTop;
      const rotatedX = (pixelX - offsetX) / scaleX;
      const rotatedY = (pixelY - offsetY) / scaleY;
      return [rotatedX * cos + rotatedY * sin, -rotatedX * sin + rotatedY * cos];
    },
    unit: Math.abs(scaleX) / pixelsPerSvgUnit,
  };
}

/**
 * The floor badge ("2", "3", "B"…) for a game position, from the map's floor layers: the first
 * layer whose height range (and, if it has them, area bounds) contains the position.
 * null means ground level (or no height known).
 * @param {MapConfig} config
 * @param {number} x
 * @param {number | null | undefined} y height
 * @param {number} z
 * @returns {string | null}
 */
export function floorBadge(config, x, y, z) {
  if (y == null) return null;
  for (const layer of config.layers) {
    for (const extent of layer.extents) {
      const [bottom, top] = extent.height;
      if (y < bottom || y >= top) continue;
      if (extent.bounds && !extent.bounds.some((area) => isInsideArea(x, z, area))) continue;
      return badgeName(layer.name);
    }
  }
  return null;
}

/** Whether (x, z) is inside a rectangle given by two corners. */
function isInsideArea(x, z, area) {
  const isInsideX = x >= Math.min(area[0][0], area[1][0]) && x <= Math.max(area[0][0], area[1][0]);
  const isInsideZ = z >= Math.min(area[0][1], area[1][1]) && z <= Math.max(area[0][1], area[1][1]);
  return isInsideX && isInsideZ;
}

/**
 * A floor layer's badge: its first digit ("2nd floor" → "2"), "B" for anything underground,
 * else its first letter.
 * @param {string} layerName
 */
export function badgeName(layerName) {
  const digit = layerName.match(/(\d)/);
  if (digit) return digit[1];
  if (/under|bunker|tunnel|garage|basement|technical|sewer/i.test(layerName)) return "B";
  return layerName[0].toUpperCase();
}

/**
 * Screen rotation (degrees, clockwise from up) of the player arrow for a heading: the same
 * correction tarkov.dev applies (maps turned 90° or 270° need another 180°).
 * @param {MapConfig | { rotation?: number }} config
 * @param {number} yawDegrees
 */
export function arrowRotation(config, yawDegrees) {
  let correction = config.rotation || 0;
  if (correction === 90 || correction === 270) correction += 180;
  return (yawDegrees || 0) + correction;
}
