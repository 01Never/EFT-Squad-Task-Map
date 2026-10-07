// @ts-check
// Settings → Squad: join with an invite code (it can take up to 90 seconds; the server's error is
// shown as it is), and once joined: the status line, your name and colour, "Share my tasks" (off
// by default), and Leave. The program does the work (POST /api/squad/join, PUT /api/squad/profile,
// POST /api/squad/leave); this file is the form. Nothing here runs on a timer.
import { app } from "../../app/state.js";
import { escapeHtml, findElement, showToast } from "../../app/dom.js";
import { callApi } from "../../app/api.js";
import { applySquadView } from "./live-event.js";
import { forgetLastSentShare, sendShare } from "./share-sync.js";
import { safeFriendColor } from "./rules.js";

/** @import { SquadView } from "../../app/types.js" */

const JOIN_WAIT_TEXT = "Joining… this can take up to a minute and a half. Keep this window open.";
const LEAVE_QUESTION =
  "Leave the squad? You will stop seeing your friends' drawings and tasks, and you need an invite code to join again.";

/** The Settings dialog's Squad box, while the dialog is open. */
let section = /** @type {HTMLElement | null} */ (null);
/** Whether the box was drawn for a joined squad (so a change of that needs a full redraw). */
let isDrawnAsJoined = false;
let isJoining = false;
let errorText = "";

// ---------------------------------------------------------------- the box

/** The Squad part of the Settings dialog (an empty box; `bindSquadSection` fills it). */
export function renderSquadSettingsBox() {
  return `<h4>Squad</h4><div id="sSquad"></div>`;
}

/**
 * Fill the Squad box of the Settings dialog that was just opened.
 * @param {HTMLElement} dialog
 */
export function bindSquadSection(dialog) {
  section = findElement("#sSquad", dialog);
  errorText = "";
  if (!section) return;
  section.addEventListener("click", onSectionClicked);
  section.addEventListener("change", onSectionChanged);
  renderSquadSection();
}

/**
 * A new squad view arrived while Settings may be open: the status line is updated in place (so
 * what you are typing stays); a change from joined to not joined (or back) redraws the box.
 */
export function refreshSquadSettings() {
  if (!section || !section.isConnected) {
    section = null;
    return;
  }
  const isJoined = !!(app.squad && app.squad.settings.joined);
  if (isJoined !== isDrawnAsJoined) {
    renderSquadSection();
    return;
  }
  const statusLine = findElement("#sSquadStatus", section);
  if (statusLine) statusLine.textContent = app.squad.status.text;
}

function renderSquadSection() {
  if (!section) return;
  const view = app.squad;
  if (!view) {
    section.innerHTML = `<p class="mnote">The squad isn't available from this copy of the program.</p>`;
    return;
  }
  isDrawnAsJoined = view.settings.joined;
  section.innerHTML = view.settings.joined ? renderJoined(view) : renderNotJoined();
}

/** Not joined: the invite-code box and Join. */
function renderNotJoined() {
  return `<p class="mnote">Join your friends to see each other's drawings live (and tasks, if you both choose). Paste the invite code your squad leader sent you.</p>
    <label class="frow"><span>Invite code</span><input type="password" id="sSquadKey" placeholder="tskey-…" autocomplete="off" spellcheck="false" ${isJoining ? "disabled" : ""}></label>
    <div class="row sq-row"><button class="btn sm" id="sSquadJoin" ${isJoining ? "disabled" : ""}>${isJoining ? "Joining…" : "Join"}</button><span class="mnote" id="sSquadProgress">${isJoining ? JOIN_WAIT_TEXT : ""}</span></div>
    ${renderError()}`;
}

/**
 * Joined: the status the server reports, your profile, Share my tasks and Leave.
 * @param {SquadView} view
 */
function renderJoined(view) {
  const color = safeFriendColor(view.me.color);
  return `<p class="mnote" id="sSquadStatus">${escapeHtml(view.status.text)}</p>
    <label class="frow"><span>Your name</span><input type="text" id="sSquadName" maxlength="32" value="${escapeHtml(view.me.name)}"></label>
    <label class="frow"><span>Your colour</span><input type="color" id="sSquadColor" value="${color}"></label>
    <label class="chk frow"><input type="checkbox" id="sSquadShareTasks" ${view.settings.shareTasks ? "checked" : ""}> Share my tasks (your active tasks and how far you are; friends choose whether to show them)</label>
    <div class="row sq-row"><button class="btn sm danger" id="sSquadLeave">Leave squad</button></div>
    ${renderError()}`;
}

function renderError() {
  return `<p class="mnote bad" id="sSquadError">${escapeHtml(errorText)}</p>`;
}

/**
 * @param {string} message
 */
function showError(message) {
  errorText = message;
  const line = section && findElement("#sSquadError", section);
  if (line) line.textContent = message;
}

// ---------------------------------------------------------------- clicks and changes

/**
 * Join and Leave.
 * @param {MouseEvent} event
 */
function onSectionClicked(event) {
  const button = /** @type {Element} */ (event.target).closest("button");
  if (!button) return;
  if (button.id === "sSquadJoin") onJoinClicked();
  if (button.id === "sSquadLeave") onLeaveClicked();
}

/** Your name, your colour or "Share my tasks" changed: tell the program. */
function onSectionChanged(event) {
  const field = /** @type {HTMLInputElement} */ (event.target);
  if (field.id === "sSquadName") saveProfile({ name: field.value });
  if (field.id === "sSquadColor") saveProfile({ color: field.value });
  if (field.id === "sSquadShareTasks") onShareTasksChanged(field.checked);
}

/** Join: the program asks the tailnet to accept the code, which can take up to 90 seconds. */
async function onJoinClicked() {
  const key = findElement("#sSquadKey", section).value.trim();
  if (!key) {
    showError("Paste the invite code first.");
    return;
  }
  errorText = "";
  isJoining = true;
  renderSquadSection();
  try {
    const answer = await callApi("/api/squad/join", { method: "POST", body: { authKey: key } });
    isJoining = false;
    applySquadView(answer.squad);
    forgetLastSentShare();
    sendShare(true);
    showToast("Joined the squad");
  } catch (error) {
    isJoining = false;
    errorText = String(error.message || error);
  }
  renderSquadSection();
}

/** Leave: after a confirm; friends' data is forgotten and the squad network folder is deleted. */
async function onLeaveClicked() {
  if (!confirm(LEAVE_QUESTION)) return;
  try {
    const answer = await callApi("/api/squad/leave", { method: "POST", body: {} });
    forgetLastSentShare();
    applySquadView(answer.squad);
    errorText = "";
    showToast("Left the squad");
  } catch (error) {
    errorText = String(error.message || error);
  }
  renderSquadSection();
}

/**
 * Save a profile change. A refused value (e.g. an empty name) is shown as the server says it, and
 * the box goes back to what is saved.
 * @param {{ name?: string, color?: string, shareTasks?: boolean }} changes
 * @returns {Promise<boolean>} whether it was saved
 */
async function saveProfile(changes) {
  try {
    const answer = await callApi("/api/squad/profile", { method: "PUT", body: changes });
    errorText = "";
    applySquadView(answer.squad);
    // the server may have cleaned the name (invisible characters): show what it kept
    const nameBox = findElement("#sSquadName");
    if (changes.name !== undefined && nameBox instanceof HTMLInputElement) nameBox.value = answer.squad.me.name;
    return true;
  } catch (error) {
    errorText = String(error.message || error);
    renderSquadSection();
    return false;
  }
}

/**
 * "Share my tasks": saved, then my share is sent again (the server keeps no tasks while sharing
 * is off, so it has none to add by itself).
 * @param {boolean} isOn
 */
async function onShareTasksChanged(isOn) {
  const wasSaved = await saveProfile({ shareTasks: isOn });
  if (wasSaved && isOn) await sendShare(true);
}
