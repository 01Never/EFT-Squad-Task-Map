// @ts-check
// A new squad view arrived (the `squad` live event, or the answer of join / leave / profile, or
// GET /api/squad at start-up): keep it in app.squad and redraw only what it changed. A friend's
// new drawing redraws that friend's lines alone; a friend's changed tasks redraw the page once; a
// friend going online or away redraws the chips alone and leaves the rest of the panel (and
// anything you are typing in it) as it is. What changed is worked out in rules.js.
import { app } from "../../app/state.js";
import { renderMapPage } from "../../map/map-page.js";
import { renderSquadChipsInPlace } from "./panel.js";
import { renderFriendDrawingsOf } from "./map-layer.js";
import { refreshSquadSettings } from "./settings-section.js";
import { describeSquadChange, friendPrefsOf } from "./rules.js";

/** @import { SquadEvent, SquadView } from "../../app/types.js" */

/**
 * The `squad` live event (a broadcast: the same view as GET /api/squad).
 * @param {SquadEvent} event
 */
export function onSquadChanged(event) {
  applySquadView(event.squad);
}

/**
 * Take a new view and redraw what it changed.
 * @param {SquadView} view
 */
export function applySquadView(view) {
  const before = app.squad;
  app.squad = view;
  const mapKey = app.mapView ? app.mapView.key : null;
  const change = describeSquadChange(before, view, mapKey);
  if (change.settingsChanged) refreshSquadSettings();
  if (!app.mapView) return;
  const joinedChanged = !before || before.settings.joined !== view.settings.joined;
  const needsWholePage = joinedChanged || change.tasksChanged.some(isShowingTasksOf);
  if (needsWholePage) {
    renderMapPage();
    return;
  }
  if (change.chipsChanged) renderSquadChipsInPlace();
  for (const playerId of change.drawingsChanged) renderFriendDrawingsOf(playerId);
}

/**
 * Whether you chose to show this friend's tasks (only then do their tasks change the page).
 * @param {string} playerId
 */
function isShowingTasksOf(playerId) {
  return friendPrefsOf(app.saved, playerId).tasks;
}
