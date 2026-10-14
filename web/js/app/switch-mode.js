// @ts-check
// Change the game mode in Settings (what "Switch data" in the top bar does, and what opening
// another mode's page does): save it, take the new status, and tell the squad. Each mode has its
// own task list (ticket 22), so the page then shows that mode's list.
import { app } from "./state.js";
import { callApi } from "./api.js";
import { sendShare } from "../features/squad/share-sync.js";

/**
 * Save `mode` as the Settings game mode. Throws when the program refuses; the caller shows it.
 * The caller redraws the page.
 * @param {string} mode regular, pve or pvp-season
 */
export async function switchGameMode(mode) {
  const response = await callApi("/api/settings", { method: "PUT", body: { gameMode: mode } });
  app.status = response.status;
  if (app.modePrompt === mode) app.modePrompt = null;
  sendShare(false);
}
