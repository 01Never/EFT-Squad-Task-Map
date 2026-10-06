// Tests for the Check for updates page rules (rules.js).
import { test } from "node:test";
import assert from "node:assert/strict";
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

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const available = { version: "2.6.0", released: "2026-10-20", notes: "• new", sizeBytes: 12_582_912, releaseUrl: "https://github.com/x/releases/tag/v2.6.0" };
const idle = { currentVersion: "2.5.0", canApply: true, cannotApplyMessage: "", phase: "idle", lastChecked: null, result: "", available: null, download: null, error: null, justUpdated: null };

test("before any check the section only offers the button", () => {
  assert.equal(viewForStatus(idle), "start");
  assert.equal(isBusy(idle), false);
});

test("a finished check shows up to date, or the new version", () => {
  assert.equal(viewForStatus({ ...idle, result: "up-to-date" }), "up-to-date");
  assert.equal(viewForStatus({ ...idle, result: "available", available }), "available");
});

test("a failed check shows the start view (the error is shown next to it)", () => {
  const failed = { ...idle, error: { code: "no-release", message: "No release has been published yet." } };
  assert.equal(viewForStatus(failed), "start");
});

test("a running step wins over the last result, and blocks Check for updates", () => {
  const base = { ...idle, result: "available", available };
  assert.equal(viewForStatus({ ...base, phase: "checking" }), "checking");
  assert.equal(viewForStatus({ ...base, phase: "downloading" }), "downloading");
  assert.equal(viewForStatus({ ...base, phase: "ready" }), "installing");
  assert.equal(viewForStatus({ ...base, phase: "applying" }), "installing");
  assert.equal(isBusy({ ...base, phase: "downloading" }), true);
});

test("Download and restart is off in a build that can't apply updates", () => {
  assert.equal(canDownload(idle), true);
  assert.equal(canDownload({ ...idle, canApply: false }), false);
});

test("the dot shows from a check that found a newer version until the app is updated", () => {
  assert.equal(showsUpdateDot(undefined), false);
  assert.equal(showsUpdateDot(idle), false);
  assert.equal(showsUpdateDot({ ...idle, result: "up-to-date" }), false);
  assert.equal(showsUpdateDot({ ...idle, result: "available", available }), true);
});

test("sizes read in B, KB or MB", () => {
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(340 * 1024), "340 KB");
  assert.equal(formatSize(12_582_912), "12.0 MB");
});

test("download progress gives the bar fraction and the text", () => {
  assert.deepEqual(downloadProgress(null), { fraction: 0, text: "Starting…" });
  assert.deepEqual(downloadProgress({ bytesDone: 0, bytesTotal: 0 }), { fraction: 0, text: "Starting…" });
  const progress = downloadProgress({ bytesDone: 3_355_443, bytesTotal: 12_582_912 });
  assert.equal(progress.text, "3.2 of 12.0 MB (26%)");
  assert.ok(Math.abs(progress.fraction - 0.2667) < 0.001);
  assert.equal(downloadProgress({ bytesDone: 99, bytesTotal: 10 }).fraction, 1);
});

test("'Last checked' appears only after a check", () => {
  assert.equal(lastCheckedText(null, NOW), "");
  assert.equal(lastCheckedText("nonsense", NOW), "");
  assert.equal(lastCheckedText("2026-10-20T11:55:00Z", NOW), "Last checked 5 min ago");
});

test("the page reloads once the server reports another version than the page started with", () => {
  assert.equal(shouldReloadAfterReconnect({ versionBefore: "2.5.0", versionNow: "2.6.0" }), true);
  assert.equal(shouldReloadAfterReconnect({ versionBefore: "2.5.0", versionNow: "2.5.0" }), false);
  assert.equal(shouldReloadAfterReconnect({ versionBefore: "2.5.0", versionNow: undefined }), false);
});

test("only web addresses become links", () => {
  assert.equal(safeLink("https://github.com/x"), "https://github.com/x");
  assert.equal(safeLink("javascript:alert(1)"), "");
  assert.equal(safeLink(undefined), "");
});
