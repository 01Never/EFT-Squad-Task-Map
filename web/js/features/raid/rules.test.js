// Tests for the raid rules (rules.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshState } from "../../app/saved-data.js";
import { resetAfterRaid, raidOverMessage, modePromptAfterReport } from "./rules.js";

test("after a raid the bag is empty and no extract is marked on any map", () => {
  const saved = freshState();
  saved.have = { marker: 2 };
  saved.used = { objective: 1 };
  saved.prefs = {
    customs: { ext: {}, extMarked: { "Crash Site": true }, labels: true, drawOn: true },
    woods: { ext: {}, extMarked: { "Outskirts": true }, labels: false, drawOn: true },
  };

  resetAfterRaid(saved);

  assert.deepEqual(saved.have, {});
  assert.deepEqual(saved.used, {});
  assert.deepEqual(saved.prefs.customs.extMarked, {});
  assert.deepEqual(saved.prefs.woods.extMarked, {});
  assert.equal(saved.prefs.woods.labels, false, "other map choices stay");
});

test("the raid-over message says how many GPS screenshots were deleted, if any", () => {
  assert.equal(raidOverMessage(0), "Raid over: bag counts and extract marks reset");
  assert.equal(raidOverMessage(1), "Raid over: bag counts and extract marks reset, 1 GPS screenshot deleted");
  assert.equal(raidOverMessage(2), "Raid over: bag counts and extract marks reset, 2 GPS screenshots deleted");
});

test("the game reporting the mode in Settings clears the prompt", () => {
  const situation = { reportedMode: "pve", settingMode: "pve", currentPrompt: "pve", dismissedMode: null };
  assert.deepEqual(modePromptAfterReport(situation), { prompt: null, hasChanged: true });
  const nothingShowing = { ...situation, currentPrompt: null };
  assert.deepEqual(modePromptAfterReport(nothingShowing), { prompt: null, hasChanged: false });
});

test("another mode is offered, unless you said Not now to that mode", () => {
  const situation = { reportedMode: "pve", settingMode: "regular", currentPrompt: null, dismissedMode: null };
  assert.deepEqual(modePromptAfterReport(situation), { prompt: "pve", hasChanged: true });
  const dismissed = { ...situation, dismissedMode: "pve" };
  assert.deepEqual(modePromptAfterReport(dismissed), { prompt: null, hasChanged: false });
});

test("only the last reported mode counts: PvE then PvP Season leaves no prompt in PvP Season", () => {
  const settingMode = "pvp-season";
  const afterPve = modePromptAfterReport({ reportedMode: "pve", settingMode, currentPrompt: null, dismissedMode: null });
  const afterSeason = modePromptAfterReport({ reportedMode: "pvp-season", settingMode, currentPrompt: afterPve.prompt, dismissedMode: null });
  assert.equal(afterSeason.prompt, null);
});
