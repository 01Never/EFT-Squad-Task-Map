// @ts-check
// The map picker (the start page): a card per map with a small picture and how many of your tasks
// are on it, "📷 Scan tasks", the banners, and the tasks that aren't on any map card.
// The counting rules are in rules.js.
import { app } from "../../app/state.js";
import { escapeHtml, findElement } from "../../app/dom.js";
import { save } from "../../app/saving.js";
import { loadMapArt } from "../../map/map-art.js";
import { closeMap } from "../../map/map-page.js";
import { activeTasks, partsOf } from "../tasks/task-list.js";
import { startScan } from "../scan/panel.js";
import { countTasksPerMap, tasksNotOnAMapCard } from "./rules.js";

/** @import { MapConfig, Task } from "../../app/types.js" */

/** Show the picker (closing the map if one was open). */
export function showPicker() {
  closeMap();
  const saved = app.saved;
  findElement("#crumbs").innerHTML = "Pick a map";
  const tasks = activeTasks();
  const mapKeys = app.mapConfigs.map((config) => config.key);
  const counts = countTasksPerMap(tasks, mapKeys, partsOf, saved.ticks);
  findElement("#view").innerHTML = `<div class="picker">
    <div class="phd"><div><h1>Maps</h1><p class="lede">${tasks.length} active task${tasks.length === 1 ? "" : "s"}. Pick a map.</p></div><button class="btn" id="pscan">📷 Scan tasks</button></div>
    ${renderScanBanner()}
    ${renderNoTasksBanner(tasks.length)}
    <div class="grid">${app.mapConfigs.map((config) => renderMapCard(config, counts[config.key])).join("")}</div>
    ${renderTasksNotOnAMapCard(tasks, mapKeys)}
  </div>`;
  findElement("#pscan").onclick = startScan;
  const dismissButton = findElement("#pbanner");
  if (dismissButton) dismissButton.onclick = onDismissBannerClicked;
  for (const thumbnail of document.querySelectorAll(".thumb[data-svg]")) {
    drawThumbnail(/** @type {HTMLElement} */ (thumbnail));
  }
}

/** "New in v2: …" after the data was carried over from v1, until dismissed or a scan. */
function renderScanBanner() {
  if (!app.saved.showScanBanner) return "";
  return `<div class="banner"><span style="flex:1;min-width:220px"><b>New in v2:</b> your tasks now come from your own screenshots and the game's logs. Click <b>Scan tasks</b>, open your task list in Tarkov and take a screenshot of each page. Tasks you accept or finish in-game update automatically after that.</span><button class="lnk" id="pbanner">Dismiss</button></div>`;
}

/** "No tasks yet…", when the list is empty (and the v1 banner isn't showing). */
function renderNoTasksBanner(taskCount) {
  if (taskCount || app.saved.showScanBanner) return "";
  return `<div class="banner"><span style="flex:1">No tasks yet. Click <b>Scan tasks</b> to read your task list from in-game screenshots, or add tasks by name on any map.</span></div>`;
}

/**
 * A map's card: its picture (drawn after) and "3 tasks" / "no tasks".
 * @param {MapConfig} config
 * @param {number} taskCount
 */
function renderMapCard(config, taskCount) {
  const countText = taskCount ? taskCount + " task" + (taskCount > 1 ? "s" : "") : "no tasks";
  return `<a class="card" href="#/map/${config.key}"><div class="thumb" data-svg="${escapeHtml(config.svg)}"></div><div class="meta"><b>${escapeHtml(config.name)}</b><span class="${taskCount ? "has" : ""}">${countText}</span></div></a>`;
}

/**
 * "4 active tasks not shown on a map", folded: hand-ins and builds, and tasks on maps this app
 * has no art for.
 * @param {Task[]} tasks
 * @param {string[]} mapKeys
 */
function renderTasksNotOnAMapCard(tasks, mapKeys) {
  const { offMap, onOtherMaps } = tasksNotOnAMapCard(tasks, mapKeys);
  const count = offMap.length + onOtherMaps.length;
  if (!count) return "";
  const otherMapsNote = onOtherMaps.length ? "; a few are on maps this app doesn't have (Labs)" : "";
  const names = offMap.concat(onOtherMaps).map((task) => `<span class="tag" style="margin:2px">${escapeHtml(task.name)}</span>`);
  return `<details class="offmap"><summary>${count} active task${count > 1 ? "s" : ""} not shown on a map</summary><p class="mnote">Hand-ins, weapon builds and "any location" tasks have no map spot${otherMapsNote}. Their found-in-raid items appear in every map's Bring list.</p><p>${names.join(" ")}</p></details>`;
}

/**
 * A card's picture: the map art with only its base layer (floors and overlays removed).
 * @param {HTMLElement} thumbnail
 */
function drawThumbnail(thumbnail) {
  const config = app.mapConfigs.find((candidate) => candidate.svg === thumbnail.dataset.svg);
  loadMapArt(thumbnail.dataset.svg).then((svgText) => {
    const art = new DOMParser().parseFromString(svgText, "image/svg+xml").documentElement;
    for (const group of [...art.children]) {
      if (group.tagName !== "g" || !group.id) continue;
      const isBaseLayer = group.id === config.baseLayer || /** @type {SVGElement} */ (group).dataset.keepWithGroup;
      if (!isBaseLayer) group.remove();
    }
    art.removeAttribute("width");
    art.removeAttribute("height");
    thumbnail.innerHTML = "";
    thumbnail.appendChild(document.importNode(art, true));
  });
}

/** "Dismiss" on the v1 banner. */
function onDismissBannerClicked() {
  app.saved.showScanBanner = false;
  save();
  showPicker();
}
