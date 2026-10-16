// Saved data (HANDOFF §6.2): the page loads the data file, migrates or fills it, and saves the
// whole object back. A load and a save with no edits must write the same JSON as before ticket
// 04b, except that v2 files are saved as v3 since ticket 22 (one task list per game mode). STM_E2E_STATE=<path> runs the same check on a copy of a real data file (only read; the app
// works on a copy in a scratch folder).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  browserSuite, withScenario, readFixture, v1StateText, assertMatchesRecorded, writeRecording, stateWithTasks, taskNamed,
} from "./harness.js";

browserSuite();

/** v1 files are migrated and saved as soon as the page loads; nothing else saves without an edit. */
async function loadAndSaveV1(s) {
  await s.saving(() => s.openPicker());
}

/**
 * v2 files: open a map and turn Pinned only on and off again, a change that leaves the data as it
 * was but makes the page save. (Opening a map adds that map's view settings when they're missing,
 * so use a map the file already has settings for.)
 */
async function loadAndSaveV2(s, mapKey) {
  await s.openMap(mapKey);
  await s.saving(async () => {
    await s.page.click("#bpin");
    await s.page.click("#bpin");
  });
}

// The fields of one game mode's task list (saved data v3, ticket 22).
const LIST_FIELDS = ["tasks", "ticks", "used", "have", "subs"];
const GAME_MODES = ["regular", "pve", "pvp-season"];

/**
 * What the page must save for a complete v2 file (ticket 22): version 3, the v2 list under the
 * game mode in Settings, empty lists for the other modes, everything else as it was. Written out
 * here on purpose: this suite imports nothing from web/js.
 */
function asV3(v2, settingsMode = "regular") {
  const shared = { ...v2 };
  const keptList = {};
  for (const field of LIST_FIELDS) {
    keptList[field] = v2[field] || (field === "subs" ? [] : {});
    delete shared[field];
  }
  const modes = {};
  for (const mode of GAME_MODES) {
    modes[mode] = mode === settingsMode ? keptList : { tasks: {}, ticks: {}, used: {}, have: {}, subs: [] };
  }
  delete shared.aiOpen; // the AI Categorize box is gone (ticket 25)
  return { ...shared, version: 3, modes };
}

/**
 * Files with no catsResetAt get the one-time reset to the default categories (ticket 25): the
 * time it ran can't be known, so check it is a recent number and take it out before comparing.
 */
function withoutResetTime(saved) {
  assert.equal(typeof saved.catsResetAt, "number", "the one-time reset recorded when it ran");
  assert.ok(Math.abs(Date.now() - saved.catsResetAt) < 5 * 60_000, "and it ran just now");
  const { catsResetAt, ...rest } = saved;
  return rest;
}

function recordSaved(name, saved) {
  writeRecording(path.join("state", name + ".json"), JSON.stringify(saved, null, 2) + "\n");
}

test("a v1 data file is migrated on load and saved exactly as the recorded migration", async (t) => {
  await withScenario(t, { state: v1StateText() }, async (s) => {
    await loadAndSaveV1(s);
    const saved = s.savedState();
    assert.equal(saved.version, 3);
    assert.equal(saved.migratedFrom, 1);
    assert.ok(Object.keys(saved.modes.regular.tasks).length > 0, "the v1 list is the PvP list (Settings)");
    assert.equal(saved.showScanBanner, true, "the page asks for a scan after a migration");
    recordSaved("v1-data", saved);
    assertMatchesRecorded("roundtrip-v1-data", withoutResetTime(saved));
  });
});

test("a v2 data file with ticks, pins, drawings, view settings, extract marks, categories and sub-tasks saves back as v3, its list under the Settings mode", async (t) => {
  const input = readFixture("rich-v2-state.json");
  await withScenario(t, { state: input, settings: { gameMode: "pvp-season" } }, async (s) => {
    await loadAndSaveV2(s, "streets-of-tarkov");
    const saved = s.savedState();
    assert.deepStrictEqual(saved, asV3(input, "pvp-season"), "same keys and values as the file it loaded, the list moved");
    recordSaved("rich-v2-state", saved);
    assertMatchesRecorded("roundtrip-rich-v2-state", saved);
  });
});

test("a v2 data file with missing fields is filled in with the defaults", async (t) => {
  const input = readFixture("partial-v2-state.json");
  await withScenario(t, { state: input }, async (s) => {
    await loadAndSaveV2(s, "streets-of-tarkov");
    const saved = s.savedState();
    assert.equal(saved.cats.at(-1).builtin, "unsorted", "Unsorted is added when missing");
    assert.deepEqual(saved.prefs["streets-of-tarkov"].extMarked, {});
    for (const entry of Object.values(saved.modes.regular.tasks)) assert.deepEqual(Object.keys(entry).sort(), ["active", "addedAt", "gamePct", "noSplit", "partCats", "pinned", "scannedAt", "source"]);
    recordSaved("partial-v2-state", saved);
    assertMatchesRecorded("roundtrip-partial-v2-state", withoutResetTime(saved));
  });
});

test("a data file over 64 KB still saves (browsers refuse keepalive bodies that big)", async (t) => {
  const input = readFixture("rich-v2-state.json");
  // One long drawing: about 100 KB of data in all.
  const points = Array.from({ length: 9000 }, (_, i) => [i % 500, Math.floor(i / 12)]);
  input.draw["streets-of-tarkov"].push({ c: "#4dff4d", w: 1.5, pts: points });
  assert.ok(JSON.stringify(input).length > 90_000, "the test file is big enough");
  await withScenario(t, { state: input }, async (s) => {
    await loadAndSaveV2(s, "streets-of-tarkov");
    assert.ok(!(await s.page.locator("#saved.err").count()), "no \"Save failed\"");
    assert.equal(await s.page.locator("#saved").textContent(), "Saved ✓");
    assert.deepStrictEqual(s.savedState(), asV3(input), "the file on disk has all of it");
  });
});

const realFile = process.env.STM_E2E_STATE;
test("a copy of a real data file (STM_E2E_STATE) saves back unchanged", { skip: realFile ? false : "set STM_E2E_STATE=<a copy of squad-task-map-data.json> to run this" }, async (t) => {
  const text = fs.readFileSync(realFile, "utf8");
  const input = JSON.parse(text);
  const isV2 = input && input.version === 2;
  const isV3 = input && input.version === 3;
  await withScenario(t, { state: text, recordAs: "saved-data--stm-e2e-state" }, async (s) => {
    let openedMap = null;
    if (isV2 || isV3) {
      const mapKeys = (await s.api("/api/config")).map((map) => map.key);
      openedMap = Object.keys(input.prefs || {}).find((key) => mapKeys.includes(key)) || "streets-of-tarkov";
      await loadAndSaveV2(s, openedMap);
    } else {
      await loadAndSaveV1(s);
    }
    const saved = s.savedState();
    recordSaved("stm-e2e-state", saved);
    const expectedFile = process.env.STM_E2E_STATE_EXPECTED;
    if (expectedFile) {
      assert.deepStrictEqual(saved, JSON.parse(fs.readFileSync(expectedFile, "utf8")), `same keys and values as ${expectedFile}`);
      return;
    }
    if (!isV2 && !isV3) {
      t.diagnostic("a v1 file: set STM_E2E_STATE_EXPECTED to the migration recorded before (record mode writes state/stm-e2e-state.json) to compare");
      return;
    }
    // A file the page wrote itself comes back the same. Defaults the page adds to an older file
    // (fill) are listed, not failed; anything changed or dropped fails.
    const added = [];
    const compare = (before, after, where) => {
      if (before === undefined) {
        added.push(where);
        return;
      }
      if (before && after && typeof before === "object" && typeof after === "object" && Array.isArray(before) === Array.isArray(after)) {
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) compare(before[key], after[key], `${where}.${key}`);
        return;
      }
      assert.deepStrictEqual(after, before, `${where} changed`);
    };
    // Ticket 25: aiOpen is dropped, and a file without catsResetAt has its part moves cleared.
    delete input.aiOpen;
    if (input.catsResetAt === undefined) {
      for (const list of isV2 ? [input] : Object.values(input.modes || {})) {
        for (const entry of Object.values(list.tasks || {})) entry.partCats = {};
      }
      input.catsResetAt = saved.catsResetAt;
    }
    // A v2 file comes back as v3 with its list under the Settings mode ("regular" here).
    compare(isV2 ? asV3(input) : input, saved, "data");
    if (added.length) t.diagnostic(`fields the page added: ${added.join(", ")}`);
    if (!input.prefs?.[openedMap]) t.diagnostic(`(${openedMap}'s view settings were added by opening it)`);
  });
});

test("the one-time reset (ticket 25): part moves are cleared in every mode, categories stay, and a later move survives a reload", async (t) => {
  const glory = taskNamed("Glory to CPSU");
  const state = stateWithTasks([glory.name]);
  delete state.catsResetAt; // a file from before the reset
  state.cats.splice(state.cats.length - 1, 0, { id: "c-key-runs", name: "Key runs", color: "#4dabf7", icon: "star", visible: true, builtin: null });
  state.tasks[glory.id].partCats = { [glory.id + ":go"]: { cat: "c-key-runs", manual: true } };
  state.aiOpen = false;
  await withScenario(t, { state }, async (s) => {
    const page = s.page;
    await s.saving(() => s.openMap("streets-of-tarkov"));
    const saved = s.savedState();
    assert.equal(typeof saved.catsResetAt, "number", "the reset is recorded");
    assert.equal("aiOpen" in saved, false, "aiOpen is dropped");
    assert.deepEqual(s.savedList().tasks[glory.id].partCats, {}, "the move is cleared");
    assert.ok(saved.cats.some((category) => category.id === "c-key-runs"), "the category stays, empty");
    const row = `#panel .task[data-part="${glory.id}:go"]`;
    assert.equal(await page.$eval(row, (element) => element.closest(".cat").dataset.cat), "b-go");

    // A new hand move is kept: reloading doesn't run the reset again.
    await page.click(row + " .trow");
    await s.saving(() => page.selectOption(`#panel select[data-move="${glory.id}:go"]`, "c-key-runs"));
    const resetAt = s.savedState().catsResetAt;
    await s.reload();
    await s.waitForMap("streets-of-tarkov");
    assert.deepEqual(s.savedList().tasks[glory.id].partCats, { [glory.id + ":go"]: { cat: "c-key-runs", manual: true } });
    assert.equal(s.savedState().catsResetAt, resetAt);
    assert.deepEqual(s.requests.filter((line) => /\/api\/ai\/(categorize|job)/.test(line)), [], "no AI Categorize requests");
  });
});
