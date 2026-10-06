// @ts-check
// Per-map choices in the saved data (prefs[map]): which extract kinds show, extracts you marked,
// place names on/off, drawings on/off.
import { app } from "./state.js";
import { DEFAULT_SHOWN_EXTRACT_KINDS } from "../features/extracts/rules.js";

/** @import { MapPrefs } from "./types.js" */

/**
 * This map's choices, created with the defaults the first time a map is used.
 * @param {string} mapKey
 * @returns {MapPrefs}
 */
export function mapPrefs(mapKey) {
  const saved = app.saved;
  saved.prefs[mapKey] = saved.prefs[mapKey] || {
    ext: { ...DEFAULT_SHOWN_EXTRACT_KINDS },
    extMarked: {},
    labels: true,
    drawOn: true,
  };
  return saved.prefs[mapKey];
}
