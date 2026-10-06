// @ts-check
// Start-up only: load the map settings, game data, status and saved data from the program, migrate
// old saved data, then show the page the address asks for and listen for live events.
// Everything else lives in app/, map/, panel/ and features/.
import { app } from "./app/state.js";
import { findElement, escapeHtml } from "./app/dom.js";
import { fetchJson } from "./app/api.js";
import { migrateSavedData, SAVED_DATA_VERSION } from "./app/saved-data.js";
import { flush, saveMigratedData, saveUnsavedChangesOnClose } from "./app/saving.js";
import { indexGameData } from "./app/game-data.js";
import { showPageForAddress, rerenderPage } from "./app/routing.js";
import { connectToLiveEvents } from "./app/live-events.js";
import { renderNav } from "./features/raid/nav.js";
import { openSettings } from "./features/settings/panel.js";
import { renderUpdateDot, showUpdatedNotice } from "./features/updates/panel.js";

saveUnsavedChangesOnClose();
addEventListener("hashchange", showPageForAddress);
document.addEventListener("visibilitychange", onVisibilityChanged);
start();

/**
 * Coming back to the tab redraws the page, which keeps the "x min ago" of your position honest
 * without a timer. Leaving it saves anything unsaved straight away.
 */
function onVisibilityChanged() {
  if (document.visibilityState === "visible" && app.saved) {
    rerenderPage();
  } else {
    flush();
  }
}

async function start() {
  try {
    const [mapConfigs, gameData, status, savedData] = await Promise.all(
      ["/api/config", "/api/data", "/api/status", "/api/state"].map(fetchJson),
    );
    app.mapConfigs = mapConfigs;
    app.gameData = gameData;
    app.status = status;
    app.gps = status.gps;
    app.trail = status.trail || [];
    const isOlderData = savedData && savedData.version !== SAVED_DATA_VERSION;
    app.saved = migrateSavedData(savedData);
    indexGameData();
    if (isOlderData) await saveMigratedData();
    findElement("#saved").textContent = savedData ? "Saved ✓" : "";
    findElement("#settings").onclick = openSettings;
    renderNav();
    renderUpdateDot();
    connectToLiveEvents();
    showPageForAddress();
    showUpdatedNotice();
  } catch (error) {
    showStartUpError(error);
  }
}

/** The program didn't answer (or answered nonsense): say so instead of a blank page. */
function showStartUpError(error) {
  findElement("#view").innerHTML = `<div class="picker"><h1>Couldn't start</h1><p>${escapeHtml(error.message || error)}</p><p>Is the Squad Task Map program still running?</p></div>`;
}
