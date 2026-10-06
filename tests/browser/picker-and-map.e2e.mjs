// The map picker and what a map shows: task counts per map, and the markers, zones and extracts
// drawn on Streets.
import assert from "node:assert/strict";
import { test } from "node:test";
import { browserSuite, withScenario, stateWithEveryTask, stateWithTasks, taskNamed, mapData, assertMatchesRecorded } from "./harness.js";

browserSuite();

/** What each map card says, in order. */
function pickerCards(page) {
  return page.$$eval(".picker .card", (cards) => cards.map((card) => ({
    href: card.getAttribute("href"),
    name: card.querySelector(".meta b").textContent,
    count: card.querySelector(".meta span").textContent,
  })));
}

test("the map picker shows how many active tasks each map has", async (t) => {
  await withScenario(t, { state: stateWithEveryTask() }, async (s) => {
    await s.openPicker();
    const config = await s.api("/api/config");
    const cards = await pickerCards(s.page);
    assert.deepEqual(cards.map((card) => card.href), config.map((map) => "#/map/" + map.key), "one card per map, in the config's order");
    assert.deepEqual(cards.map((card) => card.name), config.map((map) => map.name));
    const taskCount = (await s.api("/api/data")).tasks.length;
    const lede = await s.page.textContent(".picker .lede");
    assert.equal(lede, `${taskCount} active tasks. Pick a map.`);
    const offMap = await s.page.textContent(".picker details.offmap summary");
    assertMatchesRecorded("picker-counts-every-task", { cards: cards.map((card) => `${card.name}: ${card.count}`), offMap });
  });
});

test("a task on one map counts on that map only", async (t) => {
  const dandies = taskNamed("Dandies"); // all of it is on Streets
  await withScenario(t, { state: stateWithTasks([dandies.name]) }, async (s) => {
    await s.openPicker();
    const cards = await pickerCards(s.page);
    for (const card of cards) {
      assert.equal(card.count, card.href === "#/map/streets-of-tarkov" ? "1 task" : "no tasks", card.name);
    }
    assert.equal(await s.page.textContent(".picker .lede"), "1 active task. Pick a map.");
    assert.equal(await s.page.locator(".picker .card .meta span.has").count(), 1, "only the Streets count is highlighted");
  });
});

test("Streets shows the markers, zones and extracts of every active task", async (t) => {
  await withScenario(t, { state: stateWithEveryTask() }, async (s) => {
    await s.openMap("streets-of-tarkov");
    const drawn = await s.page.evaluate(() => {
      const svg = document.querySelector("svg.map");
      // Everything the page draws sits outside the map art's own layers (.lyr).
      const overlayPolygons = [...svg.querySelectorAll("polygon")].filter((polygon) => !polygon.closest(".lyr")).length;
      return {
        markers: svg.querySelectorAll("g.mk").length,
        extracts: [...svg.querySelectorAll("g.ex")].map((group) => group.dataset.name),
        overlayPolygons,
      };
    });
    // Extract chips start as PMC, Shared and Transits on, Scav off.
    const streets = mapData("streets-of-tarkov");
    const shownExtracts = streets.extracts.filter((extract) => extract.fa !== "scav");
    const expectedNames = shownExtracts.map((extract) => extract.n).concat(streets.transits.map((transit) => transit.n));
    assert.deepEqual([...drawn.extracts].sort(), [...expectedNames].sort(), "the PMC, shared and transit extracts are drawn");
    const extractOutlines = shownExtracts.filter((extract) => extract.ol).length + streets.transits.filter((transit) => transit.ol).length;
    const zones = drawn.overlayPolygons - extractOutlines;

    const chipCounts = await s.page.$$eval("#panel [data-ext]", (chips) => chips.map((chip) => `${chip.dataset.ext} ${chip.querySelector(".n").textContent} ${chip.getAttribute("aria-pressed")}`));
    assert.deepEqual(chipCounts, [
      `pmc ${streets.extracts.filter((extract) => extract.fa === "pmc").length} true`,
      `scav ${streets.extracts.filter((extract) => extract.fa === "scav").length} false`,
      `shared ${streets.extracts.filter((extract) => extract.fa !== "pmc" && extract.fa !== "scav").length} true`,
      `transit ${streets.transits.length} true`,
    ]);
    const header = await s.page.textContent("#panel .phead h2 small");
    const categories = await s.page.$$eval("#panel .cat", (blocks) => blocks.map((block) => `${block.querySelector(".tog .name").textContent}: ${block.querySelector(".tog .cnt").textContent}`));
    assert.ok(drawn.markers > 50 && zones > 10, `a busy map (markers ${drawn.markers}, zones ${zones})`);
    assertMatchesRecorded("streets-every-task", { header, markers: drawn.markers, zones, extracts: drawn.extracts.length, categories });
  });
});

test("Scav extracts appear when their chip is turned on", async (t) => {
  await withScenario(t, { state: stateWithTasks(["Dandies"]) }, async (s) => {
    await s.openMap("streets-of-tarkov");
    const before = await s.page.locator("svg.map g.ex").count();
    await s.saving(() => s.page.click('#panel [data-ext="scav"]'));
    assert.equal(await s.page.getAttribute('#panel [data-ext="scav"]', "aria-pressed"), "true");
    const scavExtracts = mapData("streets-of-tarkov").extracts.filter((extract) => extract.fa === "scav").length;
    assert.equal(await s.page.locator("svg.map g.ex").count(), before + scavExtracts);
    assert.equal(s.savedState().prefs["streets-of-tarkov"].ext.scav, true, "the chip is saved");
  });
});
