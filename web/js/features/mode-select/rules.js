// @ts-check
// The mode select page's cards: what each game mode's card says. No DOM.
import { GAME_MODE_NAMES } from "../../app/game-modes.js";

/** @import { SavedState } from "../../app/types.js" */

/**
 * @typedef {object} ModeCard
 * @property {string} mode regular, pve or pvp-season
 * @property {string} name "PvP", "PvE", "PvP Season"
 * @property {string} kind "Regular" or "Seasonal"
 * @property {number} activeTasks tasks on that mode's list that you have accepted and not finished
 * @property {boolean} lastUsed the mode in Settings
 * @property {boolean} gameIsInThisMode the game's log says this is the mode it is in
 */

/** The cards in the game's order: PvE Zone, PvP Zone, PvP Season. */
const CARD_ORDER = ["pve", "regular", "pvp-season"];

/**
 * @param {SavedState} saved
 * @param {string} settingsMode the mode in Settings
 * @param {string | null | undefined} sessionMode the mode the game log reported, if any
 * @returns {ModeCard[]}
 */
export function modeCards(saved, settingsMode, sessionMode) {
  return CARD_ORDER.map((mode) => ({
    mode,
    name: GAME_MODE_NAMES[mode],
    kind: mode === "pvp-season" ? "Seasonal" : "Regular",
    activeTasks: countActiveTasks(saved, mode),
    lastUsed: mode === settingsMode,
    gameIsInThisMode: !!sessionMode && sessionMode === mode,
  }));
}

/**
 * @param {SavedState} saved
 * @param {string} mode
 */
function countActiveTasks(saved, mode) {
  const list = saved.modes && saved.modes[mode];
  if (!list) return 0;
  return Object.values(list.tasks).filter((entry) => entry.active).length;
}
