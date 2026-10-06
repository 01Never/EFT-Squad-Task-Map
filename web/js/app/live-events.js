// @ts-check
// The page's one live-event router (CODE-STYLE §6). The server sends events over Server-Sent
// Events (GET /api/events): the connection sits idle until something happens in the game, so the
// page never polls. Each event name maps to one named handler below, which calls into the
// feature that owns it. Events that were queued for the page ("deliver") are acknowledged.
import { app } from "./state.js";
import { findElement, showToast } from "./dom.js";
import { callApi } from "./api.js";
import { save } from "./saving.js";
import { reloadGameData } from "./game-data.js";
import { rerenderPage } from "./routing.js";
import { EVENT_NAMES } from "./event-names.js";
import { activateTask, finishTask } from "../features/tasks/task-list.js";
import { resetAfterRaid, raidOverMessage, modePromptAfterReport } from "../features/raid/rules.js";
import { renderNav } from "../features/raid/nav.js";
import {
  onNewPosition,
  renderPlayer,
  moveViewForNewPosition,
  switchToMapIfFollowing,
} from "../features/find-me/map-layer.js";
import { renderClosestExtract } from "../features/extracts/map-layer.js";
import { onCaptureChanged } from "../features/scan/panel.js";
import { onUpdatesChanged, onStreamConnected } from "../features/updates/panel.js";

/**
 * @import { LiveEvent, TaskEvent, RaidEndEvent, RaidStartEvent, RaidMapEvent, GpsEvent,
 *   CaptureEvent, ModeEvent, KeybindEvent } from "./types.js"
 */

// Acknowledgements are sent once things go quiet for this long, for everything handled so far.
const ACK_DELAY_MS = 300;

/** Open the event stream; "Not connected…" shows while it's down (the browser reconnects by itself). */
export function connectToLiveEvents() {
  const stream = new EventSource("/api/events");
  stream.onmessage = (message) => {
    try {
      handleLiveEvent(JSON.parse(message.data));
    } catch (error) {
      console.error(error);
    }
  };
  stream.onopen = () => {
    findElement("#conn").hidden = true;
    onStreamConnected();
  };
  stream.onerror = () => {
    findElement("#conn").hidden = false;
  };
}

/** Each event name and its handler. */
const HANDLER_BY_EVENT_NAME = {
  [EVENT_NAMES.task]: onTaskChangedInGame,
  [EVENT_NAMES.raidEnd]: onRaidEnded,
  [EVENT_NAMES.raidStart]: onRaidStarted,
  [EVENT_NAMES.raidMap]: onRaidMapKnown,
  [EVENT_NAMES.gps]: onPositionReceived,
  [EVENT_NAMES.capture]: onCaptureChanged,
  [EVENT_NAMES.data]: onGameDataChanged,
  [EVENT_NAMES.mode]: onGameModeReported,
  [EVENT_NAMES.keybind]: onKeybindChecked,
  [EVENT_NAMES.updates]: onUpdatesChanged,
};

/**
 * Hand an event to its handler, then acknowledge it if it was queued (it has an id).
 * @param {LiveEvent & { id?: number }} event
 */
function handleLiveEvent(event) {
  const handler = HANDLER_BY_EVENT_NAME[event.type];
  if (handler) {
    handler(/** @type {any} */ (event));
  }
  if (event.id) {
    acknowledge(event.id);
  }
}

let ackTimer = null;
let ackUpTo = 0;

/**
 * Tell the server every queued event up to this id was handled, so it isn't sent again.
 * @param {number} eventId
 */
function acknowledge(eventId) {
  ackUpTo = Math.max(ackUpTo, eventId);
  clearTimeout(ackTimer);
  ackTimer = setTimeout(() => {
    callApi("/api/events/ack", { method: "POST", body: { upTo: ackUpTo } }).catch(() => {});
  }, ACK_DELAY_MS);
}

// ---------------------------------------------------------------- the handlers

/**
 * A task was accepted (added, with a toast), or finished or failed (removed quietly), in the game.
 * Tasks the game data doesn't know are ignored.
 * @param {TaskEvent} event
 */
function onTaskChangedInGame(event) {
  const task = app.taskById[event.taskId];
  if (!task) return;
  if (event.status === "started") {
    const isNew = activateTask(event.taskId, "log");
    if (isNew) showToast(`Added from the game: ${task.name}`);
  } else {
    finishTask(event.taskId);
  }
  save();
  rerenderPage();
}

/**
 * The raid ended: bag counts and extract marks reset, your position and trail are cleared.
 * @param {RaidEndEvent} event
 */
function onRaidEnded(event) {
  resetAfterRaid(app.saved);
  app.gps = null;
  app.trail = [];
  app.status.raid = { ...app.status.raid, active: false, map: null };
  save();
  rerenderPage();
  showToast(raidOverMessage(event.deleted));
}

/**
 * A raid started: a fresh trail, "● In raid" in the top bar, and the raid's map opens with
 * "Follow my position" on.
 * @param {RaidStartEvent} event
 */
function onRaidStarted(event) {
  app.trail = [];
  app.status.raid = { ...app.status.raid, active: true, map: event.map };
  renderNav();
  switchToMapIfFollowing(event.map);
}

/**
 * The game is loading this map (shown in the top bar).
 * @param {RaidMapEvent} event
 */
function onRaidMapKnown(event) {
  app.status.raid = { ...app.status.raid, map: event.map };
  renderNav();
}

/**
 * A new position from a GPS screenshot: the pulse starts; with "Follow my position" the raid's
 * map opens; on the open map you, the closest extract and (by the auto-center rule) the view update.
 * @param {GpsEvent} event
 */
function onPositionReceived(event) {
  app.gps = event.gps;
  app.trail = event.trail || [];
  onNewPosition();
  if (switchToMapIfFollowing(event.gps.map)) return;
  const mapView = app.mapView;
  const isOnOpenMap = mapView && (!event.gps.map || event.gps.map === mapView.key);
  if (isOnOpenMap) {
    renderPlayer();
    renderClosestExtract();
    moveViewForNewPosition();
  }
}

/** New game data (a download, or another game mode): load it and redraw. */
function onGameDataChanged() {
  reloadGameData();
}

/**
 * The game reported which mode it's in; the top bar may offer to switch data (raid/rules.js).
 * @param {ModeEvent} event
 */
function onGameModeReported(event) {
  app.status.raid = { ...app.status.raid, sessionMode: event.mode };
  const { prompt, hasChanged } = modePromptAfterReport({
    reportedMode: event.mode,
    settingMode: app.status.settings.gameMode,
    currentPrompt: app.modePrompt,
    dismissedMode: app.modeDismissed,
  });
  app.modePrompt = prompt;
  if (hasChanged) renderNav();
}

/**
 * Whether a screenshot key is bound in the game; a warning toast when it isn't.
 * @param {KeybindEvent} event
 */
function onKeybindChecked(event) {
  app.status.keybind = { ok: event.ok, warning: event.warning };
  if (!event.ok) showToast(event.warning);
}
