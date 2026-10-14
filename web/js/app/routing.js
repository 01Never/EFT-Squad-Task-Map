// @ts-check
// Which page shows. The address decides (addresses.js): the mode select page, a mode's map picker
// or a map. Opening a mode's page switches the game mode in Settings to that mode first, so the
// page never shows one mode's list under another mode's address. Also redraws whatever page is
// showing after something changed outside it (a live event, new game data, Settings).
import { app } from "./state.js";
import { showToast, findElement } from "./dom.js";
import { parseAddress, samePageInMode } from "./addresses.js";
import { showCrumbs } from "./crumbs.js";
import { shownGameMode } from "./current-list.js";
import { GAME_MODE_NAMES } from "./game-modes.js";
import { switchGameMode } from "./switch-mode.js";
import { openMap, renderMapPage, closeMap } from "../map/map-page.js";
import { showPicker } from "../features/picker/panel.js";
import { showModeSelect } from "../features/mode-select/panel.js";
import { renderNav } from "../features/raid/nav.js";

/** The mode being switched to while the program saves it; null otherwise. */
let switchingTo = null;

/** Show the page the address asks for. */
export function showPageForAddress() {
  if (switchingTo) return; // the switch shows the page (for the address of then) when it's done
  const mapKeys = app.mapConfigs.map((config) => config.key);
  const address = parseAddress(location.hash, mapKeys, shownGameMode());
  if (address.page === "redirect") {
    history.replaceState(null, "", address.hash); // no extra history entry
    showPageForAddress();
    return;
  }
  if (address.page !== "select" && address.mode !== shownGameMode()) {
    switchModeThenShowPage(address.mode);
    return;
  }
  if (address.page === "select") {
    showModeSelect();
  } else if (address.page === "picker") {
    showPicker();
  } else {
    openMap(address.mapKey);
  }
}

/**
 * Save the mode, then show the page for the address as it is by then. Meanwhile a short note
 * stands in, so the old mode's list is never shown under the new mode's address.
 * @param {string} mode
 */
async function switchModeThenShowPage(mode) {
  switchingTo = mode;
  closeMap();
  showCrumbs({ page: "select" });
  findElement("#view").innerHTML = `<div class="picker"><p class="lede">Switching to ${GAME_MODE_NAMES[mode]}…</p></div>`;
  try {
    await switchGameMode(mode);
    showToast(`Switched to ${GAME_MODE_NAMES[mode]} data`);
  } catch (error) {
    showToast(String(error.message || error));
    history.replaceState(null, "", "#/");
  }
  switchingTo = null;
  renderNav();
  showPageForAddress();
}

/**
 * Settings now has another game mode (the top bar's "Switch data", or Settings): stay on the same
 * page in the new mode, or just redraw when the page has no mode (the mode select page).
 */
export function followGameMode() {
  const target = samePageInMode(location.hash, shownGameMode());
  if (target && target !== location.hash) {
    history.replaceState(null, "", target);
    showPageForAddress();
  } else {
    rerenderPage();
  }
}

/**
 * Redraw the top bar and the page showing. While a map is still loading (the address says map but
 * the map isn't open yet), the map draws itself when it's ready.
 */
export function rerenderPage() {
  renderNav();
  if (switchingTo) return;
  if (app.mapView) {
    renderMapPage();
    return;
  }
  const mapKeys = app.mapConfigs.map((config) => config.key);
  const address = parseAddress(location.hash, mapKeys, shownGameMode());
  if (address.page === "picker") {
    showPicker();
  } else if (address.page === "select") {
    showModeSelect();
  }
}
