// @ts-check
// Extracts: their kinds and colours, which extracts count as "yours" and which of them is closest
// to you. Plain functions only: no DOM, no network. map-layer.js and panel.js draw the result.

/** @import { MapInfo } from "../../app/types.js" */

/**
 * @typedef {{ n: string, k: "pmc" | "scav" | "shared" | "transit", x: number, z: number, ol?: number[][] }} Extract
 *   An extract or transit on the open map. `n` is its name, `k` its kind (the chip it belongs to).
 */

/** Which kinds a map shows before you change its chips: PMC, Shared and Transits, not Scav. */
export const DEFAULT_SHOWN_EXTRACT_KINDS = { pmc: true, scav: false, shared: true, transit: true };

/** The chips in the panel, in order: kind and label. */
export const EXTRACT_CHIPS = [
  ["pmc", "PMC"],
  ["scav", "Scav"],
  ["shared", "Shared"],
  ["transit", "Transits"],
];

/** Each kind's colour (tarkov.dev's green, blue, orange and purple; see --green etc. in base.css). */
export const EXTRACT_KIND_COLORS = { pmc: "#00a700", scav: "#0292c0", shared: "#ca8a00", transit: "#8c6edf" };

/**
 * An extract's kind from its faction in the game data: "scav", "pmc", else "shared".
 * @param {{ fa: string }} extract
 * @returns {"pmc" | "scav" | "shared"}
 */
export function extractKind(extract) {
  if (extract.fa === "scav") return "scav";
  if (extract.fa === "pmc") return "pmc";
  return "shared";
}

/**
 * Every extract and transit of a map, each with its kind (`k`): extracts first, then transits.
 * @param {MapInfo} mapInfo
 * @returns {Extract[]}
 */
export function extractsAndTransits(mapInfo) {
  const extracts = mapInfo.extracts.map((extract) => ({ ...extract, k: extractKind(extract) }));
  const transits = mapInfo.transits.map((transit) => ({ ...transit, k: /** @type {"transit"} */ ("transit") }));
  return extracts.concat(transits);
}

/**
 * How many extracts of each kind a map has (the numbers on the chips).
 * @param {Extract[]} extracts
 */
export function countExtractsByKind(extracts) {
  const counts = { pmc: 0, scav: 0, shared: 0, transit: 0 };
  for (const extract of extracts) counts[extract.k]++;
  return counts;
}

/**
 * Mark or unmark an extract as one of yours (a click on the map). Marks are per map.
 * @param {Record<string, unknown>} markedByName prefs[map].extMarked, changed in place
 * @param {string} name
 */
export function toggleExtractMark(markedByName, name) {
  if (markedByName[name]) delete markedByName[name];
  else markedByName[name] = true;
}

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
