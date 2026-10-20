// @ts-check
// The level picker (the floor dropdown in the map's toolbar) and which level's picture the map
// shows. The rules (options, defaults, follow me, which art groups) are in rules.js; this file
// only draws the dropdown, toggles the art's groups and saves the choice. No timers: the level
// changes on a pick, on a new GPS position and when the map is redrawn.
import { app } from "../../app/state.js";
import { escapeHtml, findElement } from "../../app/dom.js";
import { mapPrefs } from "../../app/map-prefs.js";
import { save } from "../../app/saving.js";
import { renderPlaceNames } from "../../map/place-names.js";
import { positionOnThisMap } from "../find-me/map-layer.js";
import { levelPickerOptions, savedLevelChoice, levelToShow, visibleGroups } from "./rules.js";

const PICKER_TITLE = "Show one level, or follow the level you're on";

/**
 * Draw the level picker (only on maps with level pictures), with the saved choice selected, and
 * show the level it means. Called once when a map opens.
 */
export function renderLevelPicker() {
  const mapView = app.mapView;
  const options = levelPickerOptions(mapView.config);
  const picker = findElement("#floors");
  if (!options.length) {
    picker.innerHTML = "";
  } else {
    const choice = savedLevelChoice(app.saved.prefs[mapView.key], mapView.config);
    const optionsHtml = options.map((option) => renderLevelOption(option, choice)).join("");
    picker.innerHTML = `<select title="${escapeHtml(PICKER_TITLE)}">${optionsHtml}</select>`;
  }
  showLevelForChoice();
}

/**
 * One option of the picker.
 * @param {{ value: string, name: string }} option
 * @param {string} choice the selected value
 */
function renderLevelOption(option, choice) {
  const selected = option.value === choice ? " selected" : "";
  const value = escapeHtml(option.value);
  return `<option value="${value}"${selected}>${escapeHtml(option.name)}</option>`;
}

/**
 * Show the level the saved choice means right now (with "follow", your position's level).
 * Only touches the art when the level changes. Returns true when it changed.
 */
export function showLevelForChoice() {
  const mapView = app.mapView;
  if (!mapView) return false;
  const choice = savedLevelChoice(app.saved.prefs[mapView.key], mapView.config);
  const levelShown = levelToShow(choice, positionOnThisMap(), mapView.config);
  if (levelShown === mapView.levelShown) return false;
  mapView.levelShown = levelShown;
  const shownGroupIds = visibleGroups(mapView.config, levelShown);
  for (const group of mapView.svg.querySelectorAll(".lyr")) {
    group.classList.toggle("off", !shownGroupIds.includes(group.id));
  }
  return true;
}

/**
 * A new GPS position arrived: with "All levels (follow me)" the map switches to your level
 * (and its place names). A chosen level stays.
 */
export function followLevelOfNewPosition() {
  if (showLevelForChoice()) renderPlaceNames();
}

/**
 * A level was picked: remember it for this map, show it and its place names.
 * @param {Event} event
 */
export function onLevelPicked(event) {
  const mapView = app.mapView;
  mapPrefs(mapView.key).level = /** @type {HTMLSelectElement} */ (event.target).value;
  save();
  if (showLevelForChoice()) renderPlaceNames();
}
