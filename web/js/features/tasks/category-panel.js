// @ts-check
// Categories in the panel: the list tools (Pinned only, Clear pins, the sort menu), each category
// with its header, ⋯ menu and rows, the "Done" list, "+ Category", and their handlers.
// The category rules are in categories.js.
import { app } from "../../app/state.js";
import { escapeHtml, findElement, showToast } from "../../app/dom.js";
import { save } from "../../app/saving.js";
import { newId } from "../../app/saved-data.js";
import { renderMapPage } from "../../map/map-page.js";
import { renderPanel } from "../../panel/panel.js";
import { MARKER_SHAPES, renderShapeSwatch } from "../../map/marker-shapes.js";
import { compareRowsByName } from "./rules.js";
import {
  recreateMissingDefaults,
  resortEverything,
  deleteCategory,
  newCategory,
  insertBeforeUnsorted,
  snapshotCategories,
  restoreCategories,
} from "./categories.js";
import { partsOnMap } from "./task-list.js";
import { renderTaskRow } from "./panel.js";
import { isHiddenBySquadFilter } from "../squad/friends.js";

/** @import { Category, PartOnMap } from "../../app/types.js" */

// ---------------------------------------------------------------- list tools

/** "📌 Pinned only", "Clear pins" (when anything is pinned) and the "⇅ Auto-sort" menu. */
export function renderListTools() {
  const saved = app.saved;
  const pinCount = Object.values(saved.tasks).filter((entry) => entry.active && entry.pinned).length;
  return `<div class="sec tools"><button class="chip" data-act="pinnedonly" aria-pressed="${!!saved.pinnedOnly}">📌 Pinned only${pinCount ? ` <span class="n">${pinCount}</span>` : ""}</button>
      ${pinCount ? '<button class="lnk" data-act="clearpins">Clear pins</button>' : ""}
      ${renderSortMenu()}</div>`;
}

function renderSortMenu() {
  const autoSort = `<button class="lnk" data-act="autosort">Auto-sort<br><small>Put parts you haven't moved into the default categories (re-creates any you deleted)</small></button>`;
  const resortAll = `<button class="lnk" data-act="resortall">Re-sort everything…<br><small>Also undoes your manual moves and AI choices</small></button>`;
  return `<details class="menu"><summary class="chip">⇅ Auto-sort</summary><div class="menubox">${autoSort}${resortAll}</div></details>`;
}

// ---------------------------------------------------------------- categories

/**
 * Every category in your order, each with its rows. A row whose category is missing goes to Unsorted.
 * @param {PartOnMap[]} rows
 */
export function renderCategoryLists(rows) {
  const categories = app.saved.cats;
  /** @type {Map<string, PartOnMap[]>} */
  const rowsByCategory = new Map(categories.map((category) => [category.id, []]));
  for (const row of rows) {
    (rowsByCategory.get(row.cat.id) || rowsByCategory.get("unsorted") || []).push(row);
  }
  return categories.map((category) => renderCategory(category, rowsByCategory.get(category.id) || [])).join("");
}

/**
 * One category: its header, its ⋯ menu when open, and (unless collapsed) its rows and Done list.
 * @param {Category} category
 * @param {PartOnMap[]} rows
 */
function renderCategory(category, rows) {
  const saved = app.saved;
  const isListed = (row) => !row.done && (!saved.pinnedOnly || row.pinned) && !isHiddenBySquadFilter(row.task.id);
  const liveRows = rows.filter(isListed).sort(compareRowsByName);
  const doneRows = rows.filter((row) => row.done).sort(compareRowsByName);
  const menu = app.mapView.categoryMenuId === category.id ? renderCategoryMenu(category) : "";
  const list = saved.collapsed[category.id] ? "" : renderCategoryRows(category, liveRows, doneRows);
  return `<div class="cat${category.visible ? "" : " hidden"}" data-cat="${escapeHtml(category.id)}">${renderCategoryHeader(category, liveRows)}${menu}${list}</div>`;
}

/** Shape, name, count ("3 (1 partial)"), "on map"/"hidden"; collapse and ⋯ buttons. */
function renderCategoryHeader(category, liveRows) {
  const isCollapsed = app.saved.collapsed[category.id];
  const partialCount = liveRows.filter((row) => row.part.split).length;
  const count = `${liveRows.length}${partialCount ? ` (${partialCount} partial)` : ""}`;
  return `<div class="cathead" style="--cc:${category.color}"><button class="tog" data-act="togcat" title="Show / hide these markers">${renderShapeSwatch(category.icon, category.color, 18)}<span class="name">${escapeHtml(category.name)}</span><span class="cnt">${count}</span><span class="eye">${category.visible ? "on map" : "hidden"}</span></button>
    <button class="ib" data-act="collapse" title="Collapse list">${isCollapsed ? "▸" : "▾"}</button><button class="ib" data-act="menu" title="Edit category">⋯</button></div>`;
}

/** The ⋯ menu: name, colour, marker shape, move up/down, delete (not Unsorted), Done. */
function renderCategoryMenu(category) {
  const categories = app.saved.cats;
  const index = categories.indexOf(category);
  const shapes = MARKER_SHAPES.map(
    (shape) => `<button data-shape="${shape}" aria-pressed="${shape === category.icon}" title="${shape}">${renderShapeSwatch(shape, category.color, 18)}</button>`,
  ).join("");
  const deleteButton = category.builtin === "unsorted" ? "" : '<button class="btn sm danger" data-act="delcat">Delete</button>';
  return `<div class="catmenu"><label>Name <input type="text" data-catname value="${escapeHtml(category.name)}" maxlength="40" style="flex:1"></label>
    <label>Colour <input type="color" data-catcolor value="${category.color}"></label>
    <label>Marker <span class="shapes">${shapes}</span></label>
    <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm line" data-act="up" ${index === 0 ? "disabled" : ""}>Move up</button><button class="btn sm line" data-act="down" ${index === categories.length - 1 ? "disabled" : ""}>Move down</button>${deleteButton}<button class="btn sm" data-act="menu" style="margin-left:auto">Done</button></div></div>`;
}

/** The rows ("Nothing here" when empty) and, when any are done, the "Done (n)" list. */
function renderCategoryRows(category, liveRows, doneRows) {
  const rowsHtml = liveRows.map(renderTaskRow).join("") || '<div class="empty">Nothing here</div>';
  let doneList = "";
  if (doneRows.length) {
    const isOpen = app.mapView.openDoneCategoryId === category.id;
    doneList = `<details class="donelist"${isOpen ? " open" : ""} data-done="${escapeHtml(category.id)}"><summary>Done (${doneRows.length})</summary>${doneRows.map(renderTaskRow).join("")}</details>`;
  }
  return `<div class="tasks">${rowsHtml}${doneList}</div>`;
}

/** The "New category name…" box at the bottom of the list. */
export function renderNewCategoryBox() {
  return `<div class="newcat"><input type="text" id="newcat" placeholder="New category name…" maxlength="40"><button class="btn" data-act="newcat">+ Category</button></div>`;
}

// ---------------------------------------------------------------- handlers

/**
 * The category a button or field sits in.
 * @param {Element} element
 * @returns {Category | undefined}
 */
function categoryAround(element) {
  const block = element.closest(".cat");
  return block ? app.saved.cats.find((category) => category.id === block.getAttribute("data-cat")) : undefined;
}

/** Undo for the sort menu: put the categories and choices back as they were. */
function undoTo(snapshot) {
  restoreCategories(app.saved, snapshot);
  save();
  renderMapPage();
}

/** "Auto-sort": re-create deleted built-ins. Parts you haven't moved are already sorted. */
function onAutoSortClicked(button) {
  button.closest("details").open = false;
  const snapshot = snapshotCategories(app.saved);
  const categoryIdsBefore = partsOnMap(app.mapView.key).map((row) => row.cat.id).join();
  const added = recreateMissingDefaults(app.saved);
  const categoryIdsAfter = partsOnMap(app.mapView.key).map((row) => row.cat.id).join();
  save();
  renderMapPage();
  if (!added && categoryIdsBefore === categoryIdsAfter) {
    showToast("Everything you haven't moved is already in its default category");
    return;
  }
  const message = added ? `Re-created ${added} default categor${added > 1 ? "ies" : "y"}` : "Sorted";
  showToast(message, { label: "Undo", run: () => undoTo(snapshot) });
}

/** "Re-sort everything…": after a confirm, every part goes to its default category (with Undo). */
function onResortEverythingClicked(button) {
  button.closest("details").open = false;
  const question =
    "Put every part back into its default category? This also undoes your manual moves and AI choices (you can undo right after).";
  if (!confirm(question)) return;
  const snapshot = snapshotCategories(app.saved);
  resortEverything(app.saved);
  save();
  renderMapPage();
  showToast("Re-sorted everything", { label: "Undo", run: () => undoTo(snapshot) });
}

/** The category's header: show or hide its markers on the map. */
function onShowHideClicked(button) {
  const category = categoryAround(button);
  category.visible = !category.visible;
  save();
  renderMapPage();
}

function onCollapseClicked(button) {
  const category = categoryAround(button);
  app.saved.collapsed[category.id] = !app.saved.collapsed[category.id];
  save();
  renderPanel();
}

/** ⋯ and Done: open or close the category's menu (not saved). */
function onMenuClicked(button) {
  const category = categoryAround(button);
  const mapView = app.mapView;
  mapView.categoryMenuId = mapView.categoryMenuId === category.id ? null : category.id;
  renderPanel();
}

/** "Move up" / "Move down": swap with the neighbour. */
function onMoveCategoryClicked(button) {
  const categories = app.saved.cats;
  const index = categories.indexOf(categoryAround(button));
  const otherIndex = button.dataset.act === "up" ? index - 1 : index + 1;
  [categories[index], categories[otherIndex]] = [categories[otherIndex], categories[index]];
  save();
  renderPanel();
}

/** "Delete": after a confirm; its parts go back to their default categories (or Unsorted). */
function onDeleteCategoryClicked(button) {
  const category = categoryAround(button);
  if (!confirm(`Delete “${category.name}”? Its tasks go back to their default categories (or Unsorted).`)) return;
  deleteCategory(app.saved, category);
  app.mapView.categoryMenuId = null;
  save();
  renderMapPage();
}

/** "+ Category" (or Enter in its box). */
function onNewCategoryClicked() {
  const input = findElement("#newcat");
  const name = input.value.trim();
  if (!name) return;
  const categories = app.saved.cats;
  insertBeforeUnsorted(categories, newCategory(categories, "c" + newId(), name));
  save();
  renderPanel();
  showToast(`Added “${name}” — move parts into it with “Move to”`);
}

/**
 * A shape in the ⋯ menu.
 * @param {HTMLElement} button
 */
export function onShapeClicked(button) {
  categoryAround(button).icon = button.dataset.shape;
  save();
  renderMapPage();
}

/**
 * The colour picker in the ⋯ menu.
 * @param {HTMLInputElement} input
 */
export function onCategoryColorChanged(input) {
  categoryAround(input).color = input.value;
  save();
  renderMapPage();
}

/**
 * Typing a category's name: saved as you type, and the header follows without a re-render (so
 * the field keeps focus). An empty name is "Untitled".
 * @param {HTMLInputElement} input
 */
export function onCategoryNameInput(input) {
  const category = categoryAround(input);
  category.name = input.value || "Untitled";
  save();
  input.closest(".cat").querySelector(".tog .name").textContent = category.name;
}

/**
 * A "Done (n)" list opened or closed: remembered while the map is open.
 * @param {HTMLDetailsElement} details
 */
export function onDoneListToggled(details) {
  app.mapView.openDoneCategoryId = details.open ? details.dataset.done : null;
}

/** The category buttons with a data-act, for the panel's click router. */
export const CATEGORY_ACTIONS = {
  autosort: onAutoSortClicked,
  resortall: onResortEverythingClicked,
  togcat: onShowHideClicked,
  collapse: onCollapseClicked,
  menu: onMenuClicked,
  up: onMoveCategoryClicked,
  down: onMoveCategoryClicked,
  delcat: onDeleteCategoryClicked,
  newcat: onNewCategoryClicked,
};
