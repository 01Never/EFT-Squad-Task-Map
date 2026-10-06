// @ts-check
// Scan tasks: the capture bar while you take screenshots of your in-game task list, reading them
// with the AI (through the server), and the review dialog that adds tasks, replaces the list and
// deletes the screenshots. The rules (name matching, what a scan replaces) are in rules.js.
import { app } from "../../app/state.js";
import { escapeHtml, findElement, showToast, openModal } from "../../app/dom.js";
import { callApi } from "../../app/api.js";
import { save } from "../../app/saving.js";
import { mapDisplayName } from "../../app/game-data.js";
import { rerenderPage } from "../../app/routing.js";
import { mapsOfTask, isOffMapTask, forgetTask } from "../tasks/rules.js";
import { activateTask } from "../tasks/task-list.js";
import { openAiKeyDialog, openSettings } from "../settings/panel.js";
import {
  SCAN_IMAGE_MAX_EDGE_PIXELS,
  SCAN_JPEG_QUALITY,
  SCAN_PARALLEL_READS,
  matchScannedRows,
  shouldScanReplaceList,
  scanResultNote,
  estimatedThousandTokens,
} from "./rules.js";

/** @import { CaptureEvent, CapturedFile } from "../../app/types.js" */
/** @import { FoundTask, ScannedRow } from "./rules.js" */

// ---------------------------------------------------------------- starting and the live list

/**
 * "📷 Scan tasks": needs an OpenAI key (asks for one first) and a screenshots folder (opens
 * Settings when the server can't watch it). A scan already running just shows its bar again.
 */
export async function startScan() {
  if (!app.status.ai.hasKey) {
    showToast("Scanning reads your screenshots with OpenAI — add your key first");
    openAiKeyDialog();
    return;
  }
  if (app.capture) {
    renderCaptureBar();
    return;
  }
  try {
    await callApi("/api/scan/start", { method: "POST" });
  } catch (error) {
    showToast(String(error.message || error));
    openSettings();
    return;
  }
  app.capture = { phase: "capture", files: [], progress: 0 };
  renderCaptureBar();
}

/**
 * The live event "capture": the list of captured screenshots changed (a new one, or one removed).
 * Ignored when no scan is running here, and once the scan is done or cancelled.
 * @param {CaptureEvent} event
 */
export function onCaptureChanged(event) {
  if (!app.capture) return;
  if (event.cancelled || event.done) return;
  app.capture.files = event.files || [];
  if (app.capture.phase === "capture") renderCaptureBar();
}

// ---------------------------------------------------------------- the capture bar

/** The bar at the top: capturing (thumbnails, Done, Cancel), reading (progress), or hidden. */
function renderCaptureBar() {
  const bar = findElement("#capbar");
  const capture = app.capture;
  if (!capture) {
    bar.hidden = true;
    bar.innerHTML = "";
    return;
  }
  bar.hidden = false;
  if (capture.phase === "capture") {
    renderCapturingBar(bar, capture.files);
  } else if (capture.phase === "reading") {
    renderReadingBar(bar, capture.files.length, capture.progress);
  } else {
    bar.hidden = true;
  }
}

/**
 * @param {HTMLElement} bar
 * @param {CapturedFile[]} files
 */
function renderCapturingBar(bar, files) {
  const thumbnails = files.map(renderThumbnail).join("") || '<span class="none">0 captured</span>';
  bar.innerHTML = `<div class="capin"><div class="captext"><b>📷 Capturing your task list</b><span>In Tarkov, open <b>Tasks</b> and press your screenshot key on each page (scroll between shots; STORY, SIDE and OPERATIONAL tabs all work). Then come back and click Done.</span>${renderCostEstimate(files.length)}</div>
      <div class="thumbs">${thumbnails}</div>
      <div class="capbtns"><button class="btn" id="capdone" ${files.length ? "" : "disabled"}>Done (${files.length})</button><button class="btn line" id="capcancel">Cancel</button></div></div>`;
  /** @type {NodeListOf<HTMLElement>} */ (bar.querySelectorAll("[data-rm]")).forEach((button) => {
    button.onclick = () => onDontUseClicked(button.dataset.rm);
  });
  findElement("#capdone").onclick = readCapturedScreenshots;
  findElement("#capcancel").onclick = cancelScan;
}

/** @param {CapturedFile} file */
function renderThumbnail(file) {
  return `<div class="th"><img src="/api/scan/image?name=${encodeURIComponent(file.name)}" alt="" loading="lazy"><button class="x" data-rm="${escapeHtml(file.name)}" title="Don't use this one">×</button></div>`;
}

/** "Reading costs about 1–2k input tokens per screenshot (≈4.5k for 3)…", once there are any. */
function renderCostEstimate(fileCount) {
  if (!fileCount) return "";
  return `<span class="est">Reading costs about 1–2k input tokens per screenshot (≈${estimatedThousandTokens(fileCount)}k for ${fileCount}) on your OpenAI key.</span>`;
}

/**
 * @param {HTMLElement} bar
 * @param {number} fileCount
 * @param {number} readCount
 */
function renderReadingBar(bar, fileCount, readCount) {
  const plural = fileCount > 1 ? "s" : "";
  bar.innerHTML = `<div class="capin"><div class="captext"><b><span class="spin"></span>Reading ${fileCount} screenshot${plural}…</b><span>${readCount} of ${fileCount} done</span></div><div class="capbtns"><button class="btn line" id="capcancel">Cancel</button></div></div>`;
  findElement("#capcancel").onclick = cancelScan;
}

/**
 * × on a thumbnail: the server drops it from the capture list (the "capture" event redraws).
 * @param {string} fileName
 */
function onDontUseClicked(fileName) {
  callApi("/api/scan/remove", { method: "POST", body: { name: fileName } }).catch(() => {});
}

/** Cancel (while capturing, reading, or at review): the screenshots are kept. */
async function cancelScan() {
  app.capture = null;
  renderCaptureBar();
  await callApi("/api/scan/cancel", { method: "POST" }).catch(() => {});
}

// ---------------------------------------------------------------- reading

/**
 * A screenshot shrunk to at most SCAN_IMAGE_MAX_EDGE_PIXELS on its long edge, as a JPEG data
 * URL: keeps the upload to OpenAI small.
 * @param {string} fileName
 */
async function shrunkScreenshot(fileName) {
  const response = await fetch("/api/scan/image?name=" + encodeURIComponent(fileName));
  const bitmap = await createImageBitmap(await response.blob());
  const scale = Math.min(1, SCAN_IMAGE_MAX_EDGE_PIXELS / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close && bitmap.close();
  return canvas.toDataURL("image/jpeg", SCAN_JPEG_QUALITY);
}

/**
 * "Done": stop capturing, read every screenshot (SCAN_PARALLEL_READS at a time), then review.
 * Cancelling while reading stops after the screenshots being read.
 */
async function readCapturedScreenshots() {
  const capture = app.capture;
  if (!capture || !capture.files.length) return;
  await callApi("/api/scan/stop", { method: "POST" }).catch(() => {});
  capture.phase = "reading";
  capture.progress = 0;
  renderCaptureBar();
  const files = capture.files.slice();
  /** @type {ScannedRow[]} */
  const rows = [];
  const errors = [];
  let nextIndex = 0;
  const readNextUntilDone = async () => {
    while (nextIndex < files.length) {
      const file = files[nextIndex++];
      try {
        const answer = await callApi("/api/scan/read", { method: "POST", body: { image: await shrunkScreenshot(file.name) } });
        rows.push(...answer.rows);
      } catch (error) {
        errors.push(`${file.name}: ${error.message || error}`);
      }
      if (!app.capture) return;
      capture.progress++;
      renderCaptureBar();
    }
  };
  const readers = [];
  for (let i = 0; i < SCAN_PARALLEL_READS; i++) readers.push(readNextUntilDone());
  await Promise.all(readers);
  if (!app.capture) return;
  openReviewDialog(files.map((file) => file.name), rows, errors);
}

// ---------------------------------------------------------------- the review dialog

/**
 * @typedef {object} ScanReview What the screenshots said, sorted for the dialog.
 * @property {string[]} fileNames
 * @property {ScannedRow[]} rows
 * @property {string[]} errors
 * @property {Map<string, FoundTask>} found by task id
 * @property {string[]} unknown names that matched nothing
 * @property {FoundTask[]} newOnMap new tasks with something on a map
 * @property {FoundTask[]} newOffMap new hand-in-only tasks
 * @property {FoundTask[]} alreadyOnList
 * @property {boolean} replacesList
 */

/**
 * Sort the scan's rows into new (on a map / hand-in only), already on the list, and unknown.
 * @param {string[]} fileNames
 * @param {ScannedRow[]} rows
 * @param {string[]} errors
 * @returns {ScanReview}
 */
function sortScanResults(fileNames, rows, errors) {
  const { found, unknown } = matchScannedRows(rows, app.taskNameMatcher);
  const byName = (first, second) => first.task.name.localeCompare(second.task.name);
  const all = [...found.values()].sort(byName);
  const isOnList = (foundTask) => !!(app.saved.tasks[foundTask.task.id] && app.saved.tasks[foundTask.task.id].active);
  const fresh = all.filter((foundTask) => !isOnList(foundTask));
  return {
    fileNames,
    rows,
    errors,
    found,
    unknown,
    newOnMap: fresh.filter((foundTask) => !isOffMapTask(foundTask.task)),
    newOffMap: fresh.filter((foundTask) => isOffMapTask(foundTask.task)),
    alreadyOnList: all.filter(isOnList),
    replacesList: shouldScanReplaceList(errors, found.size),
  };
}

/**
 * The "Scan results" dialog. Cancel keeps the screenshots; the main button adds the ticked tasks
 * (and the names you typed for unknown ones), removes the rest when the scan replaces the list,
 * and deletes the screenshots.
 * @param {string[]} fileNames
 * @param {ScannedRow[]} rows
 * @param {string[]} errors
 */
function openReviewDialog(fileNames, rows, errors) {
  const review = sortScanResults(fileNames, rows, errors);
  const { el: dialog, close } = openModal(renderReview(review), { wide: true });
  findElement("#rvcancel", dialog).onclick = () => {
    close();
    cancelScan();
  };
  findElement("#rvok", dialog).onclick = () => onConfirmClicked(review, dialog, close);
}

/** @param {ScanReview} review */
function renderReview(review) {
  const { fileNames, rows, errors } = review;
  const screenshotsPlural = fileNames.length > 1 ? "s" : "";
  const errorList = errors.length ? `<div class="err">${errors.map(escapeHtml).join("<br>")}</div>` : "";
  const confirmLabel = `${review.replacesList ? "Update list" : "Add tasks"} & delete ${fileNames.length} screenshot${screenshotsPlural}`;
  return `<h3>Scan results</h3>
    <p class="mnote">Read ${rows.length} rows from ${fileNames.length} screenshot${screenshotsPlural}. ${scanResultNote(review.replacesList, errors)}</p>
    ${errorList}
    <h4>New tasks (${review.newOnMap.length})</h4>${renderNewTasksPerMap(review.newOnMap)}
    <ul class="rlist">${review.newOnMap.map(renderFoundTask).join("") || '<li class="none">None</li>'}</ul>
    ${renderNewOffMapTasks(review.newOffMap)}
    ${renderAlreadyOnList(review.alreadyOnList)}
    ${renderUnknownNames(review.unknown)}
    <div class="row" style="margin-top:14px;justify-content:space-between"><button class="btn line" id="rvcancel">Cancel (keep screenshots)</button><button class="btn" id="rvok">${confirmLabel}</button></div>`;
}

/**
 * "Customs 3 · Woods 1": how many new tasks each map gets.
 * @param {FoundTask[]} newOnMap
 */
function renderNewTasksPerMap(newOnMap) {
  /** @type {Record<string, number>} */
  const countByMapName = {};
  for (const foundTask of newOnMap) {
    for (const mapName of mapsOfTask(foundTask.task).map(mapDisplayName)) {
      countByMapName[mapName] = (countByMapName[mapName] || 0) + 1;
    }
  }
  const entries = Object.entries(countByMapName);
  if (!entries.length) return "";
  return `<p class="mnote">${entries.map(([mapName, count]) => `${escapeHtml(mapName)} ${count}`).join(" · ")}</p>`;
}

/**
 * A ticked box per new task: name, trader, progress read, "spelling fixed" when it only matched
 * by similarity.
 * @param {FoundTask} foundTask
 */
function renderFoundTask(foundTask) {
  const { task, progress, fixed } = foundTask;
  const progressTag = progress != null ? ` <span class="tag">${progress}%</span>` : "";
  const fixedTag = fixed ? ` <span class="tag warnt" title="Read as “${escapeHtml(fixed)}”">spelling fixed</span>` : "";
  return `<li><label><input type="checkbox" data-add="${escapeHtml(task.id)}" checked> ${escapeHtml(task.name)} <span class="tag">${escapeHtml(task.trader)}</span>${progressTag}${fixedTag}</label></li>`;
}

/** @param {FoundTask[]} newOffMap */
function renderNewOffMapTasks(newOffMap) {
  if (!newOffMap.length) return "";
  return `<h4>New hand-in-only tasks (${newOffMap.length})</h4><p class="mnote">No map objectives, so they won't show on a map. Their found-in-raid items appear in the Bring list.</p><ul class="rlist">${newOffMap.map(renderFoundTask).join("")}</ul>`;
}

/** @param {FoundTask[]} alreadyOnList */
function renderAlreadyOnList(alreadyOnList) {
  if (!alreadyOnList.length) return "";
  return `<h4>Already on your list (${alreadyOnList.length})</h4><p class="mnote">${alreadyOnList.map((foundTask) => escapeHtml(foundTask.task.name)).join(", ")}</p>`;
}

/**
 * Names that matched nothing, each with a box to type the right name (suggesting every task).
 * @param {string[]} unknown
 */
function renderUnknownNames(unknown) {
  if (!unknown.length) return "";
  const suggestions = `<datalist id="fixlist">${app.gameData.tasks.map((task) => `<option value="${escapeHtml(task.name)}">`).join("")}</datalist>`;
  const lines = unknown.map((name, index) => `<li>“${escapeHtml(name)}” → <input type="search" list="fixlist" data-fix="${index}" placeholder="Task name…"></li>`);
  return `<h4>Not recognised (${unknown.length})</h4><p class="mnote">Type the right name to include one, or leave it blank to skip.</p><ul class="rlist">${lines.join("")}</ul>${suggestions}`;
}

/**
 * The main button: add, update, remove (when the scan replaces the list), then delete the
 * screenshots and say what happened.
 * @param {ScanReview} review
 * @param {HTMLElement} dialog
 * @param {() => void} close
 */
async function onConfirmClicked(review, dialog, close) {
  const saved = app.saved;
  const now = () => Date.now();
  let added = 0;
  let removed = 0;
  const seen = new Set(review.alreadyOnList.map((foundTask) => foundTask.task.id));
  for (const checkbox of /** @type {NodeListOf<HTMLInputElement>} */ (dialog.querySelectorAll("[data-add]"))) {
    if (!checkbox.checked) continue;
    const foundTask = review.found.get(checkbox.dataset.add);
    seen.add(foundTask.task.id);
    if (activateTask(foundTask.task.id, "scan", { gamePct: foundTask.progress, scannedAt: now() })) added++;
  }
  for (const input of /** @type {NodeListOf<HTMLInputElement>} */ (dialog.querySelectorAll("[data-fix]"))) {
    const typedName = input.value.trim();
    const matched = typedName && app.taskNameMatcher.match(typedName);
    if (!matched) continue;
    seen.add(matched.task.id);
    if (activateTask(matched.task.id, "scan", { scannedAt: now() })) added++;
  }
  for (const foundTask of review.alreadyOnList) {
    const entry = saved.tasks[foundTask.task.id];
    Object.assign(entry, { gamePct: foundTask.progress ?? entry.gamePct, scannedAt: now() });
  }
  if (review.replacesList) removed = forgetTasksNotSeen(seen);
  saved.showScanBanner = false;
  save();
  const deleted = await deleteScreenshots(review.fileNames);
  app.capture = null;
  renderCaptureBar();
  close();
  showToast(scanDoneMessage(added, removed, deleted));
  rerenderPage();
}

/**
 * The scan replaces the list: tasks on it that no screenshot showed are forgotten.
 * @param {Set<string>} seenTaskIds
 * @returns {number} how many were removed
 */
function forgetTasksNotSeen(seenTaskIds) {
  const saved = app.saved;
  let removed = 0;
  for (const taskId of Object.keys(saved.tasks)) {
    if (saved.tasks[taskId].active && !seenTaskIds.has(taskId)) {
      forgetTask(saved, taskId, app.taskById[taskId]);
      removed++;
    }
  }
  return removed;
}

/**
 * The server deletes the scan's screenshots (only names in its capture list).
 * @param {string[]} fileNames
 * @returns {Promise<number>} how many it deleted (0 when the request failed)
 */
async function deleteScreenshots(fileNames) {
  try {
    const answer = await callApi("/api/scan/confirm", { method: "POST", body: { names: fileNames } });
    return answer.deleted;
  } catch {
    return 0;
  }
}

/** "Added 6 tasks · removed 1 · deleted 1 screenshot". */
function scanDoneMessage(added, removed, deleted) {
  const addedText = `Added ${added} task${added === 1 ? "" : "s"}`;
  const removedText = removed ? ` · removed ${removed}` : "";
  const deletedText = ` · deleted ${deleted} screenshot${deleted === 1 ? "" : "s"}`;
  return addedText + removedText + deletedText;
}
