// Lightness (HANDOFF §7): the only continuous animations, the selection flash and the find-me
// pulse, run on the compositor. A Chrome trace must show no main-thread Paint or Layout while
// they run.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  browserSuite, withScenario, readFixture, stateWithTasks, taskNamed, middleOfExtracts, mainThreadRenderingWork, sleep,
} from "./harness.js";

browserSuite();

const revision = taskNamed("Revision - Streets of Tarkov");
const TRACE_MS = 3000;

test("the trace sees main-thread paints when the map really moves (so a zero below means something)", async (t) => {
  await withScenario(t, { state: stateWithTasks([revision.name]) }, async (s) => {
    await s.openMap("streets-of-tarkov");
    const work = await mainThreadRenderingWork(s.page, async () => {
      for (let i = 0; i < 3; i++) {
        await s.page.click("#zin");
        await s.nextFrame();
      }
      await sleep(300);
    });
    t.diagnostic(`zooming: ${JSON.stringify(work)}`);
    assert.ok(work.Paint > 0, "zooming the map paints");
  });
});

test("the selection flash causes no main-thread paint or layout", async (t) => {
  await withScenario(t, { state: stateWithTasks([revision.name, "Glory to CPSU", "Ballet Lover", "Dandies"]) }, async (s) => {
    const page = s.page;
    await s.openMap("streets-of-tarkov");
    await page.click(`#panel .task[data-part="${revision.id}:*"] .trow`);
    await page.waitForSelector("#fx .ping", { state: "attached" }); // 0×0 boxes: never "visible"
    await page.mouse.move(1, 1); // no hover changes during the trace
    await sleep(1000);
    const work = await mainThreadRenderingWork(page, TRACE_MS);
    t.diagnostic(`selection flash: ${JSON.stringify(work)}`);
    assert.equal(await page.locator("#fx .ping").count(), revision.objs.length, "the flash ran during the trace");
    assert.equal(work.Paint, 0, "no main-thread Paint");
    assert.equal(work.Layout, 0, "no main-thread Layout");
  });
});

test("the find-me pulse causes no main-thread paint or layout", async (t) => {
  await withScenario(t, { state: readFixture("fresh-v2-state.json") }, async (s) => {
    const page = s.page;
    await s.openMap("customs");
    await page.mouse.move(1, 1);
    const middle = middleOfExtracts("customs");
    await s.dropGpsAndWait(middle.x, 1, middle.z);
    await sleep(1000);
    const work = await mainThreadRenderingWork(page, TRACE_MS);
    t.diagnostic(`find-me pulse: ${JSON.stringify(work)}`);
    assert.equal(await page.locator(".findme-ring").count(), 3, "the pulse ran during the trace");
    assert.equal(work.Paint, 0, "no main-thread Paint");
    assert.equal(work.Layout, 0, "no main-thread Layout");
  });
});
