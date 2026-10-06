// @ts-check
// Check for updates, page side: the Updates section of the Settings dialog, the small dot on
// ⚙ Settings, the "Updated to X" notice after a restart, and the reload after the app restarted
// itself. Nothing here runs on a timer, and nothing contacts the server's update routes unless
// the player clicks: the state comes from /api/status (at load) and the `updates` live event.
// The decisions and texts are in rules.js; the flow is in this feature's README.
import { app } from "../../app/state.js";
import { escapeHtml, findElement, openModal, showToast } from "../../app/dom.js";
import { fetchJson } from "../../app/api.js";
import {
  viewForStatus,
  isBusy,
  canDownload,
  showsUpdateDot,
  formatSize,
  downloadProgress,
  lastCheckedText,
  shouldReloadAfterReconnect,
  safeLink,
} from "./rules.js";

/** @import { UpdatesStatus, UpdatesEvent } from "../../app/types.js" */

/** The Settings dialog's Updates box, while the dialog is open. */
let section = /** @type {HTMLElement | null} */ (null);
/** The player pressed "Download and restart" and is being asked to confirm. */
let isConfirming = false;
/** The player confirmed in this page: when the download is verified, install it. */
let installWhenReady = false;
/** The server was told to install and restart: the page waits for it to come back. */
let versionBeforeRestart = /** @type {string | null} */ (null);
/** Notes already shown in this page, so "Updated to X" appears once. */
let isUpdatedNoticeShown = false;

// ---------------------------------------------------------------- the Settings section

/** The Updates part of the Settings dialog (an empty box; `bindUpdatesSection` fills it). */
export function renderUpdatesSectionBox() {
  return `<h4>Updates</h4><div id="sUpdates" class="upd"></div>`;
}

/**
 * Fill the Updates box of the Settings dialog that was just opened, and keep it current while
 * it's open (live `updates` events redraw it).
 * @param {HTMLElement} dialog
 */
export function bindUpdatesSection(dialog) {
  section = findElement("#sUpdates", dialog);
  isConfirming = false;
  section?.addEventListener("click", onSectionClicked);
  renderSection();
}

/** @returns {UpdatesStatus | undefined} */
function currentStatus() {
  return app.status.updates;
}

/** Draw the section for the current status. While downloading, only the bar moves. */
function renderSection() {
  const status = currentStatus();
  if (!section || !section.isConnected) {
    section = null;
    return;
  }
  if (!status) {
    section.innerHTML = `<p class="mnote">Update information isn't available from this copy of the program.</p>`;
    return;
  }
  const view = viewForStatus(status);
  const bar = section.querySelector("[data-progress]");
  if (view === "downloading" && bar) {
    paintProgress(section, status);
    return;
  }
  const lastChecked = lastCheckedText(status.lastChecked, Date.now());
  section.innerHTML = `
    <p class="mnote">You're on <b>${escapeHtml(status.currentVersion)}</b>${lastChecked ? ` · <span data-last-checked>${escapeHtml(lastChecked)}</span>` : ""}</p>
    ${renderCheckButton(status, view)}
    ${renderError(status)}
    ${renderView(status, view)}`;
  if (view === "downloading") paintProgress(section, status);
}

/** @param {UpdatesStatus} status @param {import("./rules.js").UpdatesView} view */
function renderCheckButton(status, view) {
  const label = view === "checking" ? "Checking…" : "Check for updates";
  return `<button class="btn sm line" id="sCheckUpdates" ${isBusy(status) ? "disabled" : ""}>${label}</button>`;
}

/** The last failure, in the server's words ("download it from GitHub" comes with a link). */
function renderError(status) {
  if (!status.error || isBusy(status)) return "";
  const link = safeLink(status.error.releaseUrl);
  const linkHtml = link ? ` <a href="${escapeHtml(link)}" target="_blank" rel="noopener">Open the release page</a>` : "";
  return `<p class="mnote bad" data-update-error>${escapeHtml(status.error.message)}${linkHtml}</p>`;
}

/** @param {UpdatesStatus} status @param {import("./rules.js").UpdatesView} view */
function renderView(status, view) {
  switch (view) {
    case "checking":
      return `<p class="mnote">Asking GitHub…</p>`;
    case "up-to-date":
      return `<p class="mnote ok">You're up to date.</p>`;
    case "available":
      return renderAvailable(status);
    case "downloading":
      return `<div class="upd-bar" data-progress><i></i></div>
        <p class="mnote"><span data-progress-text></span> <button class="lnk" id="sCancelUpdate">Cancel</button></p>`;
    case "installing":
      return `<p class="mnote">Installing and restarting… this page reloads by itself.</p>`;
    default:
      return "";
  }
}

/** "2.6.0 is available", the notes, the size, the link, and the (confirmed) install button. */
function renderAvailable(status) {
  const found = status.available;
  if (!found) return "";
  const link = safeLink(found.releaseUrl);
  const linkHtml = link ? ` · <a href="${escapeHtml(link)}" target="_blank" rel="noopener">View on GitHub</a>` : "";
  const released = found.released ? ` (${escapeHtml(found.released)})` : "";
  const cannotApply = !canDownload(status);
  const note = cannotApply ? `<p class="mnote" data-cannot-apply>${escapeHtml(status.cannotApplyMessage)}</p>` : "";
  return `<p class="upd-found"><b>${escapeHtml(found.version)} is available</b>${released}</p>
    <pre class="upd-notes">${escapeHtml(found.notes)}</pre>
    <p class="mnote">Download size ${escapeHtml(formatSize(found.sizeBytes))}${linkHtml}</p>
    ${isConfirming ? renderConfirm(found.version) : `<button class="btn sm" id="sDownloadUpdate" ${cannotApply ? "disabled" : ""}>Download and restart</button>`}
    ${note}`;
}

/** @param {string} version */
function renderConfirm(version) {
  return `<p class="mnote">Download ${escapeHtml(version)} and restart Squad Task Map now? Your saved data is backed up first.</p>
    <div class="row"><button class="btn sm" id="sConfirmUpdate">Yes, download and restart</button><button class="btn sm line" id="sKeepVersion">Not now</button></div>`;
}

/** Move the progress bar and its text. The bar uses transform only. */
function paintProgress(box, status) {
  const progress = downloadProgress(status.download);
  const fill = box.querySelector("[data-progress] i");
  const text = box.querySelector("[data-progress-text]");
  if (fill instanceof HTMLElement) fill.style.transform = `scaleX(${progress.fraction})`;
  if (text) text.textContent = progress.text;
}

// ---------------------------------------------------------------- the clicks

/** @param {MouseEvent} event */
function onSectionClicked(event) {
  const target = event.target instanceof Element ? event.target.closest("button") : null;
  if (!target || target.disabled) return;
  switch (target.id) {
    case "sCheckUpdates":
      return void checkForUpdates();
    case "sDownloadUpdate":
      isConfirming = true;
      return renderSection();
    case "sKeepVersion":
      isConfirming = false;
      return renderSection();
    case "sConfirmUpdate":
      return void downloadUpdate();
    case "sCancelUpdate":
      installWhenReady = false;
      return void callUpdates("/api/updates/cancel");
  }
}

async function checkForUpdates() {
  isConfirming = false;
  showStep("checking");
  await callUpdates("/api/updates/check");
}

async function downloadUpdate() {
  const status = currentStatus();
  if (!status || !status.available) return;
  isConfirming = false;
  installWhenReady = true;
  showStep("downloading");
  const answer = await callUpdates("/api/updates/download", { version: status.available.version });
  if (!answer.ok) installWhenReady = false;
}

/**
 * Show the step as running straight away; the server's answer and events then take over.
 * @param {"checking" | "downloading"} phase
 */
function showStep(phase) {
  const status = currentStatus();
  if (!status) return;
  app.status.updates = { ...status, phase, error: null };
  renderSection();
}

/**
 * POST to an update route. The answer always carries the new status, even for a refusal, so a
 * failure is shown from `status.error` (the server's message, shown as is).
 * @param {string} path
 * @param {unknown} [body]
 * @returns {Promise<{ ok: boolean, status?: UpdatesStatus, error?: string }>}
 */
async function callUpdates(path, body) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const answer = await response.json();
    if (answer.status) acceptStatus(answer.status);
    return answer;
  } catch (error) {
    // The server didn't answer. Leave the step the way it was and say so.
    const message = "Couldn't reach Squad Task Map. Is it still running?";
    showToast(message);
    refreshAfterConnectionFailure();
    return { ok: false, error: message };
  }
}

/** A step that didn't get an answer isn't left looking busy forever: ask the server where it is. */
async function refreshAfterConnectionFailure() {
  try {
    const status = await fetchJson("/api/status");
    if (status.updates) acceptStatus(status.updates);
  } catch {
    // Still down: the "Not connected" notice already says so.
  }
}

// ---------------------------------------------------------------- live events and restart

/**
 * The server's `updates` event: check result, download progress, ready, failures.
 * @param {UpdatesEvent} event
 */
export function onUpdatesChanged(event) {
  acceptStatus(event.status);
}

/** @param {UpdatesStatus} status */
function acceptStatus(status) {
  const before = currentStatus();
  app.status.updates = status;
  renderSection();
  renderUpdateDot();
  const justBecameReady = status.phase === "ready" && before?.phase !== "ready";
  if (justBecameReady && installWhenReady) {
    installWhenReady = false;
    void install(status.currentVersion);
  }
  if (status.phase === "idle" && status.error) installWhenReady = false;
}

/** The download is verified: swap the exe and restart. Then wait for the new copy. */
async function install(versionBefore) {
  versionBeforeRestart = versionBefore;
  const answer = await callUpdates("/api/updates/apply");
  if (!answer.ok && answer.status) {
    // The old version keeps running; the section shows the server's message.
    versionBeforeRestart = null;
  }
}

/**
 * The event stream (re)connected. After "Download and restart" that means the new copy is up:
 * if it reports another version, reload so the page matches it.
 */
export async function onStreamConnected() {
  if (versionBeforeRestart === null) return;
  try {
    const status = await fetchJson("/api/status");
    const versionNow = status.updates?.currentVersion ?? status.version;
    if (shouldReloadAfterReconnect({ versionBefore: versionBeforeRestart, versionNow })) {
      location.reload();
    }
  } catch {
    // Not up yet: the stream reconnects by itself and calls this again.
  }
}

// ---------------------------------------------------------------- dot and notice

/** The dot on ⚙ Settings: a newer version was found and isn't installed yet. */
export function renderUpdateDot() {
  const button = findElement("#settings");
  if (!button) return;
  const show = showsUpdateDot(currentStatus());
  button.classList.toggle("has-update", show);
  button.title = show ? "Settings (an update is available)" : "Settings";
}

/**
 * "Updated to 2.6.0" with the release notes, once, in the first page that loads after an update.
 * The server forgets the notes when told they were seen.
 */
export function showUpdatedNotice() {
  const justUpdated = currentStatus()?.justUpdated;
  if (!justUpdated || isUpdatedNoticeShown) return;
  isUpdatedNoticeShown = true;
  const notes = justUpdated.notes ? `<pre class="upd-notes">${escapeHtml(justUpdated.notes)}</pre>` : "";
  const { el: dialog, close } = openModal(`<h3>Updated to ${escapeHtml(justUpdated.to)}</h3>
    <p class="mnote">You were on ${escapeHtml(justUpdated.from)}. Your saved data is unchanged.</p>${notes}
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" id="sUpdatedOk">OK</button></div>`);
  findElement("#sUpdatedOk", dialog).onclick = close;
  fetch("/api/updates/seen", { method: "POST" }).catch(() => {});
  app.status.updates = { ...currentStatus(), justUpdated: null };
}
