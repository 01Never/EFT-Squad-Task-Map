// @ts-check
// Loot in the panel (ticket 08): the "Loot" section, closed until you open it. Inside: "High
// value", "None", a chip per container type and one for loose loot, each with its count on this
// map. Choices are saved per map (prefs[map].loot). The handlers for its buttons are here.
import { app } from "../../app/state.js";
import { escapeHtml } from "../../app/dom.js";
import { save } from "../../app/saving.js";
import { mapPrefs } from "../../app/map-prefs.js";
import { renderPanel } from "../../panel/panel.js";
import { lootOfMap, lootFailedToLoad } from "./loot-data.js";
import { renderLoot } from "./map-layer.js";
import {
  lootChoicesOf,
  toggleLootChip,
  lootChipsForMap,
  highValueChoices,
  isHighValueOn,
  lootGlyph,
} from "./rules.js";

/** @import { LootChip } from "./rules.js" */

/** The "Loot" section of the Tasks tab: a heading you open, with the chips inside. */
export function renderLootSection() {
  const mapKey = app.mapView.key;
  const choices = lootChoicesOf(app.saved.prefs[mapKey]);
  const chipsOnCount = Object.keys(choices).length;
  const onText = chipsOnCount ? ` <span class="n">${chipsOnCount} on</span>` : "";
  const summary = `<summary><h4>Loot${onText}</h4></summary>`;
  if (!app.lootSectionOpen) {
    return `<details class="sec loot-sec" data-loot-section>${summary}</details>`;
  }
  return `<details class="sec loot-sec" data-loot-section open>${summary}${renderLootSectionBody(mapKey, choices)}</details>`;
}

/**
 * The chips, or why there are none yet.
 * @param {string} mapKey
 * @param {Record<string, true>} choices
 */
function renderLootSectionBody(mapKey, choices) {
  const loot = lootOfMap(mapKey, onLootLoaded);
  if (!loot) {
    const message = lootFailedToLoad(mapKey) ? "Couldn't load the loot spots. Is the program still running?" : "Loading loot spots…";
    return `<p class="bnote">${message}</p>`;
  }
  if (!loot.available) {
    return `<p class="bnote">Loot spots come with the game data download. Settings → Game data → Update game data now.</p>`;
  }
  const chips = lootChipsForMap(loot);
  if (!chips.length) {
    return `<p class="bnote">The game data has no loot spots for this map.</p>`;
  }
  const presetPressed = isHighValueOn(choices, chips);
  const presets = `<button class="chip" data-act="loothigh" aria-pressed="${presetPressed}" title="Safes, weapon boxes, PC blocks, tech crates, medcases, jackets, drawers and loose loot">★ High value</button>`
    + (Object.keys(choices).length ? `<button class="chip" data-act="lootnone">None</button>` : "");
  const chipButtons = chips.map((chip) => renderLootChip(chip, !!choices[chip.id])).join("");
  return `<div class="chips">${presets}</div><div class="chips loot-chips">${chipButtons}</div>
    <p class="bnote">From tarkov.dev. Close spots share a bubble; tap it to zoom in. Tap a spot for what it is and its floor.</p>`;
}

/**
 * A chip: the type's sign, its name and how many on this map.
 * @param {LootChip} chip
 * @param {boolean} isOn
 */
function renderLootChip(chip, isOn) {
  const sign = `<span class="loot-sign">${escapeHtml(lootGlyph(chip.id))}</span>`;
  return `<button class="chip" data-loot="${escapeHtml(chip.id)}" aria-pressed="${isOn}">${sign}${escapeHtml(chip.label)}<span class="n">${chip.count}</span></button>`;
}

/** The map's loot arrived: fill the section. */
function onLootLoaded() {
  renderPanel();
  renderLoot();
}

/**
 * The section was opened or closed (it stays that way while the page is open).
 * @param {HTMLDetailsElement} section
 */
export function onLootSectionToggled(section) {
  if (section.open === app.lootSectionOpen) return; // a redraw, not a click
  app.lootSectionOpen = section.open;
  renderPanel();
}

/**
 * A chip: show or hide that type of spot on this map.
 * @param {HTMLElement} button
 */
export function onLootChipClicked(button) {
  const prefs = mapPrefs(app.mapView.key);
  prefs.loot = toggleLootChip(lootChoicesOf(prefs), button.dataset.loot);
  saveAndRedraw();
}

/** "High value": exactly the preset's types; pressed again, nothing. */
function onHighValueClicked() {
  const prefs = mapPrefs(app.mapView.key);
  const loot = lootOfMap(app.mapView.key, onLootLoaded);
  if (!loot) return;
  const chips = lootChipsForMap(loot);
  const choices = lootChoicesOf(prefs);
  prefs.loot = isHighValueOn(choices, chips) ? {} : highValueChoices(chips);
  saveAndRedraw();
}

/** "None": every loot chip off on this map. */
function onNoneClicked() {
  mapPrefs(app.mapView.key).loot = {};
  saveAndRedraw();
}

function saveAndRedraw() {
  save();
  renderPanel();
  renderLoot();
}

/** The section's buttons with a data-act, for the panel's click router. */
export const LOOT_SECTION_ACTIONS = {
  loothigh: onHighValueClicked,
  lootnone: onNoneClicked,
};
