// @ts-check
// The mode select page (the start page): a card per game mode, in the game's order. Picking one
// opens that mode's map picker (the address change switches the mode, see app/routing.js).
// What each card says is decided in rules.js.
import { app } from "../../app/state.js";
import { escapeHtml, findElement } from "../../app/dom.js";
import { pickerAddress } from "../../app/addresses.js";
import { showCrumbs } from "../../app/crumbs.js";
import { shownGameMode } from "../../app/current-list.js";
import { closeMap } from "../../map/map-page.js";
import { modeCards } from "./rules.js";

/** @import { ModeCard } from "./rules.js" */

/** Show the mode select page (closing the map if one was open). */
export function showModeSelect() {
  closeMap();
  showCrumbs({ page: "select" });
  const sessionMode = app.status && app.status.raid && app.status.raid.sessionMode;
  const cards = modeCards(app.saved, shownGameMode(), sessionMode);
  findElement("#view").innerHTML = `<div class="picker modesel">
    <div class="phd"><div><h1>Game mode</h1><p class="lede">Pick the game mode. Each mode has its own tasks.</p></div></div>
    <div class="modes">${cards.map(renderModeCard).join("")}</div>
  </div>`;
}

/** @param {ModeCard} card */
function renderModeCard(card) {
  const taskText = card.activeTasks + " active task" + (card.activeTasks === 1 ? "" : "s");
  const notes = [];
  if (card.lastUsed) notes.push(`<span class="note used">Last used</span>`);
  if (card.gameIsInThisMode) notes.push(`<span class="note ingame">Game is in this mode</span>`);
  return `<a class="mode" data-mode="${card.mode}" href="${pickerAddress(card.mode)}">
    <b class="mname">${escapeHtml(card.name)}</b>
    <span class="mkind">${card.kind}</span>
    <span class="mcount ${card.activeTasks ? "has" : ""}">${taskText}</span>
    <span class="mnotes">${notes.join("")}</span>
  </a>`;
}
