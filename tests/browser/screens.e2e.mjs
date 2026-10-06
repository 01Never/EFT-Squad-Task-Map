// The main screens, with the rich saved-data fixture. In record mode (STM_E2E_RECORD) each step
// saves a screenshot for compare.mjs; otherwise these just check the screens come up.
// The scratch folders have fixed names here: the panel footer and Settings show their paths, and
// those must be the same in every run for the screenshots to match.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { browserSuite, withScenario, readFixture, taskNamed } from "./harness.js";

browserSuite();

const revision = taskNamed("Revision - Streets of Tarkov");

async function waitForMapThumbnails(page) {
  await page.waitForFunction(() => [...document.querySelectorAll(".picker .card")].every((card) => card.querySelector(".thumb svg")));
}

test("the picker, the map, the task list, the Bring list and Settings come up (screenshots in record mode)", async (t) => {
  const dataDir = path.join(os.tmpdir(), "stm-e2e-screens-desktop");
  await withScenario(t, { state: readFixture("rich-v2-state.json"), dataDir }, async (s) => {
    const page = s.page;
    await s.openPicker();
    await waitForMapThumbnails(page);
    await s.screenshot("picker");

    await page.click('.picker .card[href="#/map/streets-of-tarkov"]');
    await s.waitForMap("streets-of-tarkov");
    assert.ok((await page.locator("svg.map g.mk").count()) > 0);
    await s.screenshot("map-streets");
    await s.screenshot("panel-tasks", { element: "#panel" });

    await s.saving(() => page.click('#panel [data-tab="bring"]'));
    assert.ok((await page.locator("#panel .bl").count()) > 0, "the Bring list has items");
    await s.screenshot("panel-bring", { element: "#panel" });
    await s.saving(() => page.click('#panel [data-tab="tasks"]'));

    await page.click("#settings");
    await page.waitForSelector(".modal #sSave");
    await s.screenshot("settings");
    await page.click("#sClose");

    await page.click(`#panel .task[data-part="${revision.id}:*"] .trow`);
    await page.waitForSelector("#pop h3");
    await s.screenshot("map-selected-task");
  });
});

test("at phone width the picker and the map come up (screenshots in record mode)", async (t) => {
  const dataDir = path.join(os.tmpdir(), "stm-e2e-screens-phone");
  await withScenario(t, { phone: true, state: readFixture("rich-v2-state.json"), dataDir }, async (s) => {
    const page = s.page;
    await s.openPicker();
    await waitForMapThumbnails(page);
    await s.screenshot("phone-picker");

    await page.tap('.picker .card[href="#/map/streets-of-tarkov"]');
    await s.waitForMap("streets-of-tarkov");
    await s.screenshot("phone-map");
    await s.screenshot("phone-map-full-page", { fullPage: true });
  });
});
