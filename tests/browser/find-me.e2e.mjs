// Your position on the map (tickets 01–03): the marker, the pulse, the off-screen chip, Find me,
// Follow (auto-center) and the closest extract.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  browserSuite, withScenario, readFixture, stateWithEveryTask, middleOfExtracts, mapData,
} from "./harness.js";

browserSuite();

const LOG_WAIT = { timeout: 15_000 };
const isCentred = (offset) => !!offset && Math.abs(offset.dx) < 3 && Math.abs(offset.dy) < 3;
const sameNumber = (a, b) => Math.abs(a - b) < 1e-6;

test("Find me: a new position pulses for about 6 s, the off-screen chip brings you back, and Find me keeps the zoom", async (t) => {
  await withScenario(t, { state: stateWithEveryTask() }, async (s) => {
    const page = s.page;
    const ringCount = () => page.locator(".findme-ring").count();
    const chipHidden = () => page.isHidden("#findme-chip");
    await s.openMap("customs");
    assert.equal(await page.isDisabled("#bfindme"), true, "Find me waits for a position");
    assert.equal(await page.getAttribute("#bfindme", "title"), "No position yet. In a raid, press your screenshot key.");

    const middle = middleOfExtracts("customs");
    await s.dropGpsAndWait(middle.x, 1, middle.z);
    const pulseSeenAt = Date.now();
    assert.equal(await ringCount(), 3, "a new position starts 3 pulse rings");
    assert.equal(await page.isDisabled("#bfindme"), false);
    assert.equal(await page.getAttribute("#bfindme", "title"), "Centre the map on you (keeps your zoom)");
    assert.equal(await page.isVisible("#gpsbar"), true);
    assert.equal(await page.locator("svg.map g[data-r]").count(), 1, "your marker");

    await page.waitForFunction(() => document.querySelectorAll(".findme-ring").length === 0, null, { timeout: 25_000, polling: 250 });
    const lasted = Date.now() - pulseSeenAt;
    assert.ok(lasted > 5_000 && lasted < 7_500, `the pulse ends by itself after about 6 s (${lasted} ms)`);

    // Pan away: the chip points at you; clicking it centres on you without changing the zoom.
    for (let i = 0; i < 4; i++) await page.click("#zin");
    await s.nextFrame();
    await s.dragMap(-650, -350);
    assert.equal(await chipHidden(), false, "panning you out of view shows the chip");
    assert.match(await page.textContent("#findme-chip"), /You · /);
    const zoomBeforeChip = (await s.viewBox()).w;
    await page.click("#findme-chip");
    await s.nextFrame();
    assert.equal(await chipHidden(), true, "the chip brings you into view");
    assert.ok(sameNumber((await s.viewBox()).w, zoomBeforeChip), "and keeps the zoom");
    assert.ok(isCentred(await s.playerOffset()), "centred on you");
    assert.equal(await ringCount(), 0, "the chip doesn't pulse");

    // Find me, with a task selected (its flash and the pulse together).
    await page.click("#panel .task .trow");
    await page.waitForSelector("#panel .task.sel");
    await s.dragMap(500, 300);
    const zoomBeforeFindMe = (await s.viewBox()).w;
    await page.click("#bfindme");
    await s.nextFrame();
    assert.ok(sameNumber((await s.viewBox()).w, zoomBeforeFindMe), "Find me keeps the zoom");
    assert.equal(await ringCount(), 3, "Find me pulses");
    assert.equal(await chipHidden(), true);
    assert.ok(isCentred(await s.playerOffset()));
    assert.equal(await page.locator("#panel .task.sel").count(), 1, "the task stays selected");

    // The position bar's Show does the same.
    await s.dragMap(-600, 0);
    assert.equal(await chipHidden(), false);
    await page.click("#gpsgo");
    await s.nextFrame();
    assert.equal(await chipHidden(), true, "Show centres on you");
    assert.ok(isCentred(await s.playerOffset()));
  });
});

test("Follow (auto-center) keeps your zoom: off, only an off-screen position moves the map; on, every position is centred, after any drag", async (t) => {
  await withScenario(t, { state: readFixture("fresh-v2-state.json") }, async (s) => {
    const page = s.page;
    await s.openMap("customs");
    assert.equal(await page.getAttribute("#bfollow", "aria-pressed"), "false", "Follow starts off");
    const middle = middleOfExtracts("customs");

    // Off: an on-screen position leaves the map alone.
    await s.dropGpsAndWait(middle.x, 1, middle.z);
    for (let i = 0; i < 3; i++) await page.click("#zin");
    await s.nextFrame();
    await page.click("#bfindme");
    await s.nextFrame();
    const before = await s.viewBox();
    await s.dropGpsAndWait(middle.x + 15, 1, middle.z + 10);
    const after = await s.viewBox();
    assert.ok(sameNumber(before.x, after.x) && sameNumber(before.y, after.y) && sameNumber(before.w, after.w), "off: an on-screen position leaves the map alone");

    // Off (with Follow my position on, the default): an off-screen position is brought into view.
    await s.dropGpsAndWait(middle.x + 400, 1, middle.z + 300);
    assert.ok(sameNumber((await s.viewBox()).w, before.w), "off: the zoom stays");
    assert.ok(isCentred(await s.playerOffset()), "off: an off-screen position is centred");

    // On: every position is centred at the same zoom.
    await s.answered("PUT", "/api/settings", () => page.click("#bfollow"));
    await s.waitForToast("Following you");
    assert.equal(await page.getAttribute("#bfollow", "aria-pressed"), "true");
    const zoom = (await s.viewBox()).w;
    for (const [dx, dz] of [[60, -40], [-120, 80], [200, 150]]) {
      await s.dropGpsAndWait(middle.x + dx, 1, middle.z + dz);
      assert.ok(isCentred(await s.playerOffset()), `on: the position (${dx}, ${dz}) is centred`);
      assert.ok(sameNumber((await s.viewBox()).w, zoom), "on: the zoom never changes");
    }

    // A position during a drag waits until the mouse is released.
    await s.dragMap(300, 150, { release: false });
    const during = await s.viewBox();
    await s.dropGpsAndWait(middle.x - 60, 1, middle.z - 60);
    const stillDragging = await s.viewBox();
    assert.ok(sameNumber(during.x, stillDragging.x) && sameNumber(during.y, stillDragging.y), "a position during a drag doesn't move the map yet");
    await page.mouse.up();
    await s.nextFrame();
    assert.ok(isCentred(await s.playerOffset()), "after letting go, the map centres on it");

    // The toolbar and Settings are the same setting, also after a reload.
    await s.reload();
    await s.waitForMap("customs");
    assert.equal(await page.getAttribute("#bfollow", "aria-pressed"), "true", "still on after a reload");
    await page.click("#settings");
    await page.waitForSelector(".modal #sCenter");
    assert.equal(await page.isChecked("#sCenter"), true, "Settings shows the same");
    await page.uncheck("#sCenter");
    await s.answered("PUT", "/api/settings", () => page.click("#sSave"));
    await s.waitForToast("Settings saved");
    assert.equal(await page.getAttribute("#bfollow", "aria-pressed"), "false", "turning it off in Settings updates the toolbar");
    assert.equal((await s.status()).settings.autoCenter, false);
  });
});

test("the closest extract is shown: among the shown ones, then only marked ones, transits only when marked, and raid end clears it", async (t) => {
  const customs = mapData("customs");
  const kindOf = (extract) => (extract.fa === "scav" ? "scav" : extract.fa === "pmc" ? "pmc" : "shared");
  const shown = customs.extracts.filter((extract) => kindOf(extract) !== "scav"); // chips start with Scav off
  const closestTo = (x, z, candidates) => candidates.map((extract) => ({ extract, distance: Math.hypot(extract.x - x, extract.z - z) })).sort((a, b) => a.distance - b.distance)[0].extract;
  await withScenario(t, { state: readFixture("fresh-v2-state.json") }, async (s) => {
    const page = s.page;
    const barText = () => page.textContent("#gpsbar-closest");
    const dashedLines = () => page.locator('svg.map polyline[stroke-dasharray="7 5"]').count();
    await s.openMap("customs");
    assert.equal(await barText(), "", "no position: nothing");

    // Three positions, each a few metres from a different shown extract.
    const targets = [shown[0], shown[Math.floor(shown.length / 2)], shown[shown.length - 1]];
    let last = null;
    for (const target of targets) {
      last = { x: target.x + 6, z: target.z - 8 };
      await s.dropGpsAndWait(last.x, 1, last.z);
      const expected = closestTo(last.x, last.z, shown);
      const text = await barText();
      assert.ok(text.includes(expected.n) && text.includes("Closest shown"), `near ${target.n}: "${text}" names ${expected.n}`);
    }
    assert.equal(await dashedLines(), 1, "one dashed line from you to the extract");

    // Marked extracts win, even far away.
    const far = shown.map((extract) => ({ extract, distance: Math.hypot(extract.x - last.x, extract.z - last.z) })).sort((a, b) => b.distance - a.distance)[0].extract;
    await s.saving(() => s.clickExtract(far.n));
    let text = await barText();
    assert.ok(text.includes(far.n) && !text.includes("shown"), `marking ${far.n} makes it the closest: "${text}"`);
    await s.saving(() => s.clickExtract(far.n));
    assert.match(await barText(), /Closest shown/, "unmarking it goes back to the shown extracts");

    // Transits only count when marked.
    const transit = customs.transits[0];
    await s.dropGpsAndWait(transit.x + 2, 1, transit.z + 2);
    assert.ok(!(await barText()).includes(transit.n), `next to ${transit.n}, the unmarked transit isn't picked`);
    await s.saving(() => s.clickExtract(transit.n));
    assert.ok((await barText()).includes(transit.n), "a marked transit counts");

    // Clicking the name centres on the extract at the same zoom.
    const zoom = (await s.viewBox()).w;
    await page.click("#gpsclosest");
    await s.nextFrame();
    assert.ok(sameNumber((await s.viewBox()).w, zoom), "clicking the closest extract keeps the zoom");

    // Raid end clears it.
    s.step("raid starts and ends");
    s.appLog("GameStarted:12.3 real:4.5");
    await page.waitForSelector("#navinfo .raid", LOG_WAIT);
    await s.saving(async () => {
      s.appLog("SelectProfile ProfileId:5f1 AccountId:123");
      await s.waitForToast("Raid over");
    }, LOG_WAIT);
    assert.equal(await barText(), "", "raid end clears the closest extract");
    assert.equal(await dashedLines(), 0, "and its line");
    assert.deepEqual(s.savedState().prefs.customs.extMarked, {});
  });
});
