// @ts-check
// The `extracts` live event (ticket 06): the server read your extract-list screenshot and says
// which extracts of the raid's map you have. They are marked like clicks on the map, as auto marks
// (rules.js), and a toast says how many were marked and which names weren't recognised. The event
// is queued on the server until this page acknowledges it, so it still lands if the page was
// closed when the screenshot was read.
import { app } from "../../app/state.js";
import { showToast } from "../../app/dom.js";
import { save } from "../../app/saving.js";
import { mapPrefs } from "../../app/map-prefs.js";
import { rerenderPage } from "../../app/routing.js";
import { applyAutoMarks, extractsReadMessage, matchReadExtracts, extractsAndTransits } from "./rules.js";

/** @import { ExtractsEvent } from "../../app/types.js" */

/**
 * @param {ExtractsEvent} event
 */
export function onExtractsRead(event) {
  const { mapKey, marked, unknown } = whatToMark(event);
  if (!mapKey) {
    showToast("Read your extract list, but couldn't tell which map it is for. Open the map and mark them by hand.");
    return;
  }
  applyAutoMarks(mapPrefs(mapKey).extMarked, marked);
  save();
  rerenderPage();
  showToast(extractsReadMessage(marked.length, unknown));
}

/**
 * The map and the extracts to mark. The server matches the names when it knows the raid's map; when
 * it doesn't (`event.map` is null) it sends the names it read, and they are matched against the
 * map that is open.
 * @param {ExtractsEvent} event
 */
function whatToMark(event) {
  if (event.map) {
    return { mapKey: event.map, marked: event.marked || [], unknown: event.unknown || [] };
  }
  const openMap = app.mapView;
  if (!openMap) {
    return { mapKey: null, marked: [], unknown: [] };
  }
  const mapNames = extractsAndTransits(openMap.mapInfo).map((extract) => extract.n);
  return { mapKey: openMap.key, ...matchReadExtracts(event.read || [], mapNames) };
}
