// Ticket 23: the page opens on the mode select page; a mode opens its map picker, a map opens the
// map, and the breadcrumbs lead back. Opening a mode's page switches the game mode in Settings.
import assert from "node:assert/strict";
import { test } from "node:test";
import { browserSuite, withScenario, stateWithTasks, taskNamed, waitUntil } from "./harness.js";

browserSuite();

const crumbsText = (page) => page.textContent("#crumbs");
const hashIs = (page, hash) => page.waitForFunction((expected) => location.hash === expected, hash);

test("the start page is the mode select page, with a card per mode", async (t) => {
  const dandies = taskNamed("Dandies");
  await withScenario(t, { state: stateWithTasks([dandies.name]) }, async (s) => {
    await s.openModeSelect();
    assert.equal(await crumbsText(s.page), "Pick a game mode");
    const cards = await s.page.$$eval(".modes .mode", (nodes) => nodes.map((node) => ({
      mode: node.dataset.mode,
      name: node.querySelector(".mname").textContent,
      kind: node.querySelector(".mkind").textContent,
      count: node.querySelector(".mcount").textContent,
      notes: [...node.querySelectorAll(".note")].map((note) => note.textContent),
    })));
    assert.deepEqual(cards, [
      { mode: "pve", name: "PvE", kind: "Regular", count: "0 active tasks", notes: [] },
      { mode: "regular", name: "PvP", kind: "Regular", count: "1 active task", notes: ["Last used"] },
      { mode: "pvp-season", name: "PvP Season", kind: "Seasonal", count: "0 active tasks", notes: [] },
    ]);
  });
});

test("PvE, then Customs: the crumbs read PvE / Maps / Customs and lead back step by step", async (t) => {
  await withScenario(t, { state: stateWithTasks([]) }, async (s) => {
    const page = s.page;
    await s.openModeSelect();
    await s.answered("PUT", "/api/settings", () => page.click('.modes .mode[data-mode="pve"]'));
    await hashIs(page, "#/pve/maps");
    await s.waitForPicker();
    assert.equal(await crumbsText(page), "PvE / Maps");
    assert.equal(s.savedSettings().gameMode, "pve", "opening the PvE page switched the mode");

    await page.click('.picker .card[href="#/pve/map/customs"]');
    await s.waitForMap("customs");
    assert.equal(await crumbsText(page), "PvE / Maps / Customs");

    s.step("Maps in the crumbs returns to the picker");
    await page.click('#crumbs a:has-text("Maps")');
    await hashIs(page, "#/pve/maps");
    await s.waitForPicker();

    s.step("PvE in the crumbs returns to the mode select page");
    await page.click('#crumbs a:has-text("PvE")');
    await hashIs(page, "#/");
    await page.waitForSelector(".modes .mode");
    assert.equal(await crumbsText(page), "Pick a game mode");
  });
});

test("picking PvP Season switches the mode and shows that list; the browser's back button walks the steps", async (t) => {
  const dandies = taskNamed("Dandies");
  await withScenario(t, { state: stateWithTasks([dandies.name]) }, async (s) => {
    const page = s.page;
    await s.openPicker("regular");
    assert.match(await page.textContent(".picker .lede"), /^1 active task\./);

    await page.goto(s.base + "/#/");
    await page.waitForSelector(".modes .mode");
    await s.answered("PUT", "/api/settings", () => page.click('.modes .mode[data-mode="pvp-season"]'));
    await hashIs(page, "#/pvp-season/maps");
    await s.waitForPicker();
    assert.equal(await crumbsText(page), "PvP Season / Maps");
    assert.match(await page.textContent(".picker .lede"), /^0 active tasks\./, "the PvP Season list is its own");
    assert.equal(s.savedSettings().gameMode, "pvp-season");

    await page.click('.picker .card[href="#/pvp-season/map/shoreline"]');
    await s.waitForMap("shoreline");
    assert.equal(await crumbsText(page), "PvP Season / Maps / Shoreline");

    s.step("back, back");
    await page.goBack();
    await hashIs(page, "#/pvp-season/maps");
    await s.waitForPicker();
    await page.goBack();
    await hashIs(page, "#/");
    await page.waitForSelector(".modes .mode");
    assert.equal(await crumbsText(page), "Pick a game mode");

    s.step("back to the PvP page switches the list again");
    await page.goBack();
    await hashIs(page, "#/regular/maps");
    await s.waitForPicker();
    await waitUntil(async () => (await s.status()).settings.gameMode === "regular", { what: "Settings to go back to PvP" });
    assert.match(await page.textContent(".picker .lede"), /^1 active task\./);
  });
});

test("the old map address still opens the map, in the Settings mode, without an extra history entry", async (t) => {
  await withScenario(t, { state: stateWithTasks([]), settings: { gameMode: "pve" } }, async (s) => {
    const page = s.page;
    await page.goto(s.base + "/#/map/customs");
    await s.waitForMap("customs");
    assert.equal(await page.evaluate(() => location.hash), "#/pve/map/customs");
    assert.equal(await crumbsText(page), "PvE / Maps / Customs");
  });
});

test("unknown modes and maps fall back", async (t) => {
  await withScenario(t, { state: stateWithTasks([]) }, async (s) => {
    const page = s.page;
    await page.goto(s.base + "/#/arena/maps");
    await hashIs(page, "#/");
    await page.waitForSelector(".modes .mode");
    await page.goto(s.base + "/#/regular/map/atlantis");
    await hashIs(page, "#/regular/maps");
    await s.waitForPicker();
  });
});

test("the top bar's Switch data keeps you on the same page in the new mode", async (t) => {
  await withScenario(t, { state: stateWithTasks([]) }, async (s) => {
    const page = s.page;
    await s.openPicker("regular");
    s.appLog("Session mode: Pve");
    await page.waitForSelector("#modeSwitch", { timeout: 15_000 });
    await s.answered("PUT", "/api/settings", () => page.click("#modeSwitch"));
    await hashIs(page, "#/pve/maps");
    assert.equal(await crumbsText(page), "PvE / Maps");
  });
});

test("at phone width the trail is replaced by one back link", async (t) => {
  await withScenario(t, { phone: true, state: stateWithTasks([]) }, async (s) => {
    const page = s.page;
    await s.openModeSelect();
    assert.equal(await page.isVisible("#crumbback"), false, "nothing to go back to on the first page");
    await page.tap('.modes .mode[data-mode="regular"]');
    await s.waitForPicker();
    assert.equal(await page.isVisible("#crumbs"), false);
    assert.equal((await page.textContent("#crumbback")).trim(), "‹ PvP");
    await page.tap('.picker .card[href="#/regular/map/customs"]');
    await s.waitForMap("customs");
    assert.equal((await page.textContent("#crumbback")).trim(), "‹ Maps");
    await page.tap("#crumbback");
    await s.waitForPicker();
  });
});
