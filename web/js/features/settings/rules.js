// @ts-check
// Settings: the choices the dialogs offer and how the game data's state is described.
// Plain functions only: no DOM, no network. panel.js draws the dialogs.
import { GAME_MODE_NAMES } from "../../app/game-modes.js";

/** @import { GameDataStatus, AiStatus } from "../../app/types.js" */

// The model the OpenAI dialog suggests when none is saved (the server uses the same default).
export const DEFAULT_AI_MODEL = "gpt-6-luna";

/** The reasoning effort choices: value sent to the server, and its name. "" = not chosen: AI Categorize then uses High. */
export const REASONING_EFFORTS = [
  ["", "Default (High)"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
];

/**
 * "Key sk-…abcd · gpt-6-luna · high": what the OpenAI line in Settings says. The effort shown is the
 * one in use (`effortInUse`, so a player who never chose one sees "high"); an older server only
 * sends the saved `effort`.
 * @param {AiStatus} ai
 * @returns {string} plain text
 */
export function aiSummary(ai) {
  const effort = effortShown(ai);
  return `Key ${ai.key} · ${ai.model}${effort ? " · " + effort : ""}`;
}

/**
 * The reasoning effort to show for the AI: the one in use (`effortInUse`), else the saved one
 * (an older server), else "".
 * @param {AiStatus} ai
 */
export function effortShown(ai) {
  return ai.effortInUse ?? ai.effort ?? "";
}

const SECOND_MS = 1000;
const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86400;

/**
 * How long ago something happened, roughly: "just now" (under a minute), "5 min ago", "3 h ago",
 * "2 d ago"; "never" when there's no time.
 * @param {number | null | undefined} thenMs ms since 1970
 * @param {number} nowMs
 */
export function timeAgo(thenMs, nowMs) {
  if (!thenMs) return "never";
  const seconds = Math.round((nowMs - thenMs) / SECOND_MS);
  if (seconds < MINUTE_SECONDS) return "just now";
  if (seconds < HOUR_SECONDS) return Math.round(seconds / MINUTE_SECONDS) + " min ago";
  if (seconds < DAY_SECONDS) return Math.round(seconds / HOUR_SECONDS) + " h ago";
  return Math.round(seconds / DAY_SECONDS) + " d ago";
}

/**
 * "PvP · 515 tasks · downloaded 2 min ago": the game data in use and where it came from (a
 * download, the copy saved from the last download, or the copy built into the program, with its date).
 * @param {GameDataStatus} data
 * @param {number} nowMs
 * @returns {string} plain text
 */
export function gameDataDescription(data, nowMs) {
  const modeName = GAME_MODE_NAMES[data.mode] || data.mode;
  return `${modeName} · ${data.tasks} tasks · ${gameDataOrigin(data, nowMs)}`;
}

/**
 * @param {GameDataStatus} data
 * @param {number} nowMs
 */
function gameDataOrigin(data, nowMs) {
  if (data.origin === "live") return "downloaded " + timeAgo(data.fetchedAt, nowMs);
  if (data.origin === "cache") return "saved copy from " + timeAgo(data.fetchedAt, nowMs);
  const date = data.generated ? " (" + String(data.generated).slice(0, 10) + ")" : "";
  return "built-in copy" + date;
}
