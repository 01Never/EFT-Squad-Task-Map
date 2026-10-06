// @ts-check
// The flashing rings around the selected task's markers (#fx). They're HTML elements over the map,
// animated with CSS transform/opacity only: the browser runs that on the compositor without
// repainting the map art, so they can flash for as long as the task is selected at almost no cost.
import { app } from "../app/state.js";
import { findElement } from "../app/dom.js";

// At most this many rings; a task with more spots flashes on the first ones.
const MAX_FLASH_RINGS = 40;

const RING_HTML = '<div class="ping"><i class="halo"></i><i class="wave"></i></div>';

/**
 * Show rings on these points (SVG coordinates, plus a pixel offset when markers overlap).
 * The rings are only rebuilt when the selection or their number changes, so re-renders (ticking,
 * zooming) don't restart the animation.
 * @param {{ x: number, y: number, ox?: number, oy?: number }[]} points
 */
export function renderSelectionFlash(points) {
  const mapView = app.mapView;
  const box = findElement("#fx");
  if (!box) return;
  const shownPoints = points.slice(0, MAX_FLASH_RINGS);
  const signature = (mapView.selectedPartKey || "") + ":" + shownPoints.length;
  if (box.dataset.sig !== signature) {
    box.dataset.sig = signature;
    box.innerHTML = shownPoints.map(() => RING_HTML).join("");
  }
  mapView.flashPoints = shownPoints;
  placeSelectionFlash();
}

/** Move the rings onto their markers after a pan or zoom (CSS transform only). */
export function placeSelectionFlash() {
  const mapView = app.mapView;
  const box = mapView && findElement("#fx");
  if (!box || !mapView.flashPoints || !mapView.flashPoints.length) return;
  const screenMatrix = mapView.svg.getScreenCTM();
  if (!screenMatrix) return;
  const boxArea = box.getBoundingClientRect();
  const rings = box.children;
  mapView.flashPoints.forEach((point, index) => {
    const x = screenMatrix.a * point.x + screenMatrix.c * point.y + screenMatrix.e - boxArea.left + (point.ox || 0);
    const y = screenMatrix.b * point.x + screenMatrix.d * point.y + screenMatrix.f - boxArea.top + (point.oy || 0);
    if (rings[index]) rings[index].style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
  });
}
