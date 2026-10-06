// @ts-check
// Find me: the rules behind the player marker's pulse and the "you're over there" chip.
// Plain functions only: no DOM, no network. map-layer.js does the drawing and calls these.

// Owner decision (ticket 01): a new position pulses very obviously for about 20 seconds,
// then the marker sits still. No continuous radar, no "stale" pulse.
export const PULSE_DURATION_MS = 20_000;

// One ring grows and fades in this time. Three rings start a third of a cycle apart,
// so a new ring leaves the marker every half second.
export const PULSE_RING_CYCLE_MS = 1_500;
export const PULSE_RING_COUNT = 3;

// The player counts as "on screen" when the marker's centre is at least this far inside the
// map area. Closer to the edge than this, most of the marker is cut off.
export const ON_SCREEN_MARGIN_PIXELS = 12;

// Gap between the off-screen chip and the edge of the map area.
export const CHIP_EDGE_GAP_PIXELS = 8;

/**
 * How long the pulse still has to run.
 * @param {number} pulseStartedAtMs when the pulse started (0 = never)
 * @param {number} nowMs
 * @returns {number} milliseconds left; 0 when the pulse is over
 */
export function pulseRemainingMs(pulseStartedAtMs, nowMs) {
  if (!pulseStartedAtMs) {
    return 0;
  }
  const elapsedMs = nowMs - pulseStartedAtMs;
  if (elapsedMs < 0 || elapsedMs >= PULSE_DURATION_MS) {
    return 0;
  }
  return PULSE_DURATION_MS - elapsedMs;
}

/**
 * CSS timing for each pulse ring, so the rings end together exactly when the pulse ends.
 *
 * The map can be re-drawn (or re-opened) while a pulse runs. Starting each ring with a
 * negative delay of "time already elapsed" picks the animation up where it was, instead of
 * restarting the 20 seconds.
 *
 * @param {number} elapsedMs time since the pulse started
 * @returns {{ delayMs: number, iterations: number }[]} one entry per ring; empty when the pulse is over
 */
export function pulseRingTimings(elapsedMs) {
  if (elapsedMs < 0 || elapsedMs >= PULSE_DURATION_MS) {
    return [];
  }
  const timings = [];
  for (let ring = 0; ring < PULSE_RING_COUNT; ring++) {
    const staggerMs = (ring * PULSE_RING_CYCLE_MS) / PULSE_RING_COUNT;
    const ringRunTimeMs = PULSE_DURATION_MS - staggerMs;
    timings.push({
      delayMs: staggerMs - elapsedMs,
      iterations: ringRunTimeMs / PULSE_RING_CYCLE_MS,
    });
  }
  return timings;
}

/**
 * Whether a point is inside the map area, at least `marginPixels` from every edge.
 * @param {{ x: number, y: number }} point in pixels, relative to the map area's top-left
 * @param {{ width: number, height: number }} area
 * @param {number} marginPixels
 */
export function isInsideArea(point, area, marginPixels) {
  const isInsideHorizontally = point.x >= marginPixels && point.x <= area.width - marginPixels;
  const isInsideVertically = point.y >= marginPixels && point.y <= area.height - marginPixels;
  return isInsideHorizontally && isInsideVertically;
}

/**
 * Where to put the off-screen chip: on the line from the map area's centre toward the player,
 * as far out as the chip fits inside the area.
 *
 * @param {{ width: number, height: number }} area the map area, in pixels
 * @param {{ x: number, y: number }} target the player's position, in pixels (outside the area)
 * @param {{ width: number, height: number }} chipSize
 * @param {number} gapPixels space to leave between the chip and the area's edge
 * @returns {{ x: number, y: number, angleDegrees: number }} the chip's centre, and the
 *   direction toward the player (0 = right, 90 = down)
 */
export function chipPositionToward(area, target, chipSize, gapPixels) {
  const centerX = area.width / 2;
  const centerY = area.height / 2;
  const towardX = target.x - centerX;
  const towardY = target.y - centerY;
  const angleDegrees = (Math.atan2(towardY, towardX) * 180) / Math.PI;

  // The chip's centre may move this far from the area's centre and still fit.
  const roomX = Math.max(0, centerX - chipSize.width / 2 - gapPixels);
  const roomY = Math.max(0, centerY - chipSize.height / 2 - gapPixels);

  // Walk along the line toward the player until the first of the two limits is reached.
  const scaleToFitX = towardX === 0 ? Infinity : roomX / Math.abs(towardX);
  const scaleToFitY = towardY === 0 ? Infinity : roomY / Math.abs(towardY);
  const scale = Math.min(scaleToFitX, scaleToFitY, 1);

  return {
    x: centerX + towardX * scale,
    y: centerY + towardY * scale,
    angleDegrees,
  };
}

/**
 * Straight-line distance between two game positions, ignoring height.
 * Tarkov's game units are metres.
 * @param {{ x: number, z: number }} from
 * @param {{ x: number, z: number }} to
 */
export function distanceMeters(from, to) {
  return Math.hypot(to.x - from.x, to.z - from.z);
}

/**
 * Short distance text for the map: "40 m", "240 m", "1.2 km".
 * Rounded to 10 m (5 m when close), since the position is only as fresh as the last screenshot.
 * @param {number} meters
 */
export function formatDistance(meters) {
  if (meters >= 1000) {
    return (meters / 1000).toFixed(1) + " km";
  }
  if (meters < 100) {
    return Math.round(meters / 5) * 5 + " m";
  }
  return Math.round(meters / 10) * 10 + " m";
}
