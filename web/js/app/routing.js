// @ts-check
// Which page shows: the address ends in "#/map/<key>" for a map, anything else shows the map
// picker. Also redraws whatever page is showing after something changed outside it (a live event,
// new game data, Settings).
import { app } from "./state.js";
import { openMap, renderMapPage } from "../map/map-page.js";
import { showPicker } from "../features/picker/panel.js";
import { renderNav } from "../features/raid/nav.js";

const MAP_ADDRESS = /^#\/map\/([\w-]+)/;

/** Show the page the address asks for: a map this app has art for, else the picker. */
export function showPageForAddress() {
  const mapAddress = location.hash.match(MAP_ADDRESS);
  const isKnownMap = mapAddress && app.mapConfigs.some((config) => config.key === mapAddress[1]);
  if (isKnownMap) {
    openMap(mapAddress[1]);
  } else {
    showPicker();
  }
}

/**
 * Redraw the top bar and the page showing. While a map is still loading (the address says map but
 * the map isn't open yet), the map draws itself when it's ready.
 */
export function rerenderPage() {
  renderNav();
  if (app.mapView) {
    renderMapPage();
  } else if (!location.hash.startsWith("#/map/")) {
    showPicker();
  }
}
