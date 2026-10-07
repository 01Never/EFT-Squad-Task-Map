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
import { showExtractsNoticeIfDue } from "./features/extracts/notice.js";
import { renderUpdateDot, showUpdatedNotice } from "./features/updates/panel.js";
import { sendShare } from "./features/squad/share-sync.js";
import { shouldSendShareAtStart } from "./features/squad/rules.js";

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
    app.squad = await loadSquad();
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
    showExtractsNoticeIfDue();
    if (shouldSendShareAtStart(app.squad)) sendShare(true);
  } catch (error) {
    showStartUpError(error);
  }
}

/**
 * The squad as the program sees it (GET /api/squad), or null when it doesn't answer: the squad is
 * optional, so a failure here never stops the page from starting.
 */
async function loadSquad() {
  try {
    const view = await fetchJson("/api/squad");
    return view && view.me ? view : null;
  } catch {
    return null;
  }
}

/** The program didn't answer (or answered nonsense): say so instead of a blank page. */
function showStartUpError(error) {
  findElement("#view").innerHTML = `<div class="picker"><h1>Couldn't start</h1><p>${escapeHtml(error.message || error)}</p><p>Is the Squad Task Map program still running?</p></div>`;
}
