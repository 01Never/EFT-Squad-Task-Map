// @ts-check
// Extracts in the panel: the "Extracts & labels" section (a chip per extract kind with its count,
// the Place names chip, how marking works, "Clear n marked") and the handlers for its buttons.
import { app } from "../../app/state.js";
import { save } from "../../app/saving.js";
import { mapPrefs } from "../../app/map-prefs.js";
import { renderMapPage } from "../../map/map-page.js";
import { renderPlaceNames } from "../../map/place-names.js";
import { renderPanel } from "../../panel/panel.js";
import { escapeHtml } from "../../app/dom.js";
import { EXTRACT_CHIPS, EXTRACT_KIND_COLORS, countExtractsByKind, isExtractMarked, isAutoMark, autoMarkNote } from "./rules.js";
import { extractsOfOpenMap, renderExtracts } from "./map-layer.js";

/** The "Extracts & labels" section of the Tasks tab. */
export function renderExtractsSection() {
  const prefs = mapPrefs(app.mapView.key);
  const counts = countExtractsByKind(extractsOfOpenMap());
  const markedCount = Object.keys(prefs.extMarked || {}).length;
  const markedList = renderMarkedList(prefs.extMarked || {});
  const kindChips = EXTRACT_CHIPS.map(
    ([kind, label]) =>
      `<button class="chip" data-ext="${kind}" aria-pressed="${prefs.ext[kind]}"><span class="dia" style="background:${EXTRACT_KIND_COLORS[kind]}"></span>${label}<span class="n">${counts[kind]}</span></button>`,
  ).join("");
  const placeNamesChip = `<button class="chip" data-act="labels" aria-pressed="${prefs.labels}">Place names</button>`;
  const clearMarked = markedCount ? ` <button class="lnk" data-act="clearext">Clear ${markedCount} marked</button>` : "";
  return `<div class="sec"><h4>Extracts & labels</h4><div class="chips">${kindChips}${placeNamesChip}</div>
      <p class="bnote">Click an extract on the map to mark it as one you have (solid). After each GPS screenshot the closest marked one is highlighted; with none marked, the closest shown one (transits count only when marked). Marks clear after each raid.${clearMarked}</p>${markedList}</div>`;
}

/**
 * The extracts you have marked on this map, each with an "AI" tag when your screenshot gave it
 * (ticket 06) and the requirement text read beside it ("Requires paracord"; also its tooltip).
 * Nothing when none is marked.
 * @param {Record<string, unknown>} markedByName
 */
function renderMarkedList(markedByName) {
  const names = Object.keys(markedByName).filter((name) => isExtractMarked(markedByName[name]));
  if (names.length === 0) return "";
  const rows = names
    .map((name) => {
      const mark = markedByName[name];
      const note = autoMarkNote(mark);
      const aiTag = isAutoMark(mark)
        ? `<span class="tag ai" title="Marked from your screenshot. Click it on the map to unmark.">AI</span>`
        : "";
      const noteText = note ? `<span class="exnote">${escapeHtml(note)}</span>` : "";
      return `<li${note ? ` title="${escapeHtml(note)}"` : ""}>${escapeHtml(name)}${aiTag}${noteText}</li>`;
    })
    .join("");
  return `<ul class="exlist">${rows}</ul>`;
}

/**
 * A kind chip (PMC, Scav, Shared, Transits): show or hide that kind on this map.
 * @param {HTMLElement} button
 */
export function onKindChipClicked(button) {
  const prefs = mapPrefs(app.mapView.key);
  prefs.ext[button.dataset.ext] = !prefs.ext[button.dataset.ext];
  save();
  renderPanel();
  renderExtracts();
}

/** "Clear n marked": no extract on this map is marked any more. */
function onClearMarksClicked() {
  mapPrefs(app.mapView.key).extMarked = {};
  save();
  renderMapPage();
}

/** "Place names": show or hide this map's place names. */
function onPlaceNamesClicked() {
  const prefs = mapPrefs(app.mapView.key);
  prefs.labels = !prefs.labels;
  save();
  renderPanel();
  renderPlaceNames();
}

/** The section's buttons with a data-act, for the panel's click router. */
export const EXTRACTS_SECTION_ACTIONS = {
  clearext: onClearMarksClicked,
  labels: onPlaceNamesClicked,
};
