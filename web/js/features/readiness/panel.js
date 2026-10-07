// @ts-check
// Readiness in the panel: the Bring list tab (what to carry for what's shown on the map, with your
// bag counts), the requirement tags on objective lines, and the handlers for the bag counts.
// The rules are in rules.js.
import { app } from "../../app/state.js";
import { escapeHtml } from "../../app/dom.js";
import { save } from "../../app/saving.js";
import { renderMapPage } from "../../map/map-page.js";
import { isObjectiveOnMap } from "../tasks/rules.js";
import { partsOnMap, isShownOnMap, activeOffMapTasks } from "../tasks/task-list.js";
import { bringList, countMissing, requirementsOf, hasRequirement, isOnKeyList, stepBagCount, setBagCount } from "./rules.js";
import { isItemId, itemIconUrl } from "../icons/rules.js";
import { openMapKeyList, friendsHaveKeyText } from "../keys/key-lists.js";

/** @import { Objective, Task } from "../../app/types.js" */
/** @import { BringEntry } from "./rules.js" */

// Item pictures come from this app (/icons/<id>.webp: downloaded once from assets.tarkov.dev, then
// kept). With none kept and no network, they remove themselves.
// Shown instead of a picture for sets of alternatives.
const PLACEHOLDER_ICON_BY_KIND = { key: "🔑", gear: "🎽", fir: "🔍", place: "🎒" };

// Requirement tags on objective lines: CSS class and icon by kind.
const TAG_ICON_BY_KIND = { key: "🔑 ", gear: "🎽 ", place: "🎒 " };

// A tag lists up to this many alternatives by name ("A or B or C"), then "A or 4 others".
const ALTERNATIVES_NAMED_IN_TAG = 3;

// ---------------------------------------------------------------- the Bring list

/** The Bring list for what's shown on the open map, plus found-in-raid items for off-map tasks. */
export function bringListForShownParts() {
  const mapView = app.mapView;
  const saved = app.saved;
  const shownRows = partsOnMap(mapView.key).filter(isShownOnMap);
  const entries = [];
  for (const row of shownRows) {
    for (const objective of row.part.objs) {
      if (isObjectiveOnMap(objective, mapView.key, row.task)) entries.push({ task: row.task, o: objective });
    }
  }
  /** @type {Map<string, Task>} the shown tasks, then your off-map ones, each once */
  const firTasks = new Map([
    ...shownRows.map((row) => /** @type {[string, Task]} */ ([row.task.id, row.task])),
    ...activeOffMapTasks().map((task) => /** @type {[string, Task]} */ ([task.id, task])),
  ]);
  return bringList(entries, saved.ticks, saved.have, [...firTasks.values()], openMapKeyList());
}

/**
 * The number on the "Bring list" tab: things you have none of (0 if the list can't be made).
 * @returns {number}
 */
export function countMissingForShownParts() {
  try {
    return countMissing(bringListForShownParts());
  } catch {
    return 0;
  }
}

/** The Bring list tab. */
export function renderBringList() {
  const bring = bringListForShownParts();
  return `<div class="bring">
    <div class="bhead"><span>${renderBringSummary(bring)}</span><button class="btn sm line" data-act="resethave">Reset counts</button></div>
    <p class="bnote">Set how many of each you're carrying. A task shows <b>!</b> and fades on the map when you have none of something it needs. Counts reset after each raid; placing a marker or item (ticking it) takes one off. Keys on this map's key list (My keys) count as had.</p>
    ${renderBringSection("Keys", bring.keys)}${renderBringSection("Items to place", bring.place)}${renderBringSection("Gear to wear / use", bring.gear)}${renderBringSection("Find in raid", bring.fir, "For hand-ins — includes your tasks that aren't tied to a map.", false)}
    ${app.saved.pinnedOnly ? '<p class="bnote">Showing pinned tasks only.</p>' : ""}</div>`;
}

/** "3 missing for what's shown on the map", or that you have everything, or that nothing's needed. */
function renderBringSummary(bring) {
  const missing = countMissing(bring);
  if (missing) return `<b class="warnc">${missing} missing</b> for what's shown on the map`;
  const lineCount = bring.keys.length + bring.place.length + bring.gear.length + bring.fir.length;
  return lineCount ? "You have everything for what's shown on the map." : "Nothing needed for what's shown.";
}

/**
 * One section ("Keys 2"), or nothing when it's empty. Found-in-raid lines have no bag count.
 * @param {string} title
 * @param {BringEntry[]} lines
 * @param {string} [note]
 * @param {boolean} [withBagCount]
 */
function renderBringSection(title, lines, note, withBagCount = true) {
  if (!lines.length) return "";
  const noteHtml = note ? `<p class="bnote">${note}</p>` : "";
  const linesHtml = lines.map((line) => renderBringLine(line, withBagCount)).join("");
  return `<div class="bsec"><h4>${title} <small>${lines.length}</small></h4>${noteHtml}${linesHtml}</div>`;
}

/**
 * One line: picture, name, which tasks need it, how many, and your bag count (− n +). A key on
 * the map's key list says "On your key list ✓" instead of a count (ticket 09).
 * @param {BringEntry} line
 * @param {boolean} withBagCount
 */
function renderBringLine(line, withBagCount) {
  const isShort = line.have < 1 && withBagCount && !line.onKeyList;
  const count = line.onKeyList ? `<span class="onlist" title="Keys on My keys count as had on this map">On your key list ✓</span>` : renderBagCount(line);
  return `<div class="bl${isShort ? " short" : ""}" data-key="${escapeHtml(line.key)}">${renderItemPicture(line)}<div class="bn"><b>${escapeHtml(line.name)}</b><span class="bt">${renderNeededBy(line)}</span></div>
    <span class="need">need ${line.need}</span>${withBagCount ? count : ""}</div>`;
}

/** The item's picture when it's one item, else an emoji for its kind. */
function renderItemPicture(line) {
  if (line.items.length === 1 && isItemId(line.items[0].id)) {
    return `<img src="${itemIconUrl(line.items[0].id)}" alt="" loading="lazy" onerror="this.remove()">`;
  }
  const icon = PLACEHOLDER_ICON_BY_KIND[line.kind] || PLACEHOLDER_ICON_BY_KIND.place;
  return `<span class="noimg">${icon}</span>`;
}

/** "Key · found in raid · Task A, Task B 2": the label, then each task (with its count when it says something). */
function renderNeededBy(line) {
  const label = line.label ? escapeHtml(line.label) + " · " : "";
  const foundInRaid = line.fir ? "found in raid · " : "";
  const showsCounts = line.kind === "place" || line.kind === "fir";
  const tasks = line.by.map(([taskName, count]) => `${escapeHtml(taskName)}${count > 1 || showsCounts ? " " + count : ""}`);
  return label + foundInRaid + tasks.join(", ") + renderFriendsWithKey(line);
}

/**
 * " · Sam has it" on a key line when a friend has one of its keys on this map (ticket 09).
 * @param {BringEntry} line
 */
function renderFriendsWithKey(line) {
  if (line.kind !== "key") return "";
  const text = friendsHaveKeyText(line.items.map((item) => item.id));
  return text ? ` · <span class="friendkey">${escapeHtml(text)}</span>` : "";
}

/** The bag count: − [n] +. */
function renderBagCount(line) {
  return `<span class="have"><button class="ib sm" data-have="-1">−</button><input type="number" min="0" max="999" value="${line.have}" data-haveset><button class="ib sm" data-have="1">+</button></span>`;
}

// ---------------------------------------------------------------- requirement tags

/**
 * The tags of what an objective needs (" 🔑 Key name", " 🎒 Marker ×2"…), yellow when you have
 * none. A key on the open map's key list counts as had; a key a friend has says "Sam has it".
 * @param {Objective} objective
 */
export function renderRequirementTags(objective) {
  const bag = app.saved.have;
  const keyList = openMapKeyList();
  return requirementsOf(objective)
    .map((requirement) => {
      const isHad = hasRequirement(requirement, bag, keyList);
      const tagClass = requirement.kind === "key" || requirement.kind === "gear" ? requirement.kind : "place";
      const title = escapeHtml(requirement.label) + requirementTitleNote(requirement, isHad, keyList);
      const icon = TAG_ICON_BY_KIND[tagClass];
      const count = requirement.kind === "place" && requirement.need > 1 ? " ×" + requirement.need : "";
      const friends = requirement.kind === "key" ? friendsHaveKeyText(requirement.items.map((item) => item.id)) : "";
      const friendsText = friends ? ` · <span class="friendkey">${escapeHtml(friends)}</span>` : "";
      return ` <span class="tag ${tagClass}${isHad ? "" : " miss"}" title="${title}">${icon}${escapeHtml(tagItemsName(requirement.items))}${count}${friendsText}</span>`;
    })
    .join("");
}

/**
 * What a tag's tooltip adds after the label: "on your key list", "not in your bag", or nothing.
 * @param {import("./rules.js").Requirement} requirement
 * @param {boolean} isHad
 * @param {Set<string>} keyList
 */
function requirementTitleNote(requirement, isHad, keyList) {
  if (isOnKeyList(requirement, keyList)) return " — on your key list";
  return isHad ? "" : " — not in your bag";
}

/** "A", "A or B or C", or "A or 4 others". */
function tagItemsName(items) {
  if (items.length === 1) return items[0].name;
  if (items.length <= ALTERNATIVES_NAMED_IN_TAG) return items.map((item) => item.name).join(" or ");
  return `${items[0].name} or ${items.length - 1} others`;
}

// ---------------------------------------------------------------- handlers

/**
 * − or + on a Bring list line.
 * @param {HTMLElement} button
 */
export function onBagStepClicked(button) {
  const key = button.closest("[data-key]").getAttribute("data-key");
  stepBagCount(app.saved.have, key, +button.dataset.have);
  save();
  renderMapPage();
}

/**
 * A bag count was typed into a Bring list line.
 * @param {HTMLInputElement} input
 */
export function onBagCountChanged(input) {
  const key = input.closest("[data-key]").getAttribute("data-key");
  setBagCount(app.saved.have, key, input.value);
  save();
  renderMapPage();
}

/** "Reset counts": the bag is empty again (also what raid end does). */
function onResetCountsClicked() {
  app.saved.have = {};
  app.saved.used = {};
  save();
  renderMapPage();
}

/** The Bring list's buttons with a data-act, for the panel's click router. */
export const BRING_LIST_ACTIONS = {
  resethave: onResetCountsClicked,
};
