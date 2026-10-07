// @ts-check
// One objective line, as the open task row and the map popup show it: its tick control (a checkbox,
// or − n/N + for counts), its text and its tags; and the handlers for those tick controls.
import { app } from "../../app/state.js";
import { escapeHtml } from "../../app/dom.js";
import { save } from "../../app/saving.js";
import { objectiveById } from "../../app/game-data.js";
import { renderMapPage } from "../../map/map-page.js";
import { isObjectiveDone, usesCounter, tickCount, tickTarget } from "./rules.js";
import { setTick } from "./task-list.js";
import { isObjectivePossible } from "../readiness/rules.js";
import { renderRequirementTags } from "../readiness/panel.js";
import { openMapKeyList } from "../keys/key-lists.js";

/** @import { Objective } from "../../app/types.js" */

/**
 * The objective's line. Done objectives are struck through; with `isOnThisMap` false (objectives
 * on another map) the line is greyed out.
 * @param {Objective} objective
 * @param {boolean} [isOnThisMap]
 */
export function renderObjectiveLine(objective, isOnThisMap = true) {
  const isDone = isObjectiveDone(objective, app.saved.ticks);
  const classes = `ob${isDone ? " done" : ""}${isOnThisMap ? "" : " away"}`;
  return `<li class="${classes}">${renderTickControl(objective, isDone)}<span class="od">${escapeHtml(objective.d)}</span>${renderObjectiveTags(objective, isDone)}</li>`;
}

/** A checkbox, or − n/N + for objectives with a count. */
function renderTickControl(objective, isDone) {
  const id = escapeHtml(objective.id);
  if (usesCounter(objective)) {
    const count = `${tickCount(objective, app.saved.ticks)}/${tickTarget(objective)}`;
    return `<span class="ctr"><button class="ib sm" data-tick="-1" data-obj="${id}" title="Less">−</button><b>${count}</b><button class="ib sm" data-tick="1" data-obj="${id}" title="More">+</button></span>`;
  }
  return `<input type="checkbox" data-tickbox="${id}" ${isDone ? "checked" : ""} title="Done">`;
}

/**
 * The tags after the text, in order: optional, FIR, what it needs (readiness), quest item, time
 * window, possible spots on this map, "no armor" restriction, and "! missing items".
 */
function renderObjectiveTags(objective, isDone) {
  const tags = [
    objective.opt ? ' <span class="tag">optional</span>' : "",
    objective.fir ? ' <span class="tag fir">FIR</span>' : "",
    renderRequirementTags(objective),
    objective.qi && objective.type !== "giveQuestItem" ? ` <span class="tag">${escapeHtml(objective.qi)}</span>` : "",
    objective.time ? ` <span class="tag">🕑 ${objective.time[0]}:00–${objective.time[1]}:00</span>` : "",
    renderPossibleSpotsTag(objective),
    objective.gear && objective.gear.notWearing ? ' <span class="tag">no armor/gear restriction</span>' : "",
    !isDone && !isObjectivePossible(objective, app.saved.have, openMapKeyList()) ? ' <span class="tag miss">! missing items</span>' : "",
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
  setTick(objective, !!isChecked);
  save();
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
  setTick(objective, tickCount(objective, app.saved.ticks) + step);
  save();
  renderMapPage();
}
