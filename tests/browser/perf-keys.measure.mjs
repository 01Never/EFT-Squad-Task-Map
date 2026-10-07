// Ticket 09 performance measurement (not part of the suite: its name doesn't end in .e2e.mjs).
// Streets with every task active, 1600×900: 2 rounds of a 120-step pan and a 40-notch zoom in and
// out, with key doors off and with "All locked doors" on (every lock on Streets). Prints the frame
// interval (mean / p95, ms), layout time per frame and the door markers drawn. Same method as
// ticket 08's loot measurement. Run:
//   STM_E2E_EDGE=... node --test --test-global-setup=tests/browser/global-setup.js tests/browser/perf-keys.measure.mjs
import { test, before, after } from "node:test";
import { browserSuite, withScenario, stateWithEveryTask, startRealDataMock, sleep } from "./harness.js";

browserSuite();

let realDataMock = null;
before(async () => {
  realDataMock = await startRealDataMock();
});
after(async () => {
  await realDataMock?.stop();
});

/** Frame intervals and layout time while `gesture` runs. */
async function measureFrames(s, gesture) {
  const client = await s.page.context().newCDPSession(s.page);
  await client.send("Performance.enable");
  const before = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map((metric) => [metric.name, metric.value]));
  await s.page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = (now) => {
      window.__frames.push(now - last);
      last = now;
      if (window.__measuring) requestAnimationFrame(tick);
    };
    window.__measuring = true;
    requestAnimationFrame(tick);
  });
  await gesture();
  const frames = await s.page.evaluate(() => {
    window.__measuring = false;
    return window.__frames.slice(1);
  });
  const afterMetrics = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map((metric) => [metric.name, metric.value]));
  const layoutMs = (afterMetrics.LayoutDuration - before.LayoutDuration + afterMetrics.RecalcStyleDuration - before.RecalcStyleDuration) * 1000;
  const sorted = [...frames].sort((a, b) => a - b);
  const mean = frames.reduce((sum, frame) => sum + frame, 0) / frames.length;
  return { mean: +mean.toFixed(1), p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), layoutPerFrame: +(layoutMs / frames.length).toFixed(2), frames: frames.length };
}

async function panRounds(s) {
  const box = await s.page.locator("#stage").boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  for (let round = 0; round < 2; round++) {
    await s.page.mouse.move(x, y);
    await s.page.mouse.down();
    for (let step = 1; step <= 120; step++) {
      const angle = (step / 120) * Math.PI * 2;
      await s.page.mouse.move(x + Math.cos(angle) * 200 - 200, y + Math.sin(angle) * 120);
    }
    await s.page.mouse.up();
    await sleep(300);
  }
}

async function zoomRounds(s) {
  const box = await s.page.locator("#stage").boundingBox();
  await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let round = 0; round < 2; round++) {
    for (let notch = 0; notch < 20; notch++) {
      await s.page.mouse.wheel(0, -100);
      await sleep(16);
    }
    for (let notch = 0; notch < 20; notch++) {
      await s.page.mouse.wheel(0, 100);
      await sleep(16);
    }
    await sleep(300);
  }
}

for (const withDoors of [false, true, false, true]) {
  test(`Streets, every task active, doors ${withDoors ? "all shown" : "off"}`, { timeout: 120_000 }, async (t) => {
    await withScenario(t, { state: stateWithEveryTask(), env: { STM_JSON_BASE: realDataMock.base } }, async (s) => {
      await s.openMap("streets-of-tarkov");
      await s.page.waitForFunction(() => document.querySelectorAll("svg.map g.mk").length > 0);
      if (withDoors) {
        await s.page.click("[data-keys-section] summary");
        await s.page.click('[data-act="keysalldoors"]');
        await s.page.waitForFunction(() => document.querySelectorAll("svg.map g.kd").length > 0);
      }
      await sleep(1500);
      const doors = await s.page.locator("svg.map g.kd").count();
      const pan = await measureFrames(s, () => panRounds(s));
      const zoom = await measureFrames(s, () => zoomRounds(s));
      t.diagnostic(JSON.stringify({ withDoors, doors, pan, zoom }));
    });
  });
}
