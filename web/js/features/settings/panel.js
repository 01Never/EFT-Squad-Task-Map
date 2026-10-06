// @ts-check
// Settings: the Settings dialog (game mode, game folders, Follow my position, Center on me, game
// data, OpenAI) and the OpenAI key dialog. The settings live on the server
// (squad-task-map-settings.json); these dialogs read /api/status and save with PUT requests.
// The texts that depend on a rule are in rules.js.
import { app } from "../../app/state.js";
import { escapeHtml, findElement, showToast, openModal } from "../../app/dom.js";
import { callApi } from "../../app/api.js";
import { GAME_MODE_NAMES } from "../../app/game-modes.js";
import { reloadGameData } from "../../app/game-data.js";
import { rerenderPage } from "../../app/routing.js";
import { renderUpdatesSectionBox, bindUpdatesSection } from "../updates/panel.js";
import { DEFAULT_AI_MODEL, REASONING_EFFORTS, gameDataDescription } from "./rules.js";

/** @import { FolderStatus, Status } from "../../app/types.js" */

// How long after opening the key dialog its field gets focus (after the dialog is on screen).
const FOCUS_KEY_FIELD_AFTER_MS = 50;

// ---------------------------------------------------------------- the Settings dialog

/** ⚙ Settings. */
export function openSettings() {
  const { el: dialog, close } = openModal(renderSettings(app.status));
  findElement("#sClose", dialog).onclick = close;
  findElement("#sAI", dialog).onclick = () => {
    close();
    openAiKeyDialog();
  };
  findElement("#sRefresh", dialog).onclick = (event) => onUpdateGameDataClicked(event.target, close);
  findElement("#sSave", dialog).onclick = () => onSaveClicked(dialog, close);
  bindUpdatesSection(dialog);
}

/** @param {Status} status */
function renderSettings(status) {
  return `<h3>Settings</h3>
    ${renderGameModeRow(status)}
    <label class="frow"><span>Game logs folder</span><input type="text" id="sLogs" value="${escapeHtml(status.settings.logsPath)}" placeholder="Found automatically — or paste e.g. C:\\Battlestate Games\\EFT\\Logs"></label>
    <p class="mnote">${renderFolderStatus(status.logs)}</p>
    <label class="frow"><span>Screenshots folder</span><input type="text" id="sShots" value="${escapeHtml(status.settings.screenshotsPath)}" placeholder="Found automatically — Documents\\Escape From Tarkov\\Screenshots"></label>
    <p class="mnote">${renderFolderStatus(status.screenshots)}${renderKeybindWarning(status)}</p>
    ${renderFollowCheckboxes(status)}
    <h4>Game data</h4>
    ${renderGameDataStatus(status)}
    <button class="btn sm line" id="sRefresh">${status.data.refreshing ? "Updating…" : "Update game data now"}</button>
    <h4>OpenAI</h4><p class="mnote">${renderAiStatus(status)} <button class="lnk" id="sAI">Change</button></p>
    ${renderUpdatesSectionBox()}
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn line" id="sClose">Close</button><button class="btn" id="sSave">Save</button></div>`;
}

/** The game mode drop-down, and a warning when the game says you're playing another mode. */
function renderGameModeRow(status) {
  const settings = status.settings;
  const options = Object.entries(GAME_MODE_NAMES)
    .map(([mode, name]) => `<option value="${mode}" ${settings.gameMode === mode ? "selected" : ""}>${name}</option>`)
    .join("");
  const sessionMode = status.raid.sessionMode;
  const warning =
    sessionMode && sessionMode !== settings.gameMode
      ? `<b class="warnc">The game says you're playing ${escapeHtml(GAME_MODE_NAMES[sessionMode])}.</b>`
      : "";
  return `<label class="frow"><span>Game mode</span><select id="sMode">${options}</select></label>
    <p class="mnote">Which task data to use, and which game sessions' log events count. ${warning}</p>`;
}

/**
 * "✓ C:\…\Logs" when the server found the folder, "✗ <why not>" otherwise.
 * @param {FolderStatus} folder
 */
function renderFolderStatus(folder) {
  const mark = folder.ok ? '<span class="ok">✓ ' : '<span class="bad">✗ ';
  return mark + escapeHtml(folder.ok ? folder.dir || "" : folder.message) + "</span>";
}

/** The game log says no screenshot key is bound: GPS and scans can't work. */
function renderKeybindWarning(status) {
  if (!status.keybind || status.keybind.ok) return "";
  return `<br><b class="warnc">${escapeHtml(status.keybind.warning)}</b>`;
}

/** "Follow my position" and "Center the map on me" (the latter is ◎ Follow on the map, ticket 02). */
function renderFollowCheckboxes(status) {
  const settings = status.settings;
  return `<label class="chk frow"><input type="checkbox" id="sFollow" ${settings.followPosition ? "checked" : ""}> Follow my position (switch to the raid's map when a GPS screenshot comes in)</label>
    <label class="chk frow"><input type="checkbox" id="sCenter" ${settings.autoCenter ? "checked" : ""}> Center the map on me when I take a screenshot (keeps your zoom; same as ◎ Follow on the map)</label>`;
}

/** "PvP · 515 tasks · downloaded 2 min ago", and the last update error if there was one. */
function renderGameDataStatus(status) {
  const data = status.data;
  const error = data.error ? `<br><span class="bad">Last update failed: ${escapeHtml(data.error)}</span>` : "";
  return `<p class="mnote">${escapeHtml(gameDataDescription(data, Date.now()))}${error}</p>`;
}

/** "Key sk-…abcd · gpt-5.4-mini · low", or that there's no key yet. */
function renderAiStatus(status) {
  const ai = status.ai;
  if (!ai.hasKey) return "No key yet — needed for Scan tasks and AI Categorize.";
  const effort = ai.effort ? " · " + escapeHtml(ai.effort) : "";
  return `Key ${escapeHtml(ai.key)} · ${escapeHtml(ai.model)}${effort}`;
}

/**
 * "Update game data now": download it on the server, then load it here and close the dialog.
 * @param {HTMLButtonElement} button
 * @param {() => void} close
 */
async function onUpdateGameDataClicked(button, close) {
  button.disabled = true;
  button.textContent = "Updating…";
  try {
    const answer = await callApi("/api/data/refresh", { method: "POST" });
    showToast(`Game data updated: ${answer.tasks} tasks`);
    await reloadGameData();
    close();
  } catch (error) {
    showToast("Update failed — " + String(error.message || error).slice(0, 120));
    button.disabled = false;
    button.textContent = "Update game data now";
  }
}

/**
 * Save: every field at once; the server answers with the new status.
 * @param {HTMLElement} dialog
 * @param {() => void} close
 */
async function onSaveClicked(dialog, close) {
  const field = (selector) => findElement(selector, dialog);
  const changes = {
    gameMode: field("#sMode").value,
    logsPath: field("#sLogs").value,
    screenshotsPath: field("#sShots").value,
    followPosition: field("#sFollow").checked,
    autoCenter: field("#sCenter").checked,
  };
  try {
    const answer = await callApi("/api/settings", { method: "PUT", body: changes });
    app.status = answer.status;
    close();
    showToast("Settings saved");
    rerenderPage();
  } catch (error) {
    showToast(String(error.message || error));
  }
}

// ---------------------------------------------------------------- the OpenAI key dialog

/** The OpenAI dialog: key, model, reasoning effort; "Save & test" and "Remove key". */
export function openAiKeyDialog() {
  const { el: dialog, close } = openModal(renderAiKeyDialog(app.status.ai));
  findElement("#aiclose", dialog).onclick = close;
  findElement("#aisave", dialog).onclick = () => onSaveKeyClicked(dialog, close);
  const removeButton = findElement("#aidel", dialog);
  if (removeButton) removeButton.onclick = () => onRemoveKeyClicked(close);
  setTimeout(() => findElement("#aikey", dialog).focus(), FOCUS_KEY_FIELD_AFTER_MS);
}

/** @param {import("../../app/types.js").AiStatus} ai */
function renderAiKeyDialog(ai) {
  const keyPlaceholder = ai.hasKey ? escapeHtml(ai.key) + " (saved — leave blank to keep)" : "sk-…";
  const effortOptions = REASONING_EFFORTS.map(
    ([value, name]) => `<option value="${value}" ${(ai.effort || "") === value ? "selected" : ""}>${name}</option>`,
  ).join("");
  const removeButton = ai.hasKey ? '<button class="btn danger" id="aidel">Remove key</button>' : "<span></span>";
  return `<h3>OpenAI</h3>
    <p class="mnote">Used for <b>Scan tasks</b> (reading your task-list screenshots) and <b>AI Categorize</b>.</p>
    <ol><li>Create a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a> (the account needs API credit).</li><li>Paste it here. The default model is fine; change it if your account uses a different one.</li></ol>
    <div class="row" style="margin-bottom:8px"><input type="password" id="aikey" placeholder="${keyPlaceholder}" autocomplete="off"></div>
    <div class="row" style="margin-bottom:8px"><label style="font-size:14px;color:var(--muted);width:80px">Model</label><input type="text" id="aimodel" value="${escapeHtml(ai.model || DEFAULT_AI_MODEL)}"></div>
    <div class="row"><label style="font-size:14px;color:var(--muted);width:80px">Reasoning</label><select id="aieffort" style="flex:1">${effortOptions}</select><button class="btn" id="aisave">Save & test</button></div>
    <div class="err" id="aierr"></div>
    <p class="mnote" style="margin-top:12px">Scanning sends each screenshot (shrunk to 2048 px) to OpenAI; AI Categorize sends task data plus wiki excerpts. Both are billed to this key's account. The key is stored in plain text in <code>squad-task-map-settings.json</code> next to the program and only sent to api.openai.com.</p>
    <div class="row" style="margin-top:14px;justify-content:space-between">${removeButton}<button class="btn line" id="aiclose">Close</button></div>`;
}

/**
 * "Save & test": the server tries the key with OpenAI before saving it; a wrong key shows why.
 * @param {HTMLElement} dialog
 * @param {() => void} close
 */
async function onSaveKeyClicked(dialog, close) {
  const errorLine = findElement("#aierr", dialog);
  const field = (selector) => findElement(selector, dialog);
  errorLine.textContent = "Testing key…";
  try {
    const body = { key: field("#aikey").value.trim(), model: field("#aimodel").value.trim(), effort: field("#aieffort").value };
    const answer = await callApi("/api/ai/key", { method: "PUT", body });
    app.status.ai = { hasKey: answer.hasKey, key: answer.key, model: answer.model, effort: answer.effort };
    close();
    showToast("OpenAI key saved");
    rerenderPage();
  } catch (error) {
    errorLine.textContent = String(error.message || error);
  }
}

/** "Remove key": the server forgets it. */
async function onRemoveKeyClicked(close) {
  await callApi("/api/ai/key", { method: "DELETE" });
  app.status.ai = { ...app.status.ai, hasKey: false, key: null };
  close();
  rerenderPage();
}
