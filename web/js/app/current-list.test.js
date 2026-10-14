// Tests for the shown list (current-list.js): the game mode in Settings picks the list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "./state.js";
import { freshState } from "./saved-data.js";
import { currentList, shownGameMode } from "./current-list.js";

/** Settings say this game mode, as /api/status reports it. */
function setSettingsMode(gameMode) {
  app.status = /** @type {any} */ ({ settings: { gameMode } });
}

test("switching game mode shows that mode's list, and both lists stay as they were", () => {
  app.saved = freshState();
  app.saved.modes["pvp-season"].tasks.t1 = { active: true };
  app.saved.modes["pvp-season"].have = { marker: 1 };
  app.saved.modes.pve.tasks.t2 = { active: true };

  setSettingsMode("pvp-season");
  assert.deepEqual(Object.keys(currentList().tasks), ["t1"]);

  setSettingsMode("pve");
  assert.deepEqual(Object.keys(currentList().tasks), ["t2"]);
  assert.deepEqual(currentList().have, {});

  setSettingsMode("pvp-season");
  assert.deepEqual(Object.keys(currentList().tasks), ["t1"]);
  assert.deepEqual(currentList().have, { marker: 1 });
  assert.deepEqual(Object.keys(app.saved.modes.pve.tasks), ["t2"]);
});

test("a change through the shown list lands in that mode's list in the saved data", () => {
  app.saved = freshState();
  setSettingsMode("pve");
  currentList().ticks.o1 = true;
  assert.deepEqual(app.saved.modes.pve.ticks, { o1: true });
  assert.deepEqual(app.saved.modes.regular.ticks, {});
});

test("before the status loads, or with a mode the page doesn't know, PvP is shown", () => {
  app.status = null;
  assert.equal(shownGameMode(), "regular");
  setSettingsMode("arena");
  assert.equal(shownGameMode(), "regular");
  setSettingsMode("pvp-season");
  assert.equal(shownGameMode(), "pvp-season");
});
