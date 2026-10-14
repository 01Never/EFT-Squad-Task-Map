// @ts-check
// The game modes the server knows (setting `gameMode`, and what the game log reports), with the
// names the page shows. The order is the order of the Settings drop-down. Each mode is its own
// in-game character, so each has its own task list in the saved data (ticket 22).

/** @type {Record<string, string>} */
export const GAME_MODE_NAMES = { regular: "PvP", pve: "PvE", "pvp-season": "PvP Season" };

/** Every game mode the saved data keeps a task list for, in the order above. */
export const GAME_MODES = Object.keys(GAME_MODE_NAMES);

/** The mode used when Settings (or an event) names none, or one this page doesn't know. */
export const DEFAULT_GAME_MODE = "regular";

/**
 * The mode as given when it's one of GAME_MODES, else the fallback (normally "regular").
 * Example: "pve" → "pve"; undefined, "" or "arena" → "regular".
 * @param {unknown} mode
 * @param {string} [fallback] used for a missing or unknown mode
 * @returns {string}
 */
export function knownGameMode(mode, fallback = DEFAULT_GAME_MODE) {
  if (typeof mode === "string" && GAME_MODES.includes(mode)) return mode;
  return fallback;
}
