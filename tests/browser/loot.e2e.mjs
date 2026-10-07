// Ticket 08: loot spots. The app gets the real json.tarkov.dev files (they have loot) from a
// second mock; the counts are checked against the converter's golden output of those files.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test, before, after } from "node:test";
import { gunzipSync } from "node:zlib";
import { browserSuite, withScenario, readFixture, taskEntry, startRealDataMock, mainThreadRenderingWork, REPO_ROOT } from "./harness.js";

browserSuite();

// The owner's "High value" default, as the page saves it for Customs.
const CUSTOMS_HIGH_VALUE = ["drawer", "jacket", "loose", "medcase", "pc-block", "safe", "technical-supply-crate", "weapon-box"];

let realDataMock = null;
before(async () => {
  realDataMock = await startRealDataMock();
});
after(async () => {
  await realDataMock?.stop();
});

function readGolden(name) {
  return JSON.parse(gunzipSync(fs.readFileSync(path.join(REPO_ROOT, "testdata", "golden", name))).toString("utf8"));
}

/** Spots per chip on a map, straight from the converter's output for the real files. */
function expectedChipCounts(mapKey) {
  const mapLoot = readGolden("loot-real.json.gz").maps[mapKey];
  const counts = { loose: mapLoot.loose.length };
  for (const container of mapLoot.containers) counts[container.t] = (counts[container.t] || 0) + 1;
  return counts;
}

/** Saved data with the first five Customs tasks of the real data active (small enough to save). */
function stateWithCustomsTasks() {
  const state = readFixture("fresh-v2-state.json");
  const customsTasks = readGolden("data-real.json.gz").tasks.filter((task) => task.map === "customs").slice(0, 5);
  for (const task of customsTasks) state.tasks[task.id] = taskEntry();
  return state;
}

/** What the task side of the page shows: markers, "!" badges, the Bring tab's count, selection. */
function taskSideOfPage(page) {
  return page.evaluate(() => ({
    markers: document.querySelectorAll("svg.map g.mk").length,
    notReady: document.querySelectorAll("#panel .bang").length,
    bringTab: document.querySelector('[data-tab="bring"]').textContent,
    selectedRows: document.querySelectorAll(".task.sel").length,
    taskPopupShown: getComputedStyle(document.getElementById("pop")).display !== "none",
  }));
}

/** The centre of a loot marker that's on screen and not covered, single spot or bubble. */
function lootMarkerOnScreen(page, isBubble) {
  return page.evaluate((wantBubble) => {
    const stage = document.getElementById("stage").getBoundingClientRect();
    const toolbar = document.querySelector(".mapui").getBoundingClientRect();
    for (const marker of document.querySelectorAll("svg.map g.lt")) {
      if (marker.classList.contains("lt-group") !== wantBubble) continue;
      const box = marker.getBoundingClientRect();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const isInside = x > stage.left + 40 && x < stage.right - 40 && y > toolbar.bottom + 20 && y < stage.bottom - 40;
      if (isInside && document.elementFromPoint(x, y)?.closest(".lt") === marker) return { x, y };
    }
    return null;
  }, isBubble);
}

/** A point on the map with nothing tappable near it (no task marker, extract or loot). */
function emptyPoint(page) {
  return page.evaluate(() => {
    const stage = document.getElementById("stage").getBoundingClientRect();
    for (let fy = 0.3; fy <= 0.9; fy += 0.03) {
      for (let fx = 0.2; fx <= 0.9; fx += 0.03) {
        const x = stage.left + stage.width * fx;
        const y = stage.top + stage.height * fy;
        const around = [[0, 0], [-20, 0], [20, 0], [0, -20], [0, 20]];
        const isClear = around.every(([ox, oy]) => {
          const hit = document.elementFromPoint(x + ox, y + oy);
          return hit && hit.closest("svg.map") && !hit.closest(".mk, .ex, .lt");
        });
        if (isClear) return { x, y };
      }
    }
    return null;
  });
}

const lootMarkerCount = (page) => page.locator("svg.map g.lt").count();
const lootPopupShown = (page) => page.evaluate(() => {
  const popup = document.getElementById("lootpop");
  return !!popup && !popup.hidden;
});

test("Loot: closed at first, High value shows the data's spots, saved per map, never touching tasks", async (t) => {
  await withScenario(t, { state: stateWithCustomsTasks(), env: { STM_JSON_BASE: realDataMock.base } }, async (s) => {
    s.step("open Customs: loot is off and not even loaded");
    await s.openMap("customs");
    assert.equal(await s.page.$eval("[data-loot-section]", (section) => section.open), false, "the Loot section starts closed");
    assert.equal(await lootMarkerCount(s.page), 0);
    assert.ok(!s.requests.some((line) => line.includes("/api/loot/")), "no loot request until it's needed");
    const before = await taskSideOfPage(s.page);

    s.step("open the section: a chip per type, with the data's counts");
    await s.answered("GET", "/api/loot/customs", () => s.page.click("[data-loot-section] summary"));
    await s.page.waitForSelector("[data-loot]");
    const chips = await s.page.$$eval("[data-loot]", (buttons) => Object.fromEntries(buttons.map((button) => [button.dataset.loot, Number(button.querySelector(".n").textContent)])));
    assert.deepEqual(chips, expectedChipCounts("customs"));
    assert.equal(await lootMarkerCount(s.page), 0, "opening the section shows nothing yet");

    s.step("High value");
    await s.saving(() => s.page.click("[data-act=loothigh]"));
    assert.equal(await s.page.getAttribute("[data-act=loothigh]", "aria-pressed"), "true");
    assert.deepEqual(Object.keys(s.savedState().prefs.customs.loot).sort(), CUSTOMS_HIGH_VALUE);
    await s.page.waitForFunction(() => document.querySelectorAll("svg.map g.lt").length > 0);
    assert.deepEqual(await taskSideOfPage(s.page), before, "loot changes no task marker, readiness, Bring list or selection");

    s.step("tap a spot: its popup, and still no task selected");
    const spot = await lootMarkerOnScreen(s.page, false);
    assert.ok(spot, "a single loot spot is on screen");
    await s.page.mouse.click(spot.x, spot.y);
    await s.page.waitForSelector("#lootpop:not([hidden]) h3");
    assert.ok((await s.page.textContent("#lootpop h3")).trim().length > 0);
    assert.match(await s.page.textContent("#lootpop .m"), /(Container|Loose loot) · (ground level|floor \w)/);
    assert.deepEqual(await taskSideOfPage(s.page), before);

    s.step("an empty spot on the map closes the popup");
    const empty = await emptyPoint(s.page);
    assert.ok(empty, "an empty point on the map");
    await s.page.mouse.click(empty.x, empty.y);
    assert.equal(await lootPopupShown(s.page), false);

    s.step("tap a bubble: the map zooms in on it");
    const bubble = await lootMarkerOnScreen(s.page, true);
    assert.ok(bubble, "a bubble is on screen");
    const widthBefore = (await s.viewBox()).w;
    await s.page.mouse.click(bubble.x, bubble.y);
    await s.page.waitForFunction((width) => document.querySelector("svg.map").viewBox.baseVal.width < width, widthBefore);
    assert.deepEqual(await taskSideOfPage(s.page), before);

    s.step("a chip on its own");
    await s.saving(() => s.page.click('[data-loot="safe"]'));
    assert.equal(await s.page.getAttribute('[data-loot="safe"]', "aria-pressed"), "false");
    assert.equal(await s.page.getAttribute("[data-act=loothigh]", "aria-pressed"), "false", "no longer exactly High value");
    assert.equal(s.savedState().prefs.customs.loot.safe, undefined);

    s.step("reload: the choices stay; the section is closed again");
    await s.reload();
    await s.waitForMap("customs");
    await s.page.waitForFunction(() => document.querySelectorAll("svg.map g.lt").length > 0);
    assert.equal(await s.page.$eval("[data-loot-section]", (section) => section.open), false);

    s.step("another map has its own choices: none");
    await s.openMap("interchange");
    await s.nextFrame();
    assert.equal(await lootMarkerCount(s.page), 0);
    assert.equal(s.savedState().prefs.interchange?.loot, undefined);

    s.step("None clears Customs");
    await s.openMap("customs");
    await s.page.click("[data-loot-section] summary");
    await s.page.waitForSelector("[data-act=lootnone]");
    await s.saving(() => s.page.click("[data-act=lootnone]"));
    assert.equal(await lootMarkerCount(s.page), 0);
    assert.deepEqual(s.savedState().prefs.customs.loot, {});
  });
});

test("Loot on Streets with every chip on: no rendering work while the page is idle", async (t) => {
  const state = readFixture("fresh-v2-state.json");
  const everyChip = { loose: true };
  for (const type of Object.keys(expectedChipCounts("streets-of-tarkov"))) everyChip[type] = true;
  state.prefs["streets-of-tarkov"] = { ext: { pmc: true, scav: false, shared: true, transit: true }, extMarked: {}, labels: true, drawOn: true, loot: everyChip };
  await withScenario(t, { state, env: { STM_JSON_BASE: realDataMock.base } }, async (s) => {
    await s.openMap("streets-of-tarkov");
    await s.page.waitForFunction(() => document.querySelectorAll("svg.map g.lt").length > 0);
    const drawn = await lootMarkerCount(s.page);
    const spots = Object.values(expectedChipCounts("streets-of-tarkov")).reduce((sum, count) => sum + count, 0);
    assert.ok(drawn < spots / 4, `${drawn} markers for ${spots} spots: close spots share a bubble`);
    await s.dragMap(-200, 120);
    await s.page.waitForTimeout(400); // the redraw after the view settles
    const idle = await mainThreadRenderingWork(s.page, 3000);
    assert.equal(idle.Paint, 0, "no paints while idle");
    assert.equal(idle.Layout, 0, "no layouts while idle");
  });
});
