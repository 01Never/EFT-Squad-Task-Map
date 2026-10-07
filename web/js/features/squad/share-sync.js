// @ts-check
// Sending my share to the program (PUT /api/squad/share), which hands it to my friends. The page
// builds the share from its saved data (rules.js: buildMyShare) and sends it about a second after
// a save, only while in a squad, and only when its content changed since the last one sent. This
// is the squad's only timer. A failed send is dropped quietly: the next save sends it again.
import { app } from "../../app/state.js";
import { callApi } from "../../app/api.js";
import { buildMyShare, shareFingerprint } from "./rules.js";

// Wait this long after a save before sending, so a drawing's many saves are one send.
const SHARE_DEBOUNCE_MS = 1000;

let sendTimer = null;
/** What the last successful send contained (see shareFingerprint); null = nothing sent yet. */
let lastSentFingerprint = /** @type {string | null} */ (null);

/**
 * The saved data changed: send my share soon (called by saving.js after every save()). Does
 * nothing when you aren't in a squad.
 */
export function scheduleShareUpdate() {
  if (!app.squad || !app.squad.settings.joined) return;
  clearTimeout(sendTimer);
  sendTimer = setTimeout(() => sendShare(false), SHARE_DEBOUNCE_MS);
}

/**
 * Send my share now. Used right after joining and after "Share my tasks" or "Share my keys" is
 * switched on (the server never keeps them while sharing is off, so it has none to add), and at
 * start-up when the server has never had a share from me.
 * @param {boolean} isForced send even if the content is the same as the last one sent
 */
export async function sendShare(isForced) {
  clearTimeout(sendTimer);
  if (!app.saved || !app.squad || !app.squad.settings.joined) return;
  const settings = app.squad.settings;
  const share = buildMyShare(app.saved, app.taskById, settings.shareTasks, !!settings.shareKeys);
  const fingerprint = shareFingerprint(share);
  if (!isForced && fingerprint === lastSentFingerprint) return;
  try {
    await callApi("/api/squad/share", { method: "PUT", body: share });
    lastSentFingerprint = fingerprint;
  } catch (error) {
    console.warn("Squad: couldn't send my share", error);
  }
}

/** You left the squad: the next time you join, send everything again. */
export function forgetLastSentShare() {
  clearTimeout(sendTimer);
  lastSentFingerprint = null;
}
