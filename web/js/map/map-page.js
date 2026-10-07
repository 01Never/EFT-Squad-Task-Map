// @ts-check
// The map page: opening a map (its art, the toolbar, the overlays, the panel beside it), closing
// it, redrawing everything on it in order, the floor picker and the map's modes (pan, draw, place a
// pin). What each layer draws belongs to its feature; the layer order is in layers.js.
import { app } from "../app/state.js";
import { escapeHtml, findElement } from "../app/dom.js";
import { loadMapArt } from "./map-art.js";
import { makeProj } from "./projection.js";
import { createMapLayers } from "./layers.js";
import { fitViewTo, panTo } from "./view.js";
import { bindMapInput, listenForMapKeys } from "./input.js";
import { renderPlaceNames } from "./place-names.js";
import { renderPanel, bindPanel, setPanelHidden } from "../panel/panel.js";
import { renderTaskMarkers } from "../features/tasks/map-layer.js";
import { renderPopup, bindPopup } from "../features/tasks/popup.js";
import { togglePinnedOnly } from "../features/tasks/panel.js";
import { renderExtracts } from "../features/extracts/map-layer.js";
import { renderDrawings, renderDrawingBar, bindDrawing } from "../features/drawing/map-layer.js";
import { renderPlayer, bindFindMe } from "../features/find-me/map-layer.js";
import { renderFriendDrawings, renderFriendTaskMarkers } from "../features/squad/map-layer.js";

/** @import { MapConfig, MapInfo } from "../app/types.js" */

const PLACE_PIN_HINT = "Click the map to place the sub-task marker · Esc to cancel";

// ---------------------------------------------------------------- opening and closing

/**
 * Open a map: draw the page, load the art (once per file), set up the view, layers and handlers,
 * and draw everything. With a position on this map (Follow my position opened it), centre on you
 * at the map's default zoom.
 * @param {string} mapKey
 */
export async function openMap(mapKey) {
  closeMap();
  const config = app.mapConfigs.find((candidate) => candidate.key === mapKey);
  findElement("#crumbs").innerHTML = `<a href="#/">Maps</a> / <b>${escapeHtml(config.name)}</b>`;
  findElement("#view").innerHTML = renderMapPageFrame();
  const artText = await loadMapArt(config.svg);
  if (location.hash !== "#/map/" + mapKey) return; // you went elsewhere while it loaded
  const svg = mapArtElement(artText, config);
  findElement("#stage").prepend(svg);
  const artBox = svg.viewBox.baseVal;
  const homeView = { x: artBox.x, y: artBox.y, w: artBox.width, h: artBox.height };
  app.mapView = newMapView(mapKey, config, svg, homeView);
  bindMapPage();
  renderFloorPicker();
  renderMapPage();
  fitViewTo(homeView, 0);
  if (app.gps && app.gps.map === mapKey) {
    const [x, y] = app.mapView.projection.toSvg(app.gps.x, app.gps.z);
    panTo(x, y);
  }
}

/**
 * The open map's state (see MapView in app/state.js).
 * @param {string} mapKey
 * @param {MapConfig} config
 * @param {SVGSVGElement} svg
 * @param {{ x: number, y: number, w: number, h: number }} homeView
 * @returns {import("../app/state.js").MapView}
 */
function newMapView(mapKey, config, svg, homeView) {
  const viewBoxArray = [homeView.x, homeView.y, homeView.w, homeView.h];
  /** @type {MapInfo} */
  const noExtracts = { key: mapKey, extracts: [], transits: [] };
  return {
    key: mapKey,
    config,
    svg,
    homeView,
    viewBox: { ...homeView },
    projection: makeProj(config, viewBoxArray),
    floor: "ground",
    mode: "pan",
    placingSubTaskId: null,
    selectedPartKey: null,
    popup: null,
    expandedPartKey: null,
    categoryMenuId: null,
    redoStrokes: [],
    strokeInProgress: null,
    layers: createMapLayers(svg),
    mapInfo: app.gameData.maps.find((mapInfo) => mapInfo.key === mapKey) || noExtracts,
  };
}

/**
 * The map art as an element: no fixed size (it fills the stage), the base layer always shown and
 * the other floors hidden until picked.
 * @param {string} artText
 * @param {MapConfig} config
 * @returns {SVGSVGElement}
 */
function mapArtElement(artText, config) {
  const parsed = new DOMParser().parseFromString(artText, "image/svg+xml").documentElement;
  const svg = /** @type {SVGSVGElement} */ (/** @type {unknown} */ (document.importNode(parsed, true)));
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("class", "map");
  for (const group of [...svg.children]) {
    if (group.tagName !== "g" || !group.id) continue;
    const isBase = group.id === config.baseLayer || /** @type {SVGGElement} */ (group).dataset.keepWithGroup === config.baseLayer;
    group.classList.add("lyr", isBase ? "base" : "off");
  }
  return svg;
}

/** Leave the map: stop listening for its keys and its size. (Its elements go with the page.) */
export function closeMap() {
  const mapView = app.mapView;
  if (mapView) {
    removeEventListener("keydown", mapView.onKeyDown);
    if (mapView.resizeObserver) mapView.resizeObserver.disconnect();
  }
  app.mapView = null;
}

// ---------------------------------------------------------------- the page's HTML

/**
 * The map page: the stage (overlays, toolbar, hint, position bar, popup, "◂ Tasks") and the panel.
 * The map art is added to the stage once loaded.
 */
function renderMapPageFrame() {
  const panelClass = app.saved.panelHidden ? " nopanel" : "";
  return `<div class="app${panelClass}"><div class="stage" id="stage"><div class="fx" id="fx"></div>
    <div class="findme-fx" id="findme-fx"><div class="findme-pulse" id="findme-pulse"></div></div><button class="findme-chip" id="findme-chip" hidden title="Centre on you"><span class="findme-chip-arrow">➜</span><span class="findme-chip-text"></span></button><div class="mapui">
    ${renderToolbar()}
    <div class="grp" id="drawbar" hidden></div></div><div class="hint" id="hint"></div><div class="gpsbar" id="gpsbar" hidden><span id="gpsbar-you"></span><span id="gpsbar-closest"></span></div><div class="pop" id="pop"></div><button class="showpanel" id="showpanel" title="Show the task list">◂ Tasks</button></div><aside id="panel"></aside></div>`;
}

/** Zoom in / out / reset, 📍 Find me, ◎ Follow, ✎ Draw, 📌 Pinned only, and the floor picker. */
function renderToolbar() {
  return `<div class="grp"><button id="zin" title="Zoom in">+</button><button id="zout" title="Zoom out">−</button><button id="zfit" title="Reset view">⤢</button><button id="bfindme" disabled>📍<span class="lbl"> Find me</span></button><button id="bfollow" aria-pressed="false" title="Center the map on me at each screenshot (keeps your zoom)">◎<span class="lbl"> Follow</span></button><button id="bdraw" aria-pressed="false" title="Draw on the map">✎<span class="lbl"> Draw</span></button><button id="bpin" title="Show only pinned tasks">📌<span class="lbl"> Pinned only</span></button><span id="floors" style="display:flex;align-items:center"></span></div>`;
}

/** Wire up everything on the map page. Called once per opened map, after its state exists. */
function bindMapPage() {
  bindMapInput();
  bindDrawing();
  findElement("#bpin").onclick = togglePinnedOnly;
  findElement("#floors").addEventListener("change", onFloorPicked);
  bindPopup();
  findElement("#showpanel").onclick = () => setPanelHidden(false);
  listenForMapKeys();
  bindPanel();
  bindFindMe();
}

// ---------------------------------------------------------------- drawing everything

/**
 * Redraw the whole map page after a change: the panel, then each map layer, then the popup.
 * (Pan and zoom don't need this; they only move the view.)
 */
export function renderMapPage() {
  if (!app.mapView) return;
  renderPanel();
  renderPlaceNames();
  renderExtracts();
  renderFriendDrawings();
  renderDrawings();
  renderFriendTaskMarkers();
  renderTaskMarkers(); // also puts every marker at screen size, friends' included
  renderPlayer();
  renderPopup();
  findElement("#bpin").setAttribute("aria-pressed", String(!!app.saved.pinnedOnly));
}

// ---------------------------------------------------------------- floors

/** The floor picker (only for maps with floor layouts) and which floor's art shows. */
function renderFloorPicker() {
  const mapView = app.mapView;
  const floors = mapView.config.layers.filter((layer) => layer.svgLayer);
  const picker = findElement("#floors");
  if (floors.length) {
    const options = floors.map(
      (floor) => `<option value="${escapeHtml(floor.svgLayer)}" ${mapView.floor === floor.svgLayer ? "selected" : ""}>${escapeHtml(floor.name)}</option>`,
    );
    picker.innerHTML = `<select title="Show a floor's layout">${[`<option value="ground">Ground</option>`, ...options].join("")}</select>`;
  } else {
    picker.innerHTML = "";
  }
  mapView.svg.querySelectorAll(".lyr:not(.base)").forEach((group) => group.classList.toggle("off", group.id !== mapView.floor));
}

/**
 * A floor was picked: show its layout, and the place names on it.
 * @param {Event} event
 */
function onFloorPicked(event) {
  app.mapView.floor = /** @type {HTMLSelectElement} */ (event.target).value;
  renderFloorPicker();
  renderPlaceNames();
}

// ---------------------------------------------------------------- modes

/**
 * Switch the map between panning, drawing (✎ Draw) and placing a sub-task pin. The cursor, the
 * hint, the Draw button and the drawing bar follow.
 * @param {"pan" | "draw" | "place"} mode
 */
export function setMapMode(mode) {
  const mapView = app.mapView;
  mapView.mode = mode;
  const stage = findElement("#stage");
  stage.classList.toggle("draw", mode === "draw");
  stage.classList.toggle("place", mode === "place");
  const hint = findElement("#hint");
  hint.style.display = mode === "place" ? "block" : "none";
  hint.textContent = PLACE_PIN_HINT;
  findElement("#bdraw").setAttribute("aria-pressed", String(mode === "draw"));
  findElement("#drawbar").hidden = mode !== "draw";
  renderDrawingBar();
}
