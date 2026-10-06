// What the game tells the app: log lines (tasks, session mode, raid start and end) and GPS
// screenshots. The app reads the logs every 5 seconds, so these scenarios wait for the page.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  browserSuite, withScenario, readFixture, stateWithTasks, taskNamed, middleOfExtracts, waitUntil, sleep,
  assertMatchesRecorded, MS2000_MARKER_ID, FACING_45_DEGREES, FACING_135_DEGREES,
} from "./harness.js";

browserSuite();

const dandies = taskNamed("Dandies");
const LOG_WAIT = { timeout: 15_000 }; // one 5 s log check, the 500 ms save delay, and some slack

test("game log: a task accepted in-game is added, a finished one is removed, and another mode's session offers to switch data", async (t) => {
  await withScenario(t, { state: readFixture("fresh-v2-state.json"), settings: { gameMode: "pvp-season" } }, async (s) => {
    const page = s.page;
    await s.openMap("streets-of-tarkov");

    // At start-up the game logs "Pve" and then "PvpSeason" (real logs): the last one counts.
    s.step("session mode Pve, then PvpSeason");
    s.appLog("Session mode: Pve");
    s.appLog("Session mode: PvpSeason");
    await waitUntil(async () => (await s.status()).raid.sessionMode === "pvp-season", { ...LOG_WAIT, what: "the app to read the session mode" });
    await sleep(500); // both mode events reach the page right after
    assert.equal(await page.locator("#modeSwitch").count(), 0, "no prompt is left behind");

    s.step("task started in-game");
    await s.saving(async () => {
      s.taskMessage(dandies.id, 10);
      await s.waitForToast("Added from the game: Dandies");
    }, LOG_WAIT);
    let entry = s.savedState().tasks[dandies.id];
    assert.equal(entry.active, true);
    assert.equal(entry.source, "log");
    assert.equal(await page.locator(`#panel .task[data-task="${dandies.id}"]`).count(), 2, "both parts are listed");

    s.step("task finished in-game");
    await s.saving(() => s.taskMessage(dandies.id, 12), LOG_WAIT);
    assert.equal(s.savedState().tasks[dandies.id].active, false, "a finished task is removed quietly");
    assert.equal(await page.locator(`#panel .task[data-task="${dandies.id}"]`).count(), 0);

    // A PvE session: its task events don't touch the PvP Season list, and the page offers to switch.
    s.step("PvE session");
    s.appLog("Session mode: Pve");
    s.taskMessage(dandies.id, 10);
    await page.waitForSelector("#modeSwitch", LOG_WAIT);
    assert.match(await page.textContent("#navinfo .modewarn"), /PvE · Switch data Not now/);
    await sleep(1000); // the task line was read in the same check; give a wrong reaction time to show
    assert.equal(s.savedState().tasks[dandies.id].active, false, "a PvE task event doesn't change the PvP Season list");

    s.step("switch data");
    await s.answered("PUT", "/api/settings", () => page.click("#modeSwitch"));
    await s.waitForToast("Switched to PvE data");
    await waitUntil(async () => {
      const status = await s.status();
      return status.settings.gameMode === "pve" && status.data.mode === "pve" && status.data.origin === "live";
    }, { what: "the PvE data to download" });
    await page.waitForFunction(() => document.querySelector("#navinfo .dd")?.textContent === "PvE data");
    assert.equal(await page.locator("#modeSwitch").count(), 0);
    assert.equal(s.savedSettings().gameMode, "pve");
  });
});

test("a GPS screenshot draws your arrow; raid end resets bag counts and extract marks and deletes that raid's GPS screenshots", async (t) => {
  const state = stateWithTasks([dandies.name]);
  state.have = { [MS2000_MARKER_ID]: 3, "5a0ee30786f774023b6ee08f": 1 };
  state.used = {};
  state.prefs["streets-of-tarkov"] = { ext: { pmc: true, scav: false, shared: true, transit: true }, extMarked: { "Crash Site": true }, labels: true, drawOn: true };
  state.prefs.customs = { ext: { pmc: true, scav: false, shared: true, transit: true }, extMarked: { "Crossroads": true }, labels: true, drawOn: true };
  await withScenario(t, { state }, async (s) => {
    const page = s.page;
    await s.openMap("streets-of-tarkov");
    assert.equal(await page.locator("svg.map g.ex.on").count(), 1);

    s.step("raid starts on Streets");
    s.appLog("scene preset path:maps/city_preset.bundle rcid:x");
    s.appLog("GameStarted:12.3 real:4.5");
    await page.waitForSelector("#navinfo .raid", LOG_WAIT);
    assert.equal(await page.textContent("#navinfo .raid"), "● In raid: Streets of Tarkov");

    s.step("two GPS screenshots");
    const config = (await s.api("/api/config")).find((map) => map.key === "streets-of-tarkov");
    // The arrow turns by the game's heading plus the map's rotation (+180° more for maps turned 90°/270°).
    const expectedTurn = (yaw) => {
      let add = config.rotation || 0;
      if (add === 90 || add === 270) add += 180;
      return (yaw + add).toFixed(1);
    };
    const middle = middleOfExtracts("streets-of-tarkov");
    await s.dropGpsAndWait(middle.x, 1.5, middle.z, FACING_45_DEGREES);
    const first = (await s.status()).gps;
    assert.equal(first.map, "streets-of-tarkov");
    const firstTurn = await page.getAttribute("svg.map g[data-r]", "data-r");
    assert.equal(firstTurn, expectedTurn(first.yaw));
    assert.equal(await page.isVisible("#gpsbar"), true);
    assert.match(await page.textContent("#gpsbar-you"), /^📍 You.* · just now Show$/);
    assert.ok(await page.$$eval("svg.map text", (texts) => texts.some((text) => text.textContent === "You")), "the “You” label");

    await s.dropGpsAndWait(middle.x + 30, 1.5, middle.z - 20, FACING_135_DEGREES);
    const second = (await s.status()).gps;
    const secondTurn = await page.getAttribute("svg.map g[data-r]", "data-r");
    assert.equal(secondTurn, expectedTurn(second.yaw));
    assert.equal(((Number(secondTurn) - Number(firstTurn)) % 360 + 360) % 360, 90, "turning 90° in the game turns the arrow 90°");
    assertMatchesRecorded("gps-arrow-streets", { first: firstTurn, second: secondTurn });
    assert.equal(s.screenshotFiles().length, 2);

    s.step("raid ends");
    await s.saving(async () => {
      s.appLog("PrepareSelectedProfileLocally ProfileId:0 AccountId:1");
      await s.waitForToast("Raid over: bag counts and extract marks reset, 2 GPS screenshots deleted");
    }, LOG_WAIT);
    const saved = s.savedState();
    assert.deepEqual(saved.have, {}, "bag counts reset");
    assert.deepEqual(saved.used, {});
    assert.deepEqual(saved.prefs["streets-of-tarkov"].extMarked, {}, "extract marks reset");
    assert.deepEqual(saved.prefs.customs.extMarked, {}, "on every map");
    assert.deepEqual(s.screenshotFiles(), [], "that raid's GPS screenshots are deleted");
    assert.equal(await page.isHidden("#gpsbar"), true);
    assert.equal(await page.locator("svg.map g[data-r]").count(), 0, "your marker is gone");
    assert.equal(await page.locator("#navinfo .raid").count(), 0);
    assert.equal(await page.locator("svg.map g.ex.on").count(), 0);
  });
});
