// @ts-check
// Loading a map's loot spots from /api/loot/<map> (ticket 08): only when they're needed (the Loot
// section is open or a chip is on; ticket 09: you have keys on the map, or the My keys section is
// open), once per map and game data. They're too big to come with /api/data (about 1.6 MB for
// every map together).
import { app } from "../../app/state.js";
import { callApi } from "../../app/api.js";

/** @import { MapLoot } from "./rules.js" */

/**
 * @typedef {object} LoadedLoot One map's loot as loaded (app.lootByMap).
 * @property {object} gameData the game data it belongs to (app.gameData when it was asked for)
 * @property {MapLoot | null} loot null while loading or after an error
 * @property {boolean} failed the server didn't answer; tried again with the next game data
 * @property {Promise<MapLoot | null>} [arrived] settles when the answer is in
 * @property {Set<() => void>} [waiting] what to run when it arrives (the loot layer, the panel, the
 *   key doors: each asks while it loads, each is run once)
 */

/**
 * The open map's loot when it's loaded. Otherwise starts loading it (once) and returns null;
 * `onLoaded` runs when it arrives, if that map is still open (each different `onLoaded` once).
 * @param {string} mapKey
 * @param {() => void} onLoaded
 * @returns {MapLoot | null}
 */
export function lootOfMap(mapKey, onLoaded) {
  const loaded = app.lootByMap[mapKey];
  if (loaded && loaded.gameData === app.gameData) {
    const isStillLoading = !loaded.loot && !loaded.failed;
    if (isStillLoading && loaded.waiting) loaded.waiting.add(onLoaded);
    return loaded.loot;
  }
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
 * Any map's loot (not only the open one's), loading it once if needed: for copying a key list
 * from another map and for the "all keys" search (ticket 09). null when it can't be loaded.
 * @param {string} mapKey
 * @returns {Promise<MapLoot | null>}
 */
export function loadLootOfMap(mapKey) {
  const loaded = app.lootByMap[mapKey];
  if (loaded && loaded.gameData === app.gameData) return loaded.arrived || Promise.resolve(loaded.loot);
  return startLoading(mapKey, () => {});
}

/**
 * Every map's loot loaded so far for the current game data.
 * @returns {MapLoot[]}
 */
export function loadedLoots() {
  const loots = [];
  for (const loaded of Object.values(app.lootByMap)) {
    if (loaded.gameData === app.gameData && loaded.loot) loots.push(loaded.loot);
  }
  return loots;
}

/**
 * @param {string} mapKey
 * @param {() => void} onLoaded
 * @returns {Promise<MapLoot | null>}
 */
function startLoading(mapKey, onLoaded) {
  const gameData = app.gameData;
  /** @type {LoadedLoot} */
  const entry = { gameData, loot: null, failed: false, waiting: new Set([onLoaded]) };
  app.lootByMap[mapKey] = entry;
  entry.arrived = (async () => {
    try {
      entry.loot = await callApi("/api/loot/" + encodeURIComponent(mapKey));
    } catch {
      entry.failed = true;
    }
    const isStillWanted = app.lootByMap[mapKey] === entry && app.mapView && app.mapView.key === mapKey;
    const waiting = [...entry.waiting];
    entry.waiting.clear();
    if (isStillWanted) waiting.forEach((run) => run());
    return entry.loot;
  })();
  return entry.arrived;
}
