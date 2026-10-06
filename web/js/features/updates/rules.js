// @ts-check
// Check for updates: the page's decisions and texts, without any DOM (panel.js draws them).
// The server (internal/features/updates) does the real work; here: which view the Updates
// section shows for a status, how sizes and progress read, and when to reload after a restart.
import { timeAgo } from "../settings/rules.js";

/** @import { UpdatesStatus, UpdateDownload } from "../../app/types.js" */

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

/**
 * What the Updates section shows (below "You're on X" and the button):
 * - "checking": waiting for GitHub's answer;
 * - "downloading": the progress bar with Cancel;
 * - "installing": the download is verified, the server is swapping the exe and restarting;
 * - "available": a newer version was found;
 * - "up-to-date": the last check found nothing newer;
 * - "start": nothing has been checked yet (or the check failed, see `error`).
 * @typedef {"checking" | "downloading" | "installing" | "available" | "up-to-date" | "start"} UpdatesView
 */

/**
 * Which view to show. The phase wins (a step is running); otherwise the last check's result.
 * @param {UpdatesStatus} status
 * @returns {UpdatesView}
 */
export function viewForStatus(status) {
  if (status.phase === "checking") return "checking";
  if (status.phase === "downloading") return "downloading";
  if (status.phase === "ready" || status.phase === "applying") return "installing";
  if (status.result === "available" && status.available) return "available";
  if (status.result === "up-to-date") return "up-to-date";
  return "start";
}

/**
 * Whether a step is running, so Check for updates can't be clicked.
 * @param {UpdatesStatus} status
 */
export function isBusy(status) {
  return status.phase !== "idle";
}

/**
 * Whether "Download and restart" can be pressed: this copy can apply updates (not `go run`).
 * @param {UpdatesStatus} status
 */
export function canDownload(status) {
  return status.canApply;
}

/**
 * The small dot on ⚙ Settings: after a check found a newer version, until the app is updated
 * (the new copy has no result yet, so the dot disappears by itself).
 * @param {UpdatesStatus | undefined} status
 */
export function showsUpdateDot(status) {
  return Boolean(status && status.result === "available" && status.available);
}

/**
 * "12.0 MB" / "340 KB" / "512 B".
 * @param {number} bytes
 */
export function formatSize(bytes) {
  if (bytes >= BYTES_PER_MB) return (bytes / BYTES_PER_MB).toFixed(1) + " MB";
  if (bytes >= BYTES_PER_KB) return Math.round(bytes / BYTES_PER_KB) + " KB";
  return bytes + " B";
}

/**
 * How far the download is, for the bar (0 to 1) and the text ("3.2 of 12.0 MB (26%)").
 * @param {UpdateDownload | null} download
 * @returns {{ fraction: number, text: string }}
 */
export function downloadProgress(download) {
  if (!download || !download.bytesTotal) return { fraction: 0, text: "Starting…" };
  const fraction = Math.min(1, Math.max(0, download.bytesDone / download.bytesTotal));
  const done = (download.bytesDone / BYTES_PER_MB).toFixed(1);
  const percent = Math.floor(fraction * 100);
  return { fraction, text: `${done} of ${formatSize(download.bytesTotal)} (${percent}%)` };
}

/**
 * "Last checked 5 min ago", or "" until a manual check has finished (even a failed one counts).
 * @param {string | null} lastChecked RFC 3339 time from the server
 * @param {number} nowMs
 */
export function lastCheckedText(lastChecked, nowMs) {
  if (!lastChecked) return "";
  const checkedMs = Date.parse(lastChecked);
  if (Number.isNaN(checkedMs)) return "";
  return "Last checked " + timeAgo(checkedMs, nowMs);
}

/**
 * After the app restarted itself the page's event stream drops and reconnects. Reload once the
 * server reports another version than the one this page was loaded from.
 * @param {{ versionBefore: string, versionNow: string | undefined }} versions
 */
export function shouldReloadAfterReconnect({ versionBefore, versionNow }) {
  return Boolean(versionNow) && versionNow !== versionBefore;
}

/**
 * Only web addresses are made into links ("View on GitHub").
 * @param {string | undefined} address
 */
export function safeLink(address) {
  return address && /^https?:\/\//i.test(address) ? address : "";
}
