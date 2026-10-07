// Ticket 07: item icons as task markers. Icons come from the mock's stand-in for assets.tarkov.dev
// through the app's icon cache (/icons/<id>.webp). STM_E2E_SHOTS=<dir> also saves screenshots there.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  browserSuite, withScenario, stateWithTasks, stateWithEveryTask, taskNamed, MOCK_PORT, MS2000_MARKER_ID, mainThreadRenderingWork, sleep,
} from "./harness.js";

browserSuite();

const SHOTS_DIR = process.env.STM_E2E_SHOTS || "";
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const aFuelMatter = taskNamed("A Fuel Matter");
const dandies = taskNamed("Dandies");

async function mockIconsMissing(ids) {
  await fetch(MOCK + "/icons-missing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
}

/** Per marker: the icon address it shows (or null for a shape) and whether the picture has loaded. */
function iconMarkers(page) {
  return page.$$eval("svg.map g.mk", (markers) => markers.map((marker) => {
    const image = marker.querySelector("image");
    return {
      href: image ? image.getAttribute("href") : null,
      hasShape: !!marker.querySelector(":scope > path, :scope > g > path"),
      plus: !!marker.querySelector("circle[r='3.4']"),
    };
  }));
}

async function shot(page, name) {
  if (!SHOTS_DIR) return;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.mouse.move(1, 1);
  await page.screenshot({ path: path.join(SHOTS_DIR, name + ".png"), animations: "disabled", scale: "css" });
}

test("A Fuel Matter on Reserve shows the MS2000 icon on its mark spots", async (t) => {
  await mockIconsMissing([]);
  await withScenario(t, { state: stateWithTasks([aFuelMatter.name]) }, async (s) => {
    await s.openMap("reserve");
    await s.page.waitForSelector("svg.map g.mk image");
    const markers = await iconMarkers(s.page);
    const markSpots = aFuelMatter.objs.filter((objective) => objective.type === "mark").reduce((sum, objective) => sum + objective.zones.filter((zone) => zone.m === "reserve").length, 0);
    assert.ok(markSpots > 0);
    assert.equal(markers.filter((marker) => marker.href === `/icons/${MS2000_MARKER_ID}.webp`).length, markSpots, "one MS2000 icon per mark spot");
    // The picture loaded through the app (not assets.tarkov.dev) and the app asked the mock once.
    const log = await (await fetch(MOCK + "/icons-log")).json();
    assert.deepEqual(log, [MS2000_MARKER_ID]);
    await s.page.waitForFunction(() => [...document.querySelectorAll("svg.map g.mk image")].every((image) => image.getBoundingClientRect().width > 0));
    await shot(s.page, "reserve-a-fuel-matter");
  });
});

test("Dandies on Streets shows the stashed items' icons", async (t) => {
  await mockIconsMissing([]);
  await withScenario(t, { state: stateWithTasks([dandies.name]) }, async (s) => {
    await s.openMap("streets-of-tarkov");
    await s.page.waitForSelector("svg.map g.mk image");
    const plantIds = dandies.objs.filter((objective) => objective.type === "plantItem").map((objective) => objective.items[0].id);
    const markers = await iconMarkers(s.page);
    for (const id of plantIds) assert.ok(markers.some((marker) => marker.href === `/icons/${id}.webp`), `the icon of ${id}`);
    await shot(s.page, "streets-dandies");
  });
});

test("with no icons available the markers silently keep their shapes", async (t) => {
  await mockIconsMissing([MS2000_MARKER_ID]);
  await withScenario(t, { state: stateWithTasks([aFuelMatter.name]) }, async (s) => {
    await s.openMap("reserve");
    await s.page.waitForFunction(() => document.querySelectorAll("svg.map g.mk").length > 0);
    await sleep(1000); // the 404 arrives and the tile is swapped
    const markers = await iconMarkers(s.page);
    assert.ok(markers.length > 0);
    assert.ok(markers.every((marker) => marker.href === null && marker.hasShape), "every marker is a shape again, with no <image> left");
    // A redraw (zoom) goes straight to the shapes.
    await s.page.click("#zin");
    await s.nextFrame();
    assert.equal(await s.page.locator("svg.map g.mk image").count(), 0);
    await shot(s.page, "reserve-no-icons-fallback");
  });
  await mockIconsMissing([]);
});

test("Settings → Task markers: shapes only turns icons off, and it is saved", async (t) => {
  await mockIconsMissing([]);
  await withScenario(t, { state: stateWithTasks([aFuelMatter.name]) }, async (s) => {
    await s.openMap("reserve");
    await s.page.waitForSelector("svg.map g.mk image");
    await s.page.click("#settings");
    await s.page.selectOption("#sMarkers", "shapes");
    await s.saving(() => s.page.click("#sSave"));
    await s.waitForToast("Settings saved");
    assert.equal(s.savedState().taskIcons, false);
    assert.equal(await s.page.locator("svg.map g.mk image").count(), 0);
    assert.ok((await s.page.locator("svg.map g.mk").count()) > 0);
  });
});

test("a plant with alternatives shows a + on its tile", async (t) => {
  await mockIconsMissing([]);
  const breakTheDeal = taskNamed("Break the Deal");
  await withScenario(t, { state: stateWithTasks([breakTheDeal.name]) }, async (s) => {
    await s.openMap("customs");
    await s.page.waitForSelector("svg.map g.mk image");
    const markers = await iconMarkers(s.page);
    assert.ok(markers.some((marker) => marker.plus), "a + badge");
  });
});

test("about 40 icon markers on Streets: panning and zooming stay as light as with shapes", async (t) => {
  await mockIconsMissing([]);
  const measure = async (settings) => {
    let result;
    await withScenario(t, { state: { ...stateWithEveryTask(), taskIcons: settings } }, async (s) => {
      await s.openMap("streets-of-tarkov");
      await s.page.waitForFunction(() => document.querySelectorAll("svg.map g.mk").length > 0);
      await sleep(1500);
      const icons = await s.page.locator("svg.map g.mk image").count();
      await s.page.evaluate(() => {
        window.__frames = [];
        let last = performance.now();
        const tick = (now) => { window.__frames.push(now - last); last = now; if (window.__measuring) requestAnimationFrame(tick); };
        window.__measuring = true;
        requestAnimationFrame(tick);
      });
      const work = await mainThreadRenderingWork(s.page, async () => {
        for (let i = 0; i < 4; i++) { await s.page.click("#zin"); await s.nextFrame(); await s.dragMap(60, 30); }
        for (let i = 0; i < 4; i++) { await s.page.click("#zout"); await s.nextFrame(); await s.dragMap(-60, -30); }
        await sleep(300);
      });
      const frames = await s.page.evaluate(() => { window.__measuring = false; return window.__frames; });
      frames.sort((a, b) => a - b);
      result = { icons, markers: await s.page.locator("svg.map g.mk").count(), frames: frames.length, p50: frames[Math.floor(frames.length / 2)], p95: frames[Math.floor(frames.length * 0.95)], ...work };
    });
    return result;
  };
  const withShapes = await measure(false);
  const withIcons = await measure(true);
  t.diagnostic(`shapes ${JSON.stringify(withShapes)}`);
  t.diagnostic(`icons  ${JSON.stringify(withIcons)}`);
  assert.ok(withIcons.icons >= 5, "the busy map has icon markers");
  assert.equal(withShapes.icons, 0);
  assert.ok(withIcons.p95 <= withShapes.p95 * 1.5 + 8, "icons don't make frames noticeably slower");
});
