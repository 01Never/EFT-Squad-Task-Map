// @ts-check
// Saving the page's data. The page owns the saved data; the server only stores the whole object
// (PUT /api/state, atomic write + .bak). Changes are batched: one save shortly after the last one.
import { app } from "./state.js";
import { findElement } from "./dom.js";
import { shouldUseKeepalive, retryDelayMs } from "./saving-rules.js";
import { scheduleShareUpdate } from "../features/squad/share-sync.js";

// Wait this long after the last change before saving, so a burst of clicks is one save.
const SAVE_DEBOUNCE_MS = 500;

let saveTimer = null;
let isSaving = false;
let hasUnsavedChanges = false;
let programAnsweredWithError = false;

/** Mark the saved data as changed: shows "Saving…" and saves it soon. */
export function save() {
  hasUnsavedChanges = true;
  const indicator = findElement("#saved");
  if (indicator) {
    indicator.textContent = "Saving…";
    indicator.classList.remove("err");
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  scheduleShareUpdate(); // in a squad, my friends get what changed about a second later
}

/**
 * Save now if anything changed (also when the tab is hidden). A failed save shows
 * "Save failed" and is tried again later.
 */
export async function flush() {
  if (!hasUnsavedChanges || isSaving) {
    return;
  }
  isSaving = true;
  hasUnsavedChanges = false;
  programAnsweredWithError = false;
  try {
    const response = await putSavedData(false);
    if (!response.ok) {
      programAnsweredWithError = true;
      throw 0;
    }
    findElement("#saved").textContent = "Saved ✓";
  } catch {
    findElement("#saved").textContent = "Save failed";
    findElement("#saved").classList.add("err");
    hasUnsavedChanges = true;
  }
  isSaving = false;
  if (hasUnsavedChanges) {
    saveTimer = setTimeout(flush, retryDelayMs(programAnsweredWithError));
  }
}

/** Save straight away, without the indicator: used once at start-up after migrating v1 data. */
export async function saveMigratedData() {
  await putSavedData(false);
}

/** When the page closes with unsaved changes, send them (keepalive lets the request finish, when the data is small enough). */
export function saveUnsavedChangesOnClose() {
  addEventListener("beforeunload", () => {
    if (hasUnsavedChanges) {
      putSavedData(true);
    }
  });
}

/**
 * @param {boolean} isPageClosing
 * @returns {Promise<Response>}
 */
function putSavedData(isPageClosing) {
  const body = JSON.stringify(app.saved);
  return fetch("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" }, // the server refuses anything else (ticket 04d)
    body,
    keepalive: shouldUseKeepalive(body, isPageClosing),
  });
}
