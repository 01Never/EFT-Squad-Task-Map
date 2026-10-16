// @ts-check
// One objective line, as the open task row and the map popup show it: its tick control (a checkbox,
// or − n/N + for counts), its text and its tags; and the handlers for those tick controls.
import { app } from "../../app/state.js";
import { currentList } from "../../app/current-list.js";
import { escapeHtml } from "../../app/dom.js";
import { save } from "../../app/saving.js";
import { objectiveById } from "../../app/game-data.js";
import { renderMapPage } from "../../map/map-page.js";
import { isObjectiveDone, usesCounter, tickCount, tickTarget, NOT_ON_YOUR_LIST_TITLE } from "./rules.js";
import { setTick } from "./task-list.js";
import { isObjectivePossible } from "../readiness/rules.js";
import { renderRequirementTags } from "../readiness/panel.js";

/** @import { Objective } from "../../app/types.js" */

/**
 * The objective's line. Done objectives are struck through; with `isOnThisMap` false (objectives
 * on another map) the line is greyed out. With `canTick` false (a squadmate's task you don't
 * have, ticket 26) the tick control is there but disabled, and readiness says nothing.
 * @param {Objective} objective
 * @param {boolean} [isOnThisMap]
 * @param {boolean} [canTick]
 */
export function renderObjectiveLine(objective, isOnThisMap = true, canTick = true) {
  const isDone = isObjectiveDone(objective, currentList().ticks);
  const classes = `ob${isDone ? " done" : ""}${isOnThisMap ? "" : " away"}`;
  const control = canTick ? renderTickControl(objective, isDone) : renderDisabledTickControl(objective, isDone);
  return `<li class="${classes}">${control}<span class="od">${escapeHtml(objective.d)}</span>${renderObjectiveTags(objective, isDone, canTick)}</li>`;
}

/** A checkbox, or − n/N + for objectives with a count. */
function renderTickControl(objective, isDone) {
  const id = escapeHtml(objective.id);
  if (usesCounter(objective)) {
    const count = `${tickCount(objective, currentList().ticks)}/${tickTarget(objective)}`;
    return `<span class="ctr"><button class="ib sm" data-tick="-1" data-obj="${id}" title="Less">−</button><b>${count}</b><button class="ib sm" data-tick="1" data-obj="${id}" title="More">+</button></span>`;
  }
  return `<input type="checkbox" data-tickbox="${id}" ${isDone ? "checked" : ""} title="Done">`;
}

/** The same controls, disabled and without their data hooks: "Not on your task list". */
function renderDisabledTickControl(objective, isDone) {
  if (usesCounter(objective)) {
    const count = `${tickCount(objective, currentList().ticks)}/${tickTarget(objective)}`;
    return `<span class="ctr" title="${NOT_ON_YOUR_LIST_TITLE}"><button class="ib sm" disabled title="${NOT_ON_YOUR_LIST_TITLE}">−</button><b>${count}</b><button class="ib sm" disabled title="${NOT_ON_YOUR_LIST_TITLE}">+</button></span>`;
  }
  return `<input type="checkbox" class="notmine-tick" disabled ${isDone ? "checked" : ""} title="${NOT_ON_YOUR_LIST_TITLE}">`;
}

/**
 * The tags after the text, in order: optional, FIR, what it needs (readiness), quest item, time
 * window, possible spots on this map, "no armor" restriction, and "! missing items" (only for
 * your own tasks).
 */
function renderObjectiveTags(objective, isDone, canTick) {
  const tags = [
    objective.opt ? ' <span class="tag">optional</span>' : "",
    objective.fir ? ' <span class="tag fir">FIR</span>' : "",
    renderRequirementTags(objective),
    objective.qi && objective.type !== "giveQuestItem" ? ` <span class="tag">${escapeHtml(objective.qi)}</span>` : "",
    objective.time ? ` <span class="tag">🕑 ${objective.time[0]}:00–${objective.time[1]}:00</span>` : "",
    renderPossibleSpotsTag(objective),
    objective.gear && objective.gear.notWearing ? ' <span class="tag">no armor/gear restriction</span>' : "",
    canTick && !isDone && !isObjectivePossible(objective, currentList().have) ? ' <span class="tag miss">! missing items</span>' : "",
  ];
  return tags.join("");
}

/** "12 possible spots": where the quest item may be on the open map. */
function renderPossibleSpotsTag(objective) {
  const mapKey = app.mapView ? app.mapView.key : null;
  let count = 0;
  if (mapKey) {
    for (const spotSet of objective.poss) {
      if (spotSet.m === mapKey) count += spotSet.p.length;
    }
  }
  return count ? ` <span class="tag">${count} possible spots</span>` : "";
}

/**
 * A tick checkbox changed (in the list or the popup).
 * @param {string} objectiveId
 * @param {boolean} isChecked
 */
export function onTickBoxChanged(objectiveId, isChecked) {
  const objective = objectiveById(objectiveId);
  if (!objective) return;
  if (setTick(objective, !!isChecked)) save();
  renderMapPage();
}

/**
 * − or + on a counter.
 * @param {string} objectiveId
 * @param {number} step -1 or 1
 */
export function onTickCounterClicked(objectiveId, step) {
  const objective = objectiveById(objectiveId);
  if (!objective) return;
  if (setTick(objective, tickCount(objective, currentList().ticks) + step)) save();
  renderMapPage();
}
