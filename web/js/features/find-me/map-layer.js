// Find me: draws your position on the map (marker, "You" label, floor badge, trail), the pulse
// after a new position, the off-screen chip, the Find me button and the Follow (auto-center)
// toggle. The rules are in rules.js.
// The pulse and the chip are HTML over the map, moved with CSS transform only: nothing animates
// inside the map SVG (repainting the map art is expensive while Tarkov runs).
import { app, mapName } from "../../store.js";
import { esc, mk, api, toast } from "../../util.js";
import { floorBadge, arrowRotation } from "../../logic/projection.js";
import { apply, panTo, afterUserLetsGo } from "../../map.js";
import {
  CHIP_EDGE_GAP_PIXELS,
  ON_SCREEN_MARGIN_PIXELS,
  BRING_INTO_VIEW_EDGE_FRACTION,
  pulseRemainingMs,
  pulseRingTimings,
  isInsideArea,
  isWellInsideArea,
  chipPositionToward,
  distanceMeters,
  formatDistance,
  viewChangeForNewPosition,
} from "./rules.js";

const SVG_FONT = "bender, Arial, sans-serif";

// The player colour is the CSS variable --player (index.html), so it's set in one place.
const PLAYER_FILL = "fill:var(--player)";

/** A new GPS position arrived from the game: start the pulse. */
export function onNewPosition() {
  app.findMePulseStartedAt = Date.now();
}

/**
 * After a new position is drawn on the open map: centre on it, or leave the view alone, as the
 * auto-center rule says (ticket 02). Never changes the zoom. Waits if you're mid-drag or mid-pinch.
 */
export function moveViewForNewPosition() {
  const settings = app.STATUS.settings;
  const placement = playerPointInArea();
  if (!placement) {
    return;
  }
  const decision = viewChangeForNewPosition({
    isAutoCenterOn: !!settings.autoCenter,
    isFollowOn: !!settings.followPosition,
    isWellInView: isWellInsideArea(placement.point, placement.area, BRING_INTO_VIEW_EDGE_FRACTION),
  });
  if (decision === "centre") {
    afterUserLetsGo(centreOnPlayer);
  }
}

/**
 * The position to show on the open map, or null when there's no position yet or it's on
 * another map. A position whose map is unknown is shown on whichever map is open.
 */
export function positionOnThisMap() {
  const mapView = app.M;
  const position = app.gps;
  if (!mapView || !position) {
    return null;
  }
  if (position.map && position.map !== mapView.key) {
    return null;
  }
  return position;
}

// ---------------------------------------------------------------- drawing (called on every re-render)

/** Draw (or clear) everything about your position on the open map. */
export function renderPlayer() {
  const mapView = app.M;
  if (!mapView) {
    return;
  }
  const layer = mapView.gGps;
  layer.innerHTML = "";
  const position = positionOnThisMap();
  updateFindMeButton(position);
  updateFollowButton();
  renderPulse(position);
  renderPositionBar(position);
  if (!position) {
    hideChip();
    return;
  }
  drawTrail(layer, app.trail, mapView);
  drawPlayerMarker(layer, position, mapView);
  apply(); // gives the new marker its on-screen size and places the pulse and chip
}

/** The last few positions, small and faint so they don't compete with the marker. Oldest is faintest. */
function drawTrail(layer, trail, mapView) {
  trail.forEach((point, index) => {
    const [svgX, svgY] = mapView.proj.toSvg(point.x, point.z);
    const opacity = 0.15 + (0.3 * (index + 1)) / (trail.length + 1);
    const dot = mk("g", { class: "sc", "data-x": svgX, "data-y": svgY, opacity, "pointer-events": "none" }, layer);
    mk("circle", { r: 3, style: PLAYER_FILL, stroke: "#000", "stroke-width": 1 }, dot);
    const minutesAgo = Math.round((Date.now() - point.t) / 60000);
    const label = mk("text", {
      x: 6, y: 3, "font-size": 9, "font-family": SVG_FONT, fill: "#ddd",
      stroke: "#000", "stroke-width": 2.5, "paint-order": "stroke",
    }, dot);
    label.textContent = minutesAgo < 1 ? "<1 min ago" : minutesAgo + " min ago";
  });
}

/**
 * Your marker: a disc in the player colour with a white ring and a black outer edge (reads on
 * light roads and dark buildings), inside a wider ring no other marker has, so it reads as
 * "you" by shape as well as colour. Plus a heading arrow, the floor badge and a "You" label.
 * It's in the top map layer, above task markers and extracts. Nothing here animates.
 */
function drawPlayerMarker(layer, position, mapView) {
  const [svgX, svgY] = mapView.proj.toSvg(position.x, position.z);
  const headingDegrees = arrowRotation(mapView.cfg, position.yaw).toFixed(1);

  // This part turns with your heading.
  const disc = mk("g", { class: "sc", "data-x": svgX, "data-y": svgY, "data-r": headingDegrees, "pointer-events": "none" }, layer);
  mk("circle", { r: 27, fill: "none", stroke: "#000", "stroke-width": 6.5 }, disc);
  mk("circle", { r: 27, fill: "none", style: "stroke:var(--player)", "stroke-width": 3.5 }, disc);
  mk("circle", { r: 18, fill: "none", stroke: "#000", "stroke-width": 3 }, disc);
  mk("circle", { r: 15, style: PLAYER_FILL, stroke: "#fff", "stroke-width": 3 }, disc);
  mk("path", { d: "M0,-10L7,2.5H2.2V9.5H-2.2V2.5H-7Z", fill: "#fff", stroke: "#000", "stroke-width": 1.2, "stroke-linejoin": "round" }, disc);

  // This part stays upright.
  const upright = mk("g", { class: "sc", "data-x": svgX, "data-y": svgY, "pointer-events": "none" }, layer);
  const youLabel = mk("text", {
    x: 33, y: 5.5, "font-size": 16, "font-weight": 700, "font-family": SVG_FONT,
    style: PLAYER_FILL, stroke: "#000", "stroke-width": 4, "paint-order": "stroke",
  }, upright);
  youLabel.textContent = "You";
  const floor = floorBadge(mapView.cfg, position.x, position.y, position.z);
  if (floor) {
    mk("circle", { cx: 19, cy: -19, r: 6.5, fill: "#000", stroke: "#fff", "stroke-width": 1.2 }, upright);
    const floorText = mk("text", {
      x: 19, y: -15.6, "text-anchor": "middle", "font-size": 9.5, "font-weight": 700,
      "font-family": SVG_FONT, fill: "#fff",
    }, upright);
    floorText.textContent = floor;
  }
}

/** The "📍 You · 2 min ago  Show" part of the bar at the bottom of the map (features/extracts adds "Closest: …"). */
function renderPositionBar(position) {
  const bar = document.getElementById("gpsbar");
  const youPart = document.getElementById("gpsbar-you");
  if (!bar || !youPart) {
    return;
  }
  if (!position) {
    bar.hidden = true;
    return;
  }
  const mapView = app.M;
  const floor = floorBadge(mapView.cfg, position.x, position.y, position.z);
  const minutesAgo = Math.round((Date.now() - position.t) / 60000);
  const when = minutesAgo < 1 ? "just now" : minutesAgo + " min ago";
  const floorText = floor ? ` (floor ${esc(floor)})` : "";
  bar.hidden = false;
  youPart.innerHTML = `📍 You${floorText} · ${when} <button class="lnk" id="gpsgo">Show</button>`;
  const showButton = document.getElementById("gpsgo");
  if (showButton) {
    showButton.onclick = findMe;
  }
}

/** The 📍 Find me button is only clickable when there's a position on this map. */
function updateFindMeButton(position) {
  const button = /** @type {HTMLButtonElement | null} */ (document.getElementById("bfindme"));
  if (!button) {
    return;
  }
  button.disabled = !position;
  if (position) {
    button.title = "Centre the map on you (keeps your zoom)";
  } else if (app.gps && app.gps.map) {
    button.title = `Your last position is on ${mapName(app.gps.map)}`;
  } else {
    button.title = "No position yet. In a raid, press your screenshot key.";
  }
}

// ---------------------------------------------------------------- the pulse

/**
 * Show the pulse rings while a pulse is running. Re-renders happen often (ticking, selecting),
 * so the rings are only rebuilt when a different pulse starts; otherwise the animation would
 * restart on every click.
 */
function renderPulse(position) {
  const pulse = document.getElementById("findme-pulse");
  if (!pulse) {
    return;
  }
  const nowMs = Date.now();
  const isRunning = !!position && pulseRemainingMs(app.findMePulseStartedAt, nowMs) > 0;
  const signature = isRunning ? String(app.findMePulseStartedAt) : "";
  if (pulse.dataset.signature === signature) {
    return;
  }
  pulse.dataset.signature = signature;
  pulse.innerHTML = "";
  if (!isRunning) {
    return;
  }
  for (const timing of pulseRingTimings(nowMs - app.findMePulseStartedAt)) {
    const ring = document.createElement("i");
    ring.className = "findme-ring";
    ring.style.animationDelay = timing.delayMs + "ms";
    ring.style.animationIterationCount = String(timing.iterations);
    pulse.appendChild(ring);
  }
}

/** Each ring removes itself when its animation ends, so nothing is left running after 20 s. */
function onPulseRingEnded(event) {
  const ring = event.target;
  if (ring instanceof HTMLElement && ring.classList.contains("findme-ring")) {
    ring.remove();
  }
}

// ---------------------------------------------------------------- placing the HTML overlays (every pan/zoom frame)

/**
 * Move the pulse to your position and show the off-screen chip when you're out of view.
 * Called from the map's apply() on each pan/zoom frame: it only sets CSS transforms, plus the
 * chip's text when the distance changes.
 */
export function placeFindMeOverlays() {
  const pulse = document.getElementById("findme-pulse");
  const placement = playerPointInArea();
  if (!pulse || !placement) {
    hideChip();
    return;
  }
  const { point, area, position } = placement;
  pulse.style.transform = `translate(${point.x.toFixed(1)}px,${point.y.toFixed(1)}px)`;
  if (isInsideArea(point, area, ON_SCREEN_MARGIN_PIXELS)) {
    hideChip();
    return;
  }
  showChip(area, point, distanceFromViewCentre(app.M, position));
}

/**
 * Where your position is on screen, in pixels from the map area's top-left, plus the map area's
 * size. Null when there's no position on this map (or the map isn't laid out yet).
 */
function playerPointInArea() {
  const mapView = app.M;
  const overlay = document.getElementById("findme-fx");
  const position = positionOnThisMap();
  if (!mapView || !overlay || !position) {
    return null;
  }
  const screenMatrix = mapView.svg.getScreenCTM();
  if (!screenMatrix) {
    return null;
  }
  const overlayBox = overlay.getBoundingClientRect();
  const [svgX, svgY] = mapView.proj.toSvg(position.x, position.z);
  const point = {
    x: screenMatrix.a * svgX + screenMatrix.c * svgY + screenMatrix.e - overlayBox.left,
    y: screenMatrix.b * svgX + screenMatrix.d * svgY + screenMatrix.f - overlayBox.top,
  };
  const area = { width: overlayBox.width, height: overlayBox.height };
  return { point, area, position };
}

/** Straight-line metres from the middle of what you're looking at to your position. */
function distanceFromViewCentre(mapView, position) {
  const viewBox = mapView.vb;
  const [centreX, centreZ] = mapView.proj.toGame(viewBox.x + viewBox.w / 2, viewBox.y + viewBox.h / 2);
  return distanceMeters({ x: centreX, z: centreZ }, position);
}

function showChip(area, playerPoint, meters) {
  const chip = document.getElementById("findme-chip");
  if (!chip) {
    return;
  }
  const text = "You · " + formatDistance(meters);
  const textElement = chip.querySelector(".findme-chip-text");
  if (textElement && textElement.textContent !== text) {
    textElement.textContent = text;
    delete chip.dataset.width; // re-measure below
  }
  chip.hidden = false;
  if (!chip.dataset.width) {
    chip.dataset.width = String(chip.offsetWidth);
    chip.dataset.height = String(chip.offsetHeight);
  }
  const chipSize = { width: Number(chip.dataset.width), height: Number(chip.dataset.height) };
  const place = chipPositionToward(area, playerPoint, chipSize, CHIP_EDGE_GAP_PIXELS);
  const left = place.x - chipSize.width / 2;
  const top = place.y - chipSize.height / 2;
  chip.style.transform = `translate(${left.toFixed(1)}px,${top.toFixed(1)}px)`;
  const arrow = /** @type {HTMLElement | null} */ (chip.querySelector(".findme-chip-arrow"));
  if (arrow) {
    arrow.style.transform = `rotate(${place.angleDegrees.toFixed(0)}deg)`;
  }
}

function hideChip() {
  const chip = document.getElementById("findme-chip");
  if (chip) {
    chip.hidden = true;
  }
}

// ---------------------------------------------------------------- buttons

/** Centre the map on you without changing the zoom. Returns false when there's no position here. */
function centreOnPlayer() {
  const position = positionOnThisMap();
  if (!position) {
    return false;
  }
  const [svgX, svgY] = app.M.proj.toSvg(position.x, position.z);
  panTo(svgX, svgY);
  return true;
}

/** 📍 Find me (and the bar's Show button): centre on you, keeping the zoom, and pulse. */
export function findMe() {
  if (!centreOnPlayer()) {
    return;
  }
  app.findMePulseStartedAt = Date.now();
  renderPulse(positionOnThisMap());
}

/** The ◎ Follow toggle mirrors the "Center the map on me" setting. */
function updateFollowButton() {
  const button = document.getElementById("bfollow");
  if (!button) {
    return;
  }
  button.setAttribute("aria-pressed", String(!!app.STATUS.settings.autoCenter));
}

/**
 * ◎ Follow: turn auto-center on or off. It's the same setting as in Settings, saved on the
 * server, so the toolbar and Settings always agree, also after a reload.
 */
async function onFollowClicked() {
  const isTurningOn = !app.STATUS.settings.autoCenter;
  try {
    const response = await api("/api/settings", { method: "PUT", body: { autoCenter: isTurningOn } });
    app.STATUS = response.status;
  } catch (error) {
    toast(String(error.message || error));
    return;
  }
  updateFollowButton();
  if (isTurningOn) {
    centreOnPlayer();
    toast("Following you: each screenshot centres the map on you (your zoom stays)");
  }
}

/** Wire up the Find me and Follow buttons, the off-screen chip and the pulse clean-up. Called when a map opens. */
export function bindFindMe() {
  const findMeButton = document.getElementById("bfindme");
  if (findMeButton) {
    findMeButton.onclick = findMe;
  }
  const followButton = document.getElementById("bfollow");
  if (followButton) {
    followButton.onclick = onFollowClicked;
  }
  const chip = document.getElementById("findme-chip");
  if (chip) {
    chip.onclick = centreOnPlayer; // the chip only moves the view; no pulse (ticket 01)
  }
  const pulse = document.getElementById("findme-pulse");
  if (pulse) {
    pulse.addEventListener("animationend", onPulseRingEnded);
  }
}
