// Ticket 09: My keys. Against the second mock serving the real json.tarkov.dev files (they have the
// locks), like loot.e2e.mjs. Covers the ticket's acceptance checks: 3 keys on Customs light their
// doors (reload and raid end keep them), a task needing one is ready without bag counts, All
// locked doors dims the rest, remove + Undo, copying to another map keeps only keys that matter,
// the door popup's tasks and nearby loot on two known doors, the raid-start reminder, squad key
// sharing (two copies on the dev transport), and no rendering work while idle on Streets with
// every door shown. STM_E2E_SHOTS=<dir> also saves screenshots there.
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { test, before, after } from "node:test";
import { gunzipSync } from "node:zlib";
import { browserSuite, withScenario, Scenario, readFixture, taskEntry, startRealDataMock, mainThreadRenderingWork, waitUntil, REPO_ROOT } from "./harness.js";

browserSuite();

const LOG_WAIT = { timeout: 15_000 }; // one 5 s log check, the 500 ms save delay, and some slack
const SHOTS_DIR = process.env.STM_E2E_SHOTS || "";

// Real ids (2026-10-05 json.tarkov.dev files).
const DORM_114 = "59387a4986f77401cc236e62"; // ground floor; Pharmacist needs it
const DORM_314_MARKED = "5780cf7f2459777de4559322";
const USEC_STASH = "5da743f586f7744014504f72"; // 2 doors on Customs
const COTTAGE_SAFE = "61aa5ba8018e9821b7368da9"; // USEC cottage second safe key: Lighthouse and Streets
const PLACEHOLDER = "5448ba0b4bdc2d02308b456c";

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
const realTasks = readGolden("data-real.json.gz").tasks;
const realLoot = readGolden("loot-real.json.gz");
const realTask = (name) => realTasks.find((task) => task.name === name);
const pharmacist = realTask("Pharmacist");
const goldenSwag = realTask("Golden Swag");

/** Saved data with Pharmacist and Golden Swag active, and the extra fields given. */
function stateWithKeyTasks(extra = {}) {
  const state = readFixture("fresh-v2-state.json");
  for (const task of [pharmacist, goldenSwag]) state.tasks[task.id] = taskEntry();
  return { ...state, ...extra };
}

const doors = (page, selector = "") => page.locator(`svg.map g.kd${selector}`).count();
const notReady = (page, taskId) => page.locator(`#panel .task[data-task="${taskId}"] .bang`).count();

async function shot(page, name) {
  if (!SHOTS_DIR) return;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.screenshot({ path: path.join(SHOTS_DIR, name + ".png"), animations: "disabled" });
}

/** Opens My keys (if closed) and adds a key by typing its name and clicking the result. */
async function addKey(s, search, keyId) {
  if (!(await s.page.$eval("[data-keys-section]", (section) => section.open))) {
    await s.page.click("[data-keys-section] summary");
  }
  await s.page.fill("#keysearch", search);
  await s.page.waitForSelector(`#keyresults [data-key-add="${keyId}"]`);
  await s.saving(() => s.page.click(`#keyresults [data-key-add="${keyId}"]`));
}

/** The centre of a drawn door marker for this key, if it's on screen and on top. */
function doorOnScreen(page, keyId) {
  return page.evaluate((id) => {
    for (const marker of document.querySelectorAll(`svg.map g.kd[data-key="${id}"]`)) {
      const box = marker.getBoundingClientRect();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      if (document.elementFromPoint(x, y)?.closest(".kd") === marker) return { x, y };
    }
    return null;
  }, keyId);
}

/** Zooms in on a key's door with the mouse wheel until nothing else covers it; its centre. */
async function zoomToDoor(page, keyId) {
  for (let notch = 0; notch < 30; notch++) {
    const onTop = await doorOnScreen(page, keyId);
    if (onTop && notch >= 6) return onTop;
    const box = await page.locator(`svg.map g.kd[data-key="${keyId}"]`).first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(300); // the redraw after the view settles
  return doorOnScreen(page, keyId);
}

test("My keys on Customs: doors light up, tasks are ready, it all stays after reload and raid end", { timeout: 180_000 }, async (t) => {
  await withScenario(t, { state: stateWithKeyTasks(), env: { STM_JSON_BASE: realDataMock.base } }, async (s) => {
    s.step("open Customs: no key list, no doors, nothing loaded for keys");
    await s.openMap("customs");
    assert.equal(await doors(s.page), 0);
    assert.ok(!s.requests.some((line) => line.includes("/api/loot/")), "no locks loaded until they're needed");
    assert.equal((await s.page.textContent("[data-keys-section] summary")).trim(), "My keys (0)");
    assert.equal(await notReady(s.page, pharmacist.id), 1, "Pharmacist needs the Dorm room 114 key");
    assert.equal("keyring" in s.savedState(), false, "no key list in the file yet");

    s.step("add 3 keys");
    await s.answered("GET", "/api/loot/customs", () => s.page.click("[data-keys-section] summary"));
    await addKey(s, "114", DORM_114);
    await addKey(s, "314 marked", DORM_314_MARKED);
    await s.page.fill("#keysearch", "usec stash");
    await s.page.waitForSelector(`#keyresults [data-key-add="${USEC_STASH}"]`);
    await s.saving(() => s.page.press("#keysearch", "Enter"));
    assert.deepEqual(s.savedState().keyring, { customs: [DORM_114, DORM_314_MARKED, USEC_STASH] });
    assert.equal((await s.page.textContent("[data-keys-section] summary")).trim(), "My keys (3)");
    assert.deepEqual(await s.page.$$eval(".key-row .key-opens", (cells) => cells.map((cell) => cell.textContent.trim())), ["1 door", "1 door", "2 doors"]);
    await s.page.waitForFunction(() => document.querySelectorAll("svg.map g.kd").length === 4);
    assert.equal(await doors(s.page, ".kd-dim"), 0, "your doors are fully opaque");
    assert.equal(await notReady(s.page, pharmacist.id), 0, "Pharmacist is ready for the key part");
    assert.deepEqual(s.savedState().have, {}, "without touching the bag counts");
    await shot(s.page, "customs-3-keys-whole-map");

    s.step("the Bring list: On your key list");
    await s.page.click('[data-tab="bring"]');
    assert.equal(await s.page.locator(`.bl[data-key="${DORM_114}"] .onlist`).count(), 1);
    assert.equal(await s.page.locator(`.bl[data-key="${DORM_114}"]`).getAttribute("class"), "bl", "not short");
    await s.saving(() => s.page.click('[data-tab="tasks"]'));

    s.step("the door popup: Dorm room 114 (fly to it from the list)");
    await s.page.click(`[data-key-fly="${DORM_114}"]`);
    await s.page.waitForSelector("#keypop:not([hidden]) h3");
    const popup114 = await s.page.textContent("#keypop");
    assert.match(popup114, /Dorm room 114 key/);
    assert.match(popup114, /Door · ground level/);
    assert.match(popup114, /On your key list ✓/);
    assert.match(popup114, /Pharmacist/);
    assert.match(popup114, /Nearby loot, approximate/);
    assert.deepEqual(await s.page.$$eval("#keypop .kp-loot li", (items) => items.map((item) => item.textContent).sort()), ["1 × Medcase", "1 × PC block", "2 × Loose loot", "2 × Safe"]);
    assert.equal(await s.page.locator("svg.map g.kd-near").count(), 6, "the 6 spots are ringed while the popup is open");
    await shot(s.page, "door-popup-dorm-114");
    await s.page.click("#keypop .x");
    assert.equal(await s.page.locator("svg.map g.kd-near").count(), 0);

    s.step("tap the marked room's door on the map");
    await s.page.click(`[data-key-fly="${DORM_314_MARKED}"]`);
    await s.page.click("#keypop .x");
    const door = await doorOnScreen(s.page, DORM_314_MARKED);
    assert.ok(door, "the marked room's door is on screen");
    await s.page.mouse.click(door.x, door.y);
    await s.page.waitForSelector("#keypop:not([hidden]) h3");
    assert.match(await s.page.textContent("#keypop h3"), /Dorm room 314 marked key/);
    assert.match(await s.page.textContent("#keypop"), /Door · floor 3/);
    assert.deepEqual(await s.page.$$eval("#keypop .kp-loot li", (items) => items.map((item) => item.textContent).sort()), ["1 × PMC body", "4 × Loose loot"]);
    await shot(s.page, "door-popup");
    assert.equal(await s.page.locator(".task.sel").count(), 0, "a door never selects a task");
    await s.page.click("#zfit");

    s.step("reload: still there");
    await s.reload();
    await s.waitForMap("customs");
    await s.page.waitForFunction(() => document.querySelectorAll("svg.map g.kd").length === 4);
    assert.equal(await notReady(s.page, pharmacist.id), 0);

    s.step("raid start on Customs: the reminder, and its button opens the list");
    assert.equal(await s.page.$eval("[data-keys-section]", (section) => section.open), false);
    s.appLog("scene preset path:maps/customs_preset.bundle rcid:x");
    s.appLog("GameStarted:12.3 real:4.5");
    await s.page.waitForFunction(() => /Bring your 3 keys for Customs/.test(document.getElementById("toast").textContent), null, LOG_WAIT);
    await s.page.click("#toastAct");
    assert.equal(await s.page.$eval("[data-keys-section]", (section) => section.open), true);

    s.step("raid end: bag counts reset, the key list stays");
    await s.saving(async () => {
      s.appLog("PrepareSelectedProfileLocally ProfileId:0 AccountId:1");
      await s.waitForToast("Raid over");
    }, LOG_WAIT);
    assert.deepEqual(s.savedState().keyring, { customs: [DORM_114, DORM_314_MARKED, USEC_STASH] });
    assert.equal(await doors(s.page), 4);
    assert.equal(await notReady(s.page, pharmacist.id), 0, "still ready after the raid");

    s.step("All locked doors: the rest, dimmed; the placeholder's doors as unknown");
    await s.page.click('[data-act="keysalldoors"]');
    const lockCount = realLoot.maps.customs.locks.length;
    await s.page.waitForFunction((count) => document.querySelectorAll("svg.map g.kd").length === count, lockCount);
    assert.equal(await doors(s.page, ".kd-dim"), lockCount - 4);
    assert.equal(await doors(s.page, '[data-status="unknown"]'), realLoot.maps.customs.locks.filter((lock) => lock.key === PLACEHOLDER).length);
    assert.equal(await s.page.$eval("svg.map g.kd-dim", (marker) => marker.getAttribute("opacity")), "0.45");
    await shot(s.page, "all-locked-doors");
    await s.page.click('[data-act="keysalldoors"]');
    await s.page.waitForFunction(() => document.querySelectorAll("svg.map g.kd").length === 4);

    s.step("remove a key, then Undo");
    await s.saving(() => s.page.click(`[data-key-remove="${USEC_STASH}"]`));
    assert.equal(await doors(s.page), 2, "its doors are no longer highlighted");
    assert.match(await s.toastText(), /Removed USEC stash key/);
    await s.saving(() => s.page.click("#toastAct"));
    assert.equal(await doors(s.page), 4);
    assert.deepEqual(s.savedState().keyring.customs, [DORM_114, DORM_314_MARKED, USEC_STASH], "back in its place");
  });
});

test("Copy from another map keeps only the keys that matter there", async (t) => {
  const state = stateWithKeyTasks({ keyring: { "streets-of-tarkov": [COTTAGE_SAFE, DORM_114] } });
  await withScenario(t, { state, env: { STM_JSON_BASE: realDataMock.base } }, async (s) => {
    await s.openMap("lighthouse");
    await s.page.click("[data-keys-section] summary");
    await s.page.waitForSelector("[data-keys-copy]");
    await s.saving(() => s.page.selectOption("[data-keys-copy]", "streets-of-tarkov"));
    assert.match(await s.toastText(), /Copied 1 key from Streets of Tarkov · 1 opens nothing here, left out/);
    assert.deepEqual(s.savedState().keyring, { "streets-of-tarkov": [COTTAGE_SAFE, DORM_114], lighthouse: [COTTAGE_SAFE] });
    await s.saving(() => s.page.click("#toastAct"));
    assert.deepEqual(s.savedState().keyring, { "streets-of-tarkov": [COTTAGE_SAFE, DORM_114] }, "Undo");
  });
});

test("Streets with every door shown: no rendering work while the page is idle", async (t) => {
  await withScenario(t, { state: readFixture("fresh-v2-state.json"), env: { STM_JSON_BASE: realDataMock.base } }, async (s) => {
    await s.openMap("streets-of-tarkov");
    await s.page.click("[data-keys-section] summary");
    await s.page.click('[data-act="keysalldoors"]');
    await s.page.waitForFunction(() => document.querySelectorAll("svg.map g.kd").length > 0);
    assert.equal(await doors(s.page), realLoot.maps["streets-of-tarkov"].locks.length, "every lock on Streets is drawn at the whole-map view");
    await s.dragMap(-200, 120);
    await s.page.waitForTimeout(400); // the redraw after the view settles
    const idle = await mainThreadRenderingWork(s.page, 3000);
    assert.equal(idle.Paint, 0, "no paints while idle");
    assert.equal(idle.Layout, 0, "no layouts while idle");
  });
});

// ---------------------------------------------------------------- squad (ticket 05 + 09)

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {net.AddressInfo} */ (probe.address());
      probe.close(() => resolve(port));
    });
  });
}

async function joinSquad(scenario, name) {
  await scenario.page.click("#settings");
  await scenario.page.waitForSelector("#sSquad");
  await scenario.page.fill("#sSquadKey", "tskey-auth-dev-test");
  await scenario.page.click("#sSquadJoin");
  await scenario.page.waitForSelector("#sSquadName", { timeout: 30_000 });
  await scenario.page.fill("#sSquadName", name);
  await scenario.answered("PUT", "/api/squad/profile", () => scenario.page.press("#sSquadName", "Tab"));
  await scenario.page.click("#sClose");
}

const eventually = (check, what, timeout = 10_000) => waitUntil(check, { timeout, interval: 100, what });

test("squad: with Share my keys on, a friend's key shows on the door, in its popup and on the task", { timeout: 180_000 }, async () => {
  const [alicePort, bobPort] = [await freePort(), await freePort()];
  const squadEnv = (own, other) => ({ STM_JSON_BASE: realDataMock.base, STM_SQUAD_DEV_LISTEN: `127.0.0.1:${own}`, STM_SQUAD_DEV_PEERS: `127.0.0.1:${other}` });
  const alice = new Scenario("keys--squad-alice", { state: stateWithKeyTasks(), env: squadEnv(alicePort, bobPort) });
  const bob = new Scenario("keys--squad-bob", { state: readFixture("fresh-v2-state.json"), env: squadEnv(bobPort, alicePort) });
  try {
    for (const player of [alice, bob]) {
      await player.start();
      await player.openMap("customs");
    }
    await joinSquad(alice, "Alice");
    await joinSquad(bob, "Bob");
    await eventually(async () => (await alice.page.locator(".squad-chip").count()) === 1, "Alice sees Bob");

    // Bob adds the Dorm room 114 key; he doesn't share keys yet, so Alice sees nothing of it
    await addKey(bob, "114", DORM_114);
    await new Promise((resolve) => setTimeout(resolve, 2500)); // a share would have arrived by now
    assert.equal(await doors(alice.page), 0, "no friend doors while Bob doesn't share keys");
    const bobShare = (await alice.api("/api/squad")).friends[0].share;
    assert.equal(bobShare.keys, null, "the server never sends keys while sharing is off");

    // Bob switches Share my keys on
    await bob.page.click("#settings");
    await bob.page.waitForSelector("#sSquadShareKeys");
    await bob.answered("PUT", "/api/squad/share", () => bob.page.check("#sSquadShareKeys"));
    await bob.page.click("#sClose");
    await eventually(async () => (await doors(alice.page)) === 1, "Alice sees the door Bob can open");
    assert.equal(await doors(alice.page, ".kd-dim"), 1, "dimmed: Alice has no key for it");
    assert.equal(await alice.page.locator("svg.map g.kd circle.kd-friend").count(), 1, "with Bob's dot");

    // the popup: "Bob has this key"
    await alice.page.click("[data-keys-section] summary");
    const door = await zoomToDoor(alice.page, DORM_114);
    assert.ok(door);
    await alice.page.mouse.click(door.x, door.y);
    await alice.page.waitForSelector("#keypop:not([hidden]) .kp-friend");
    assert.equal((await alice.page.textContent("#keypop .kp-friend")).trim(), "Bob has this key");
    await shot(alice.page, "squad-friend-key-popup");

    // the task's key requirement: "Bob has it"
    await alice.page.click(`#panel .task[data-task="${pharmacist.id}"] .trow`);
    await alice.page.waitForSelector(`#panel .task[data-task="${pharmacist.id}"] .tag.key .friendkey`);
    assert.equal((await alice.page.textContent(`#panel .task[data-task="${pharmacist.id}"] .tag.key .friendkey`)).trim(), "Bob has it");

    // Bob switches it off again: gone from Alice's map
    await bob.page.click("#settings");
    await bob.answered("PUT", "/api/squad/profile", () => bob.page.uncheck("#sSquadShareKeys"));
    await bob.page.click("#sClose");
    await eventually(async () => (await alice.page.locator("svg.map g.kd circle.kd-friend").count()) === 0, "Bob's dot is gone");
    for (const player of [alice, bob]) player.assertNoPageErrors();
  } finally {
    for (const player of [alice, bob]) await player.stop().catch(() => {});
  }
});
