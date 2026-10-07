// @ts-check
// Loading a map's loot spots from /api/loot/<map> (ticket 08): only when they're needed (the Loot
// section is open or a chip is on), once per map and game data. They're too big to come with
// /api/data (about 1.6 MB for every map together).
import { app } from "../../app/state.js";
import { callApi } from "../../app/api.js";

/** @import { MapLoot } from "./rules.js" */

/**
 * @typedef {object} LoadedLoot One map's loot as loaded (app.lootByMap).
 * @property {object} gameData the game data it belongs to (app.gameData when it was asked for)
 * @property {MapLoot | null} loot null while loading or after an error
 * @property {boolean} failed the server didn't answer; tried again with the next game data
 */

/**
 * The open map's loot when it's loaded. Otherwise starts loading it (once) and returns null;
 * `onLoaded` runs when it arrives, if that map is still open.
 * @param {string} mapKey
 * @param {() => void} onLoaded
 * @returns {MapLoot | null}
 */
export function lootOfMap(mapKey, onLoaded) {
  const loaded = app.lootByMap[mapKey];
  if (loaded && loaded.gameData === app.gameData) return loaded.loot;
  startLoading(mapKey, onLoaded);
  return null;
}

/**
 * Whether loading this map's loot failed (with the current game data).
 * @param {string} mapKey
 */
export function lootFailedToLoad(mapKey) {
  const loaded = app.lootByMap[mapKey];
  return !!loaded && loaded.gameData === app.gameData && loaded.failed;
}

/**
 * @param {string} mapKey
 * @param {() => void} onLoaded
 */
async function startLoading(mapKey, onLoaded) {
  const gameData = app.gameData;
  /** @type {LoadedLoot} */
  const entry = { gameData, loot: null, failed: false };
  app.lootByMap[mapKey] = entry;
  try {
    entry.loot = await callApi("/api/loot/" + encodeURIComponent(mapKey));
  } catch {
    entry.failed = true;
  }
  const isStillWanted = app.lootByMap[mapKey] === entry && app.mapView && app.mapView.key === mapKey;
  if (isStillWanted) onLoaded();
}
