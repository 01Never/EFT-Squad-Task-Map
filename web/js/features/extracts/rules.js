// @ts-check
// Extracts: which extracts count as "yours" and which of them is closest to you.
// Plain functions only: no DOM, no network. map-layer.js draws the result.

/**
 * @typedef {{ n: string, k: "pmc" | "scav" | "shared" | "transit", x: number, z: number }} Extract
 *   An extract or transit on the open map. `n` is its name, `k` its kind (the chip it belongs to).
 */

/**
 * The extracts that count when looking for the closest one (ticket 03, owner's rules):
 * 1. If you've marked any extracts on this map (click on the map), only those count. A transit
 *    counts only this way, when you've marked it yourself.
 * 2. With nothing marked, every extract whose kind is shown by the chips (PMC / Scav / Shared)
 *    counts, and the result is labelled "closest shown". Transits never count here.
 *
 * @param {Extract[]} extracts every extract and transit on the map
 * @param {Record<string, unknown>} markedByName prefs[map].extMarked (a name → truthy value)
 * @param {Record<string, boolean>} shownKinds prefs[map].ext (which chips are on)
 * @returns {{ candidates: Extract[], basis: "marked" | "shown" }}
 */
export function extractsThatCount(extracts, markedByName, shownKinds) {
  const marked = extracts.filter((extract) => !!markedByName[extract.n]);
  if (marked.length > 0) {
    return { candidates: marked, basis: "marked" };
  }
  const shown = extracts.filter((extract) => extract.k !== "transit" && !!shownKinds[extract.k]);
  return { candidates: shown, basis: "shown" };
}

/**
 * The candidate closest to you, by straight-line distance on the map (x/z), ignoring height.
 * Tarkov's game units are metres. There's no walking-path data, so this is "as the crow flies".
 *
 * @param {{ x: number, z: number }} position
 * @param {Extract[]} candidates
 * @returns {{ extract: Extract, distanceMeters: number } | null} null when there are no candidates
 */
export function closestExtract(position, candidates) {
  let best = null;
  for (const extract of candidates) {
    const distanceMeters = Math.hypot(extract.x - position.x, extract.z - position.z);
    if (!best || distanceMeters < best.distanceMeters) {
      best = { extract, distanceMeters };
    }
  }
  return best;
}

/**
 * Distance text for the closest extract: "~180 m". The "~" is there because it's a straight line,
 * not the walking distance. Rounded to 10 m (5 m when close).
 * @param {number} meters
 */
export function approximateDistanceText(meters) {
  if (meters < 100) {
    return "~" + Math.round(meters / 5) * 5 + " m";
  }
  if (meters >= 1000) {
    return "~" + (meters / 1000).toFixed(1) + " km";
  }
  return "~" + Math.round(meters / 10) * 10 + " m";
}
