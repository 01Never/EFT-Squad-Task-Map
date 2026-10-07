// @ts-check
// The pre-raid check (ticket 09): when a raid starts on a map you have keys for, the toast says
// "Bring your 5 keys for Customs", and its button opens that map's list. Called by
// app/live-events.js on the `raidStart` event.
import { app } from "../../app/state.js";
import { showToast } from "../../app/dom.js";
import { keyListOf, bringKeysReminder } from "./rules.js";
import { showKeysSection } from "./panel.js";

/**
 * A raid started on this map: remind you of your keys for it (nothing when the list is empty or
 * the map isn't known).
 * @param {string | null} mapKey
 */
export function remindKeysAtRaidStart(mapKey) {
  if (!mapKey) return;
  const config = app.mapConfigs.find((candidate) => candidate.key === mapKey);
  if (!config) return;
  const message = bringKeysReminder(keyListOf(app.saved, mapKey).length, config.name);
  if (!message) return;
  showToast(message, { label: "Show list", run: () => openKeyListOf(mapKey) });
}

/**
 * Open the map's key list: the section opens, on that map (opening it when another one shows).
 * @param {string} mapKey
 */
function openKeyListOf(mapKey) {
  if (app.mapView && app.mapView.key === mapKey) {
    showKeysSection();
    return;
  }
  app.keysSectionOpen = true;
  location.hash = "#/map/" + mapKey;
}
