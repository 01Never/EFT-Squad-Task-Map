// @ts-check
// My keys in the panel (ticket 09): the "My keys (5)" section, closed until you open it. Inside:
// your keys for this map (icon, name, what each opens here; click a name to fly to its doors,
// × to remove with Undo), the "Add key" search (this map's keys, or every key), "All locked
// doors", "Copy from" another map and Clear. The list is saved per map (`keyring`) and is not
// reset at raid end. The rules are in rules.js; the doors are map-layer.js.
import { app } from "../../app/state.js";
import { escapeHtml, findElement, showToast } from "../../app/dom.js";
import { save } from "../../app/saving.js";
import { renderMapPage } from "../../map/map-page.js";
import { renderPanel } from "../../panel/panel.js";
import { lootOfMap, lootFailedToLoad, loadLootOfMap, loadedLoots } from "../loot/loot-data.js";
import { isItemId, itemIconUrl } from "../icons/rules.js";
import { keysThatMatterOnOpenMap, friendsHaveKeyText } from "./key-lists.js";
import { flyToKeyDoors } from "./map-layer.js";
import {
  keyListOf,
  setKeyList,
  addKeyToList,
  removeKeyFromList,
  putKeyBack,
  otherMapsWithKeys,
  copyKeyList,
  allKnownKeys,
  searchKeys,
  lockCountText,
} from "./rules.js";

/** @import { KeyChoice } from "./rules.js" */

// The search lists at most this many keys.
const MAX_SEARCH_RESULTS = 12;

const UNKNOWN_ITEM_NAME = "Unknown item";

// ---------------------------------------------------------------- the section

/** The "My keys" section of the Tasks tab: a heading you open, with the list inside. */
export function renderKeysSection() {
  const mapKey = app.mapView.key;
  const count = keyListOf(app.saved, mapKey).length;
  const summary = `<summary><h4>My keys <span class="n">(${count})</span></h4></summary>`;
  if (!app.keysSectionOpen) {
    return `<details class="sec keys-sec" data-keys-section>${summary}</details>`;
  }
  return `<details class="sec keys-sec" data-keys-section open>${summary}${renderKeysSectionBody(mapKey)}</details>`;
}

/**
 * The list, the search and the tools.
 * @param {string} mapKey
 */
function renderKeysSectionBody(mapKey) {
  const keysHere = keysThatMatterOnOpenMap(onLocksLoaded);
  const loot = lootOfMap(mapKey, onLocksLoaded);
  const loadingNote = loot ? "" : `<p class="bnote">${lootFailedToLoad(mapKey) ? "Couldn't load the doors. Is the program still running?" : "Loading doors…"}</p>`;
  const snapshotNote = loot && !loot.available ? `<p class="bnote">Doors come with the game data download. Settings → Game data → Update game data now.</p>` : "";
  return `${loadingNote}${snapshotNote}${renderKeyList(mapKey, keysHere)}${renderAddKey()}${renderKeyTools(mapKey)}
    <p class="bnote">Keys on your list count as had for tasks on this map, raid after raid. Doors from tarkov.dev; an outline only where the data has one.</p>`;
}

/**
 * Your keys for this map.
 * @param {string} mapKey
 * @param {KeyChoice[]} keysHere
 */
function renderKeyList(mapKey, keysHere) {
  const list = keyListOf(app.saved, mapKey);
  if (!list.length) {
    return `<p class="bnote keys-empty">No keys yet. Add the keys you usually bring here: the doors they open light up on the map.</p>`;
  }
  const choiceById = new Map(keysHere.map((choice) => [choice.id, choice]));
  const rows = list.map((keyId) => renderKeyRow(keyId, choiceById.get(keyId)));
  return `<ul class="keylist">${rows.join("")}</ul>`;
}

/**
 * One key: icon, name (fly to its doors), what it opens here, friends who have it, ×.
 * @param {string} keyId
 * @param {KeyChoice | undefined} choice undefined: it matters nowhere on this map
 */
function renderKeyRow(keyId, choice) {
  const name = choice ? choice.name : keyNameAnywhere(keyId);
  const opens = choice ? lockCountText(choice.lockCounts) : "doesn't open anything here";
  const friends = friendsHaveKeyText([keyId]);
  const friendsText = friends ? ` · ${escapeHtml(friends)}` : "";
  const id = escapeHtml(keyId);
  return `<li class="key-row" data-keyrow="${id}">${renderKeyIcon(keyId)}<button class="key-name" data-key-fly="${id}" title="Show its doors">${escapeHtml(name)}</button>
    <span class="key-opens">${escapeHtml(opens)}${friendsText}</span><button class="ib sm" data-key-remove="${id}" title="Remove from this map's list">×</button></li>`;
}

/** @param {string} keyId */
function renderKeyIcon(keyId) {
  if (!isItemId(keyId)) return `<span class="noimg">🔑</span>`;
  return `<img src="${itemIconUrl(keyId)}" alt="" loading="lazy" onerror="this.remove()">`;
}

/**
 * A key's name from anything loaded (another map's locks, the tasks); for keys that matter
 * nowhere here.
 * @param {string} keyId
 */
function keyNameAnywhere(keyId) {
  const known = allKnownKeys([], app.gameData.tasks, loadedLoots()).find((choice) => choice.id === keyId);
  return known ? known.name : UNKNOWN_ITEM_NAME;
}

/** The "Add key" search box, the "all keys" switch and the results. */
function renderAddKey() {
  const search = escapeHtml(app.keySearchText);
  return `<div class="key-add"><input type="search" id="keysearch" placeholder="Add key: search this map's keys" value="${search}" autocomplete="off" spellcheck="false">
    <label class="chk" title="Also keys that open nothing on this map"><input type="checkbox" id="keyall" ${app.keySearchAll ? "checked" : ""}> all keys</label></div>
    <div id="keyresults">${renderSearchResults()}</div>`;
}

/** The keys the search finds (this map's, or every key with "all keys"). */
function renderSearchResults() {
  const keysHere = keysThatMatterOnOpenMap(onLocksLoaded);
  const candidates = app.keySearchAll ? allKnownKeys(keysHere, app.gameData.tasks, loadedLoots()) : keysHere;
  const found = searchKeys(candidates, app.keySearchText);
  if (!app.keySearchText.trim()) return "";
  if (!found.length) return `<p class="bnote">No key called “${escapeHtml(app.keySearchText)}”${app.keySearchAll ? "" : " on this map. Tick “all keys” to search every key"}.</p>`;
  const list = new Set(keyListOf(app.saved, app.mapView.key));
  const buttons = found.slice(0, MAX_SEARCH_RESULTS).map((choice) => renderSearchResult(choice, list.has(choice.id)));
  const more = found.length > MAX_SEARCH_RESULTS ? `<p class="bnote">and ${found.length - MAX_SEARCH_RESULTS} more: type more of the name</p>` : "";
  return `<div class="key-results">${buttons.join("")}</div>${more}`;
}

/**
 * One result: icon, name, what it opens here (or that it opens nothing here).
 * @param {KeyChoice} choice
 * @param {boolean} isOnList
 */
function renderSearchResult(choice, isOnList) {
  const mattersHere = choice.lockTotal > 0 || choice.taskNames.length > 0;
  let note = lockCountText(choice.lockCounts);
  if (!choice.lockTotal && choice.taskNames.length) note = "needed by a task here";
  if (isOnList) note = "on your list";
  const flag = mattersHere ? "" : " nothing-here";
  return `<button class="key-result${flag}" data-key-add="${escapeHtml(choice.id)}" ${isOnList ? "disabled" : ""}>${renderKeyIcon(choice.id)}<span class="key-name">${escapeHtml(choice.name)}</span><span class="key-opens">${escapeHtml(note)}</span></button>`;
}

/**
 * All locked doors, Copy from, Clear.
 * @param {string} mapKey
 */
function renderKeyTools(mapKey) {
  const allDoors = `<button class="chip" data-act="keysalldoors" aria-pressed="${app.allDoorsShown}" title="Also show doors for keys you don't have, dimmed">All locked doors</button>`;
  const others = otherMapsWithKeys(app.saved, mapKey);
  const copyOptions = others.map(({ mapKey: otherMap, count }) => `<option value="${escapeHtml(otherMap)}">${escapeHtml(mapName(otherMap))} (${count})</option>`);
  const copy = others.length ? `<select data-keys-copy title="Copy the keys that matter here from another map's list"><option value="">Copy from…</option>${copyOptions.join("")}</select>` : "";
  const clear = keyListOf(app.saved, mapKey).length ? `<button class="btn sm line" data-act="keysclear">Clear</button>` : "";
  return `<div class="chips key-tools">${allDoors}${copy}${clear}</div>`;
}

/** @param {string} mapKey */
function mapName(mapKey) {
  const config = app.mapConfigs.find((candidate) => candidate.key === mapKey);
  return config ? config.name : mapKey;
}

/** The map's locks arrived: fill the section and draw the doors. */
function onLocksLoaded() {
  renderMapPage();
}

// ---------------------------------------------------------------- handlers

/**
 * The section was opened or closed (it stays that way while the page is open).
 * @param {HTMLDetailsElement} section
 */
export function onKeysSectionToggled(section) {
  if (section.open === app.keysSectionOpen) return; // a redraw, not a click
  app.keysSectionOpen = section.open;
  renderPanel();
  if (section.open) findElement("#keysearch")?.focus();
}

/**
 * Typing in the search: only the results are redrawn, so the box keeps its focus.
 * @param {HTMLInputElement} field
 */
export function onKeySearchInput(field) {
  app.keySearchText = field.value;
  const results = findElement("#keyresults");
  if (results) results.innerHTML = renderSearchResults();
}

/** Enter in the search adds the first key it finds. */
export function onKeySearchEnter() {
  const first = findElement("#keyresults [data-key-add]:not([disabled])");
  if (first) onKeyResultClicked(first);
}

/**
 * "all keys": also search keys that open nothing on this map. Every map's doors are loaded once
 * for it, so their keys can be found too.
 * @param {HTMLInputElement} field
 */
export async function onAllKeysChanged(field) {
  app.keySearchAll = field.checked;
  onKeySearchInput(findElement("#keysearch"));
  if (!field.checked) return;
  await Promise.all(app.mapConfigs.map((config) => loadLootOfMap(config.key)));
  const box = findElement("#keysearch");
  if (box && app.keySearchAll) onKeySearchInput(box);
}

/**
 * A search result: add that key to this map's list.
 * @param {HTMLElement} button
 */
export function onKeyResultClicked(button) {
  const keyId = button.dataset.keyAdd;
  if (!addKeyToList(app.saved, app.mapView.key, keyId)) return;
  app.keySearchText = "";
  save();
  renderMapPage();
  findElement("#keysearch")?.focus();
}

/**
 * × on a key: off the list, with Undo.
 * @param {HTMLElement} button
 */
export function onKeyRemoveClicked(button) {
  const mapKey = app.mapView.key;
  const keyId = button.dataset.keyRemove;
  const name = button.closest(".key-row")?.querySelector(".key-name")?.textContent || "the key";
  const position = removeKeyFromList(app.saved, mapKey, keyId);
  if (position < 0) return;
  save();
  renderMapPage();
  showToast(`Removed ${name}`, {
    label: "Undo",
    run: () => {
      putKeyBack(app.saved, mapKey, keyId, position);
      save();
      renderMapPage();
    },
  });
}

/**
 * A key's name: fly to the doors it opens here.
 * @param {HTMLElement} button
 */
export function onKeyNameClicked(button) {
  if (!flyToKeyDoors(button.dataset.keyFly)) showToast("That key doesn't open anything on this map");
}

/** "All locked doors": also the doors for keys you don't have, dimmed (for this page session). */
function onAllDoorsClicked() {
  app.allDoorsShown = !app.allDoorsShown;
  renderMapPage();
}

/** "Clear": an empty list for this map, with Undo. */
function onClearClicked() {
  const mapKey = app.mapView.key;
  const before = keyListOf(app.saved, mapKey);
  setKeyList(app.saved, mapKey, []);
  save();
  renderMapPage();
  showToast(`Cleared ${before.length} key${before.length === 1 ? "" : "s"}`, {
    label: "Undo",
    run: () => {
      setKeyList(app.saved, mapKey, before);
      save();
      renderMapPage();
    },
  });
}

/**
 * "Copy from…": the other map's keys that matter here are added (Undo puts the list back); the
 * others are left out, and the toast says how many.
 * @param {HTMLSelectElement} select
 */
export async function onCopyFromChanged(select) {
  const sourceMap = select.value;
  if (!sourceMap) return;
  const mapKey = app.mapView.key;
  await loadLootOfMap(mapKey); // which keys matter here needs this map's locks
  if (!app.mapView || app.mapView.key !== mapKey) return;
  const before = keyListOf(app.saved, mapKey);
  const mattersHere = new Set(keysThatMatterOnOpenMap(onLocksLoaded).map((choice) => choice.id));
  const copied = copyKeyList(before, keyListOf(app.saved, sourceMap), mattersHere);
  setKeyList(app.saved, mapKey, copied.list);
  save();
  renderMapPage();
  showToast(copyMessage(copied.added.length, copied.leftOut.length, mapName(sourceMap)), {
    label: "Undo",
    run: () => {
      setKeyList(app.saved, mapKey, before);
      save();
      renderMapPage();
    },
  });
}

/**
 * "Copied 3 keys from Streets of Tarkov · 2 open nothing here, left out".
 * @param {number} addedCount
 * @param {number} leftOutCount
 * @param {string} sourceName
 */
function copyMessage(addedCount, leftOutCount, sourceName) {
  const copied = `Copied ${addedCount} key${addedCount === 1 ? "" : "s"} from ${sourceName}`;
  if (!leftOutCount) return copied;
  const verb = leftOutCount === 1 ? "opens" : "open";
  return `${copied} · ${leftOutCount} ${verb} nothing here, left out`;
}

/**
 * Open the section and scroll to it (the raid-start reminder's button).
 */
export function showKeysSection() {
  app.keysSectionOpen = true;
  if (app.saved.panelTab !== "tasks") {
    app.saved.panelTab = "tasks";
    save();
  }
  renderPanel();
  findElement("[data-keys-section]")?.scrollIntoView({ block: "start" });
}

/** The section's buttons with a data-act, for the panel's click router. */
export const KEYS_SECTION_ACTIONS = {
  keysalldoors: onAllDoorsClicked,
  keysclear: onClearClicked,
};
