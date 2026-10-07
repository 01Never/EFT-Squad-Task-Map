// @ts-check
// The right-hand panel: its header (map name and task count, Hide, 📷 Scan tasks, Add a task by
// name, the v1 banner, the Tasks / Bring list tabs), the sections of each tab in order, the
// footer, hiding and showing it, and the one place its clicks and changes are routed to the
// feature that owns them. Each feature draws its own section.
import { app } from "../app/state.js";
import { escapeHtml, findElement } from "../app/dom.js";
import { save } from "../app/saving.js";
import { mapPrefs } from "../app/map-prefs.js";
import { partsOnMap } from "../features/tasks/task-list.js";
import {
  TASK_ROW_ACTIONS,
  renderAddTaskBox,
  addTaskByName,
  onOtherPartClicked,
  onCounterButtonClicked,
  onMoveToChanged,
  onDontSplitChanged,
} from "../features/tasks/panel.js";
import {
  CATEGORY_ACTIONS,
  renderListTools,
  renderCategoryLists,
  renderNewCategoryBox,
  onShapeClicked,
  onCategoryColorChanged,
  onCategoryNameInput,
  onDoneListToggled,
} from "../features/tasks/category-panel.js";
import { onTickBoxChanged } from "../features/tasks/objective-line.js";
import {
  BRING_LIST_ACTIONS,
  renderBringList,
  countMissingForShownParts,
  onBagStepClicked,
  onBagCountChanged,
} from "../features/readiness/panel.js";
import { EXTRACTS_SECTION_ACTIONS, renderExtractsSection, onKindChipClicked } from "../features/extracts/panel.js";
import { SUB_TASK_ACTIONS, onFloorChanged, onAddBoxEnter } from "../features/sub-tasks/panel.js";
import {
  LOOT_SECTION_ACTIONS,
  renderLootSection,
  onLootChipClicked,
  onLootSectionToggled,
} from "../features/loot/panel.js";
import {
  renderAiCategorizeBox,
  onAiCategorizeClicked,
  onAiCategorizeKeyDown,
  onAiScopeChanged,
} from "../features/ai-categorize/panel.js";
import { startScan } from "../features/scan/panel.js";
import {
  SQUAD_SECTION_ACTIONS,
  renderSquadSection,
  renderFriendsTasksSection,
  onFriendDrawingsToggled,
  onFriendTasksToggled,
} from "../features/squad/panel.js";

/** @import { PartOnMap } from "../app/types.js" */

/**
 * The Tasks tab's sections, top to bottom (CODE-STYLE §1: listed once, here). Each gets the open
 * map's rows.
 * @type {((rows: PartOnMap[]) => string)[]}
 */
const TASKS_TAB_SECTIONS = [
  renderListTools, // 📌 Pinned only, Clear pins, ⇅ Auto-sort (features/tasks)
  renderSquadSection, // a chip per friend, "Shared with squad" (features/squad)
  renderAiCategorizeBox, // 🤖 AI Categorize (features/ai-categorize)
  renderExtractsSection, // Extracts & labels (features/extracts)
  renderLootSection, // Loot, closed until opened (features/loot)
  renderCategoryLists, // the categories and their task rows (features/tasks)
  renderNewCategoryBox, // + Category (features/tasks)
  renderFriendsTasksSection, // friends' tasks you don't have, read-only (features/squad)
];

// ---------------------------------------------------------------- drawing

/** Redraw the panel, keeping its scroll position. */
export function renderPanel() {
  const panel = findElement("#panel");
  if (!panel || !app.mapView) return;
  mapPrefs(app.mapView.key); // creates this map's choices on first use, as v2 did here
  const rows = partsOnMap(app.mapView.key);
  const scrollTop = panel.scrollTop;
  const tab = app.saved.panelTab === "bring" ? "bring" : "tasks";
  let html = renderPanelHeader(rows, tab);
  if (tab === "bring") {
    html += renderBringList();
  } else {
    html += TASKS_TAB_SECTIONS.map((renderSection) => renderSection(rows)).join("");
  }
  html += renderFooter();
  panel.innerHTML = html;
  panel.scrollTop = scrollTop;
}

/**
 * The map's name and how many tasks are left on it, Hide, Scan, Add a task, the banner, the tabs.
 * @param {PartOnMap[]} rows
 * @param {"tasks" | "bring"} tab
 */
function renderPanelHeader(rows, tab) {
  const taskCount = new Set(rows.filter((row) => !row.done).map((row) => row.task.id)).size;
  const missingCount = countMissingForShownParts();
  const banner = app.saved.showScanBanner
    ? `<div class="banner sm">Your saved tasks were carried over from the old version. <b>Scan your task list</b> to load exactly what you have now. <button class="lnk" data-act="hidebanner">Dismiss</button></div>`
    : "";
  return `<div class="phead"><h2>${escapeHtml(app.mapView.config.name)} <span class="hr"><small>${taskCount} task${taskCount === 1 ? "" : "s"}</small><button class="btn sm line hidep" data-act="hidepanel" title="Hide the task list to give the map the whole window">Hide ▸</button></span></h2>
    <div class="row"><button class="btn" data-act="scan" title="Read your task list from in-game screenshots">📷 Scan tasks</button>${renderAddTaskBox()}</div>
    ${banner}
    <div class="tabs"><button data-tab="tasks" aria-pressed="${tab === "tasks"}">Tasks</button><button data-tab="bring" aria-pressed="${tab === "bring"}">Bring list${missingCount ? ` <span class="bang">${missingCount}</span>` : ""}</button></div></div>`;
}

function renderFooter() {
  return `<footer class="pf">Saved to <code>${escapeHtml(app.status.statePath)}</code><br>Map art: Shebuka et al., <a href="https://github.com/the-hideout/tarkov-dev-svg-maps" target="_blank" rel="noopener">tarkov-dev-svg-maps</a> (CC BY-NC-SA 4.0). Task data, projection and styling after <a href="https://tarkov.dev" target="_blank" rel="noopener">tarkov.dev</a>. Not affiliated with Battlestate Games.</footer>`;
}

// ---------------------------------------------------------------- hiding

/**
 * Hide the panel to give the map the whole window (Hide ▸), or show it again (◂ Tasks). Saved.
 * Shown again, it scrolls to the selected task.
 * @param {boolean} isHidden
 */
export function setPanelHidden(isHidden) {
  app.saved.panelHidden = isHidden;
  save();
  const page = document.querySelector(".app");
  if (page) page.classList.toggle("nopanel", isHidden);
  if (isHidden || !app.mapView) return;
  renderPanel();
  const selectedKey = app.mapView.selectedPartKey;
  const selectedRow = selectedKey && document.querySelector(`.task[data-part="${CSS.escape(selectedKey)}"] .trow-wrap`);
  if (selectedRow) selectedRow.scrollIntoView({ block: "center" });
}

// ---------------------------------------------------------------- routing clicks and changes

/** Buttons with a data-act, and their handlers (each feature lists its own). */
const PANEL_ACTIONS = {
  scan: () => startScan(),
  hidepanel: () => setPanelHidden(true),
  hidebanner: onDismissBannerClicked,
  ...TASK_ROW_ACTIONS,
  ...CATEGORY_ACTIONS,
  ...BRING_LIST_ACTIONS,
  ...EXTRACTS_SECTION_ACTIONS,
  ...LOOT_SECTION_ACTIONS,
  ...SUB_TASK_ACTIONS,
  ...SQUAD_SECTION_ACTIONS,
};

/**
 * Buttons marked by another data attribute, and their handlers, checked in this order.
 * @type {[string, (button: HTMLElement) => void][]}
 */
const PANEL_BUTTONS_BY_ATTRIBUTE = [
  ["data-tab", onTabClicked],
  ["data-ext", onKindChipClicked],
  ["data-loot", onLootChipClicked],
  ["data-shape", onShapeClicked],
  ["data-goto", onOtherPartClicked],
  ["data-tick", onCounterButtonClicked],
  ["data-have", onBagStepClicked],
  ["data-squad-drawings", onFriendDrawingsToggled],
  ["data-squad-tasks", onFriendTasksToggled],
];

const ANY_PANEL_BUTTON = "[data-act]," + PANEL_BUTTONS_BY_ATTRIBUTE.map(([attribute]) => `[${attribute}]`).join(",");

/** "Dismiss" on the v1 banner. */
function onDismissBannerClicked() {
  app.saved.showScanBanner = false;
  save();
  renderPanel();
}

/** @param {HTMLElement} button */
function onTabClicked(button) {
  app.saved.panelTab = button.dataset.tab;
  save();
  renderPanel();
}

/**
 * A click anywhere in the panel: AI Categorize first, then the nearest button with one of the
 * attributes above.
 * @param {MouseEvent} event
 */
function onPanelClicked(event) {
  if (onAiCategorizeClicked(event)) return;
  const button = /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest(ANY_PANEL_BUTTON));
  if (!button) return;
  for (const [attribute, handler] of PANEL_BUTTONS_BY_ATTRIBUTE) {
    if (button.hasAttribute(attribute) && button.getAttribute(attribute)) {
      handler(button);
      return;
    }
  }
  const handler = PANEL_ACTIONS[button.dataset.act];
  if (handler) handler(button);
}

/**
 * A field changed: tick boxes, Move to, Don't split, bag counts, a pin's floor, a category's
 * colour, Add a task, the AI scope.
 * @param {Event} event
 */
function onPanelChanged(event) {
  const field = /** @type {HTMLInputElement} */ (event.target);
  if (field.dataset.tickbox) return onTickBoxChanged(field.dataset.tickbox, field.checked);
  if (field.dataset.move) return onMoveToChanged(/** @type {any} */ (field));
  if (field.dataset.nosplit) return onDontSplitChanged(field);
  if (field.hasAttribute("data-haveset")) return onBagCountChanged(field);
  if (field.hasAttribute("data-subfloor")) return onFloorChanged(/** @type {any} */ (field));
  if (field.hasAttribute("data-catcolor")) return onCategoryColorChanged(field);
  if (field.id === "addtask") addTaskByName(field.value);
  if (field.id === "aiscope") onAiScopeChanged(/** @type {any} */ (field));
}

/**
 * Typing: a category's name is saved as you type.
 * @param {Event} event
 */
function onPanelInput(event) {
  const field = /** @type {HTMLInputElement} */ (event.target);
  if (field.hasAttribute("data-catname")) onCategoryNameInput(field);
}

/**
 * Keys: Enter in the AI box sends; Enter in "Add a sub-task", "New category" or "Add a task" works
 * like their buttons.
 * @param {KeyboardEvent} event
 */
function onPanelKeyDown(event) {
  if (onAiCategorizeKeyDown(event)) return;
  if (event.key !== "Enter") return;
  const field = /** @type {HTMLInputElement} */ (event.target);
  if (field.dataset.addsub !== undefined) onAddBoxEnter(field);
  if (field.id === "newcat") findElement("#panel").querySelector('[data-act="newcat"]').click();
  if (field.id === "addtask") addTaskByName(field.value);
}

/**
 * A "Done (n)" list or the Loot section opened or closed (the toggle event doesn't bubble, so this
 * listens while it travels down).
 * @param {Event} event
 */
function onPanelToggle(event) {
  const target = /** @type {Element} */ (event.target);
  const doneList = target.closest && target.closest("[data-done]");
  if (doneList) onDoneListToggled(/** @type {HTMLDetailsElement} */ (doneList));
  if (target.matches && target.matches("[data-loot-section]")) onLootSectionToggled(/** @type {HTMLDetailsElement} */ (target));
}

/** Wire up the panel. Called once per opened map (the panel element is new each time). */
export function bindPanel() {
  const panel = findElement("#panel");
  panel.addEventListener("click", onPanelClicked);
  panel.addEventListener("toggle", onPanelToggle, true);
  panel.addEventListener("change", onPanelChanged);
  panel.addEventListener("input", onPanelInput);
  panel.addEventListener("keydown", onPanelKeyDown);
}
