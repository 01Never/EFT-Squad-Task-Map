// @ts-check
// Raid in the top bar: "● In raid: Streets of Tarkov", which game data is in use ("PvE data"),
// and the "Game says PvE · Switch data / Not now" prompt with its two buttons.
// The rules are in rules.js; the raid itself is followed by the server (internal/features/raid).
import { app } from "../../app/state.js";
import { escapeHtml, findElement, showToast } from "../../app/dom.js";
import { switchGameMode } from "../../app/switch-mode.js";
import { GAME_MODE_NAMES } from "../../app/game-modes.js";
import { followGameMode } from "../../app/routing.js";

/** Draw the raid part of the top bar (#navinfo) and wire up the prompt's buttons. */
export function renderNav() {
  findElement("#navinfo").innerHTML = renderModePrompt() + renderRaidStatus() + renderDataInUse();
  const switchButton = findElement("#modeSwitch");
  if (switchButton) {
    switchButton.onclick = onSwitchDataClicked;
    findElement("#modeNo").onclick = onNotNowClicked;
  }
}

/** "● In raid: Customs" while a raid runs (the map name hides on a phone). */
function renderRaidStatus() {
  const raid = app.status.raid;
  if (!raid.active) return "";
  const mapName = raid.map ? `<span class="hm">: ${escapeHtml(mapNameForNav(raid.map))}</span>` : "";
  return `<span class="raid">● In raid${mapName}</span>`;
}

/** "Game says PvE · Switch data  Not now", when the game is in another mode than Settings. */
function renderModePrompt() {
  if (!app.modePrompt) return "";
  const modeName = escapeHtml(GAME_MODE_NAMES[app.modePrompt]);
  return `<span class="modewarn"><span class="hm">Game says </span>${modeName} · <button class="lnk" id="modeSwitch">Switch data</button> <button class="lnk" id="modeNo">Not now</button></span>`;
}

/** "PvP data", "(built-in)" when there's no download yet. Hidden on narrow screens. */
function renderDataInUse() {
  const data = app.status.data;
  const modeName = escapeHtml(GAME_MODE_NAMES[data.mode] || data.mode);
  const builtIn = data.origin === "built-in" ? " (built-in)" : "";
  return `<span class="dd">${modeName} data${builtIn}</span>`;
}

/**
 * The raid's map name as the top bar shows it: the name from maps-config.json, or the key for a
 * map this app has no art for. (Unlike app/game-data.js mapDisplayName, Labs shows as its key.)
 * @param {string} mapKey
 */
function mapNameForNav(mapKey) {
  const config = app.mapConfigs.find((candidate) => candidate.key === mapKey);
  return (config && config.name) || mapKey;
}

/**
 * "Switch data": change Settings' game mode to the one the game reported. That mode's own task
 * list shows straight away (ticket 22), on the same page (the picker or map) in that mode, and
 * the squad gets it.
 */
async function onSwitchDataClicked() {
  const mode = app.modePrompt;
  app.modePrompt = null;
  try {
    await switchGameMode(mode);
    showToast(`Switched to ${GAME_MODE_NAMES[mode]} data`);
    followGameMode();
  } catch (error) {
    showToast(String(error.message || error));
  }
  renderNav();
}

/** "Not now": no prompt for this mode until the game reports another one. */
function onNotNowClicked() {
  app.modeDismissed = app.modePrompt;
  app.modePrompt = null;
  renderNav();
}
