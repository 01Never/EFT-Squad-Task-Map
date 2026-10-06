// @ts-check
// Raid: what the page does when a raid ends, and when to ask "switch game data?" after the game
// reports a game mode. Plain functions only: no DOM, no network. nav.js shows the raid and the
// prompt in the top bar; app/live-events.js calls these when the events arrive.

/** @import { SavedState } from "../../app/types.js" */

/**
 * After a raid: the bag is empty again and no extract is marked on any map (owner's rules, v2).
 * Changes the saved data in place.
 * @param {SavedState} saved
 */
export function resetAfterRaid(saved) {
  saved.have = {};
  saved.used = {};
  for (const mapKey of Object.keys(saved.prefs)) {
    saved.prefs[mapKey].extMarked = {};
  }
}

/**
 * The toast after a raid: "Raid over: bag counts and extract marks reset, 2 GPS screenshots
 * deleted" (the server deletes that raid's GPS screenshots and says how many).
 * @param {number} deletedScreenshots
 */
export function raidOverMessage(deletedScreenshots) {
  let message = "Raid over: bag counts and extract marks reset";
  if (deletedScreenshots) {
    const plural = deletedScreenshots > 1 ? "s" : "";
    message += `, ${deletedScreenshots} GPS screenshot${plural} deleted`;
  }
  return message;
}

/**
 * @typedef {object} ModePromptSituation
 * @property {string} reportedMode the game mode the log just reported
 * @property {string} settingMode the game mode in Settings (which data the app uses)
 * @property {string | null} currentPrompt the mode the top bar offers to switch to, if any
 * @property {string | null} dismissedMode the mode you said "Not now" to
 */

/**
 * The "Game says PvE · Switch data / Not now" prompt after the game reports a mode:
 * - the same mode as Settings: no prompt (an earlier one goes away);
 * - another mode you haven't said "Not now" to: offer to switch to it;
 * - the mode you said "Not now" to: leave things as they are.
 * The game logs a mode more than once at start-up (real logs: "Pve" then "PvpSeason"); the last
 * one counts, so each report decides afresh.
 * @param {ModePromptSituation} situation
 * @returns {{ prompt: string | null, hasChanged: boolean }}
 */
export function modePromptAfterReport(situation) {
  if (situation.reportedMode === situation.settingMode) {
    return { prompt: null, hasChanged: !!situation.currentPrompt };
  }
  if (situation.dismissedMode !== situation.reportedMode) {
    return { prompt: situation.reportedMode, hasChanged: true };
  }
  return { prompt: situation.currentPrompt, hasChanged: false };
}
