// Squad positions (ticket 17, GitHub issue #17): squadmates see each other's last GPS position.
// Two real copies on the dev transport (Ann and Ben), each with its own data folder, game log and
// screenshots folder, drive the issue's browser check: a GPS screenshot in Ann's raid shows her dot
// in Ben's page on the right map only, through the same projection as Ben's own marker; Ben's ◎ Pos
// switch hides it; it is gone after Ann's raid ends; with "Share my position" off nothing leaves
// Ann's copy; a raid on another map clears it. Fake friends (a peer API serving a share we write)
// cover the fade and hide by age, the one-shot refresh timer, and positions the server refuses.
// STM_E2E_OLD_APP=<an older build of the app, e.g. 2.8.1> also runs that copy next to this one
// (mixed versions: the older copy must keep taking shares that carry a position).
// STM_E2E_SHOTS=<dir> saves screenshots there.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  browserSuite, stateWithTasks, taskNamed, middleOfExtracts, mainThreadRenderingWork, waitUntil, sleep,
  FACING_45_DEGREES, FACING_135_DEGREES, OWN_MARKER,
} from "./harness.js";
import { Player, FakeFriend, freePort, eventually } from "./squad-players.js";

browserSuite();

const CUSTOMS = "customs";
const WOODS = "woods";
const STREETS = "streets-of-tarkov";
const MINUTE_MS = 60_000;
// A log line reaches the app within one 5 s log check; a share then takes up to a second or two.
const LOG_WAIT = 15_000;
const SHARE_WAIT = 8000;

const CUSTOMS_LOADING = "scene preset path:maps/customs_preset.bundle rcid:x";
const WOODS_LOADING = "scene preset path:maps/woods_preset.bundle rcid:x";
const RAID_STARTED = "GameStarted:12.3 real:4.5";
const BACK_IN_MENUS = "PrepareSelectedProfileLocally ProfileId:0 AccountId:1";

const revision = taskNamed("Revision - Streets of Tarkov");
const OLD_APP = process.env.STM_E2E_OLD_APP || "";

/** A friend's position on the open map (ticket 17's DOM hook). */
const friendMarker = (friendId) => `svg.map g.friend-player[data-friend="${friendId}"]`;

/** The log says a raid is loading on a map, then that it started; waits until the app knows. */
async function startRaid(player, loadingLine, mapKey) {
  player.scenario.appLog(loadingLine);
  player.scenario.appLog(RAID_STARTED);
  await waitUntil(async () => {
    const raid = (await player.scenario.status()).raid;
    return raid.active && raid.map === mapKey;
  }, { timeout: LOG_WAIT, what: `${player.name}'s raid on ${mapKey}` });
}

/** The log says the player is back in the menus; waits until the app has ended the raid. */
async function endRaid(player) {
  player.scenario.appLog(BACK_IN_MENUS);
  await waitUntil(async () => !(await player.scenario.status()).raid.active, { timeout: LOG_WAIT, what: `${player.name}'s raid to end` });
}

/** Drops a GPS screenshot in the player's folder and waits until the app has read it. */
async function takeGpsScreenshot(player, x, y, z, facing = FACING_45_DEGREES) {
  const before = (await player.scenario.status()).gps?.t ?? null;
  player.scenario.dropGps(x, y, z, facing);
  return waitUntil(async () => {
    const gps = (await player.scenario.status()).gps;
    return gps && gps.t !== before ? gps : null;
  }, { timeout: 10_000, what: `${player.name}'s GPS screenshot to be read` });
}

/** What a friend's marker shows: where (data-x/y), the arrow's turn, faded, colour, name, tooltip. */
function readFriendMarker(page, friendId) {
  return page.evaluate((selector) => {
    const marker = document.querySelector(selector);
    if (!marker) return null;
    const disc = marker.querySelector("g[data-r]");
    const dot = marker.querySelector(".friend-player-dot");
    return {
      x: disc.getAttribute("data-x"),
      y: disc.getAttribute("data-y"),
      turn: disc.getAttribute("data-r"),
      faded: marker.classList.contains("faded"),
      opacity: marker.getAttribute("opacity"),
      fill: dot.getAttribute("fill"),
      name: marker.querySelector(".friend-player-name")?.textContent ?? null,
      tooltip: dot.querySelector("title")?.textContent ?? null,
    };
  }, friendMarker(friendId));
}

/** The text after a friend's status on their chip (" · on Customs"), or "" when there is none. */
async function chipWhere(player, friendId) {
  const where = player.chip(friendId).locator(".squad-where");
  return (await where.count()) ? (await where.textContent()).trim() : "";
}

function positionToggle(player, friendId) {
  return player.page.locator(`[data-squad-position="${friendId}"]`);
}

async function isDimmed(locator) {
  return (await locator.getAttribute("class")).split(/\s+/).includes("dim");
}

// ---------------------------------------------------------------- two copies (the issue's check)

test("two copies: a GPS screenshot shows the friend's dot on the right map only, the ◎ Pos switch hides it, raid end removes it, and 'Share my position' off sends nothing", { timeout: 300_000 }, async (t) => {
  const [annPort, benPort] = [await freePort(), await freePort()];
  const ann = new Player("Ann", "#e03131", annPort, [benPort], stateWithTasks([revision.name]), { map: CUSTOMS });
  const ben = new Player("Ben", "#1c7ed6", benPort, [annPort], stateWithTasks([revision.name]), { map: CUSTOMS });
  const players = [ann, ben];
  const customs = middleOfExtracts(CUSTOMS);
  const config = (mapKey) => ann.scenario.api("/api/config").then((maps) => maps.find((map) => map.key === mapKey));
  // The arrow turns by the game's heading plus the map's rotation (+180° more for maps turned 90°/270°).
  const expectedTurn = (mapConfig, yaw) => {
    let add = mapConfig.rotation || 0;
    if (add === 90 || add === 270) add += 180;
    return (yaw + add).toFixed(1);
  };
  try {
    for (const player of players) await player.start();
    for (const player of players) await player.join();
    const [annId, benId] = await Promise.all(players.map((player) => player.playerId()));
    await eventually(async () => (await ben.chip(annId).count()) === 1 && (await ben.chip(annId).textContent()).includes("online"), "Ben sees Ann online", 20_000);

    await t.test("both sharing switches are on for a new squad member; ◎ Pos is on and dimmed while Ann has no position", async () => {
      for (const player of players) {
        const settings = (await player.scenario.api("/api/squad")).settings;
        assert.equal(settings.sharePosition, true, `${player.name}: Share my position is on by default`);
        assert.equal(settings.shareTasks, true, `${player.name}: Share my tasks is on by default`);
      }
      const toggle = positionToggle(ben, annId);
      assert.equal(await toggle.getAttribute("aria-pressed"), "true", "◎ Pos starts on");
      assert.equal(await isDimmed(toggle), true, "dimmed: Ann has no position yet");
      assert.equal(await ben.page.locator("svg.map g.friend-player").count(), 0);
    });

    let firstGps = null;
    await t.test("Ann's GPS screenshot in a raid on Customs shows her dot on Ben's Customs, without moving Ben's view or feeding his Find me", async () => {
      await startRaid(ann, CUSTOMS_LOADING, CUSTOMS);
      const viewBefore = await ben.scenario.viewBox();
      const sentAt = Date.now();
      firstGps = await takeGpsScreenshot(ann, customs.x, 1, customs.z, FACING_45_DEGREES);
      await eventually(async () => (await ben.page.locator(friendMarker(annId)).count()) === 1, "Ann's dot on Ben's Customs", SHARE_WAIT);
      t.diagnostic(`Ann's position reached Ben's map in ${Date.now() - sentAt} ms`);

      const shared = (await ben.friendView(annId)).share.pos;
      assert.deepEqual(shared, { map: CUSTOMS, x: firstGps.x, y: firstGps.y, z: firstGps.z, yaw: firstGps.yaw, t: Math.trunc(firstGps.t) }, "the gps event's fields and values");
      const marker = await readFriendMarker(ben.page, annId);
      assert.equal(marker.faded, false, "fully opaque when fresh");
      assert.equal(marker.opacity, null);
      assert.equal(marker.fill, "#e03131", "in Ann's colour");
      assert.equal(marker.name, "Ann");
      assert.equal(marker.tooltip, "Ann · just now");
      assert.equal(marker.turn, expectedTurn(await config(CUSTOMS), firstGps.yaw), "the arrow turns like your own would");
      assert.equal(await isDimmed(positionToggle(ben, annId)), false, "◎ Pos is no longer dimmed");
      assert.equal(await chipWhere(ben, annId), "", "no 'on …' while she is on the open map");

      assert.deepEqual(await ben.scenario.viewBox(), viewBefore, "Ben's view didn't move");
      assert.equal(await ben.page.locator(OWN_MARKER).count(), 0, "Ben has no marker of his own");
      assert.equal(await ben.page.isHidden("#gpsbar"), true, "and no 'You' bar");
      await ben.shot("positions-friend-dot");
    });

    await t.test("an idle page with a friend's dot does no rendering work", async () => {
      await ben.scenario.waitForNoToast();
      await ben.page.mouse.move(1, 1);
      await sleep(1000);
      const work = await mainThreadRenderingWork(ben.page, 3000);
      t.diagnostic(`idle with a friend's position: ${JSON.stringify(work)}`);
      assert.equal(await ben.page.locator(friendMarker(annId)).count(), 1, "the dot was there during the trace");
      assert.equal(work.Paint, 0, "no main-thread Paint");
      assert.equal(work.Layout, 0, "no main-thread Layout");
    });

    await t.test("Ann's dot isn't on another map: Ben's Streets has none and her chip says 'on Customs'", async () => {
      await ben.scenario.openMap(STREETS);
      await eventually(async () => (await ben.chip(annId).count()) === 1, "Ann's chip on Streets");
      assert.equal(await ben.page.locator("svg.map g.friend-player").count(), 0, "no friend's position on Streets");
      assert.equal(await chipWhere(ben, annId), "· on Customs");
      await ben.shot("positions-chip-on-customs");
      await ben.scenario.openMap(CUSTOMS);
      await eventually(async () => (await ben.page.locator(friendMarker(annId)).count()) === 1, "back on Customs, the dot is back");
      assert.equal(await chipWhere(ben, annId), "");
    });

    await t.test("Ben's ◎ Pos switch for Ann hides her dot and brings it back, and is saved", async () => {
      const toggle = positionToggle(ben, annId);
      await ben.scenario.saving(() => toggle.click());
      assert.equal(await ben.page.locator(friendMarker(annId)).count(), 0, "hidden at once");
      assert.equal(await toggle.getAttribute("aria-pressed"), "false");
      assert.equal(ben.scenario.savedState().squad?.friends?.[annId]?.position, false, "the choice is saved");
      await ben.scenario.openMap(STREETS);
      assert.equal(await chipWhere(ben, annId), "", "no 'on Customs' while her position is switched off");
      await ben.scenario.openMap(CUSTOMS);
      assert.equal(await ben.page.locator(friendMarker(annId)).count(), 0, "still hidden after opening the map again");
      await ben.scenario.saving(() => positionToggle(ben, annId).click());
      assert.equal(await ben.page.locator(friendMarker(annId)).count(), 1, "switched on, the dot is back");
      assert.equal(ben.scenario.savedState().squad.friends[annId].position, true);
    });

    await t.test("the dot sits where Ben's own marker sits for the same position, smaller and under it (same projection)", async () => {
      await startRaid(ben, CUSTOMS_LOADING, CUSTOMS);
      await ben.scenario.dropGpsAndWait(customs.x, 1, customs.z, FACING_45_DEGREES);
      const placed = await ben.page.evaluate(({ friendSelector, ownSelector }) => {
        const centre = (element) => {
          const box = element.getBoundingClientRect();
          return { x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width };
        };
        const friendDisc = document.querySelector(friendSelector + " g[data-r]");
        const ownDisc = document.querySelector(ownSelector);
        return {
          friend: { x: friendDisc.getAttribute("data-x"), y: friendDisc.getAttribute("data-y"), turn: friendDisc.getAttribute("data-r"), box: centre(friendDisc.querySelector(".friend-player-dot")) },
          own: { x: ownDisc.getAttribute("data-x"), y: ownDisc.getAttribute("data-y"), turn: ownDisc.getAttribute("data-r"), box: centre(ownDisc.querySelector("circle")) },
          ownIsDrawnLater: !!(friendDisc.compareDocumentPosition(ownDisc) & Node.DOCUMENT_POSITION_FOLLOWING),
        };
      }, { friendSelector: friendMarker(annId), ownSelector: OWN_MARKER });
      assert.equal(placed.friend.x, placed.own.x, "the same map x");
      assert.equal(placed.friend.y, placed.own.y, "the same map y");
      assert.equal(placed.friend.turn, placed.own.turn, "the same arrow turn");
      assert.ok(Math.abs(placed.friend.box.x - placed.own.box.x) < 0.5 && Math.abs(placed.friend.box.y - placed.own.box.y) < 0.5, `the same spot on screen (${JSON.stringify(placed)})`);
      assert.ok(placed.friend.box.width < placed.own.box.width, `smaller than Ben's own (${placed.friend.box.width} < ${placed.own.box.width})`);
      assert.ok(placed.ownIsDrawnLater, "Ben's own marker is drawn over it");
      // Ben's own screenshot is shared too: Ann sees Ben
      await eventually(async () => (await ann.page.locator(friendMarker(benId)).count()) === 1, "Ann sees Ben's dot", SHARE_WAIT);
      await ben.shot("positions-friend-and-you");
    });

    await t.test("Ann's next screenshot moves her dot and turns its arrow", async () => {
      const before = await readFriendMarker(ben.page, annId);
      const second = await takeGpsScreenshot(ann, customs.x + 40, 1, customs.z - 30, FACING_135_DEGREES);
      await eventually(async () => (await readFriendMarker(ben.page, annId))?.x !== before.x, "Ann's dot moved", SHARE_WAIT);
      const after = await readFriendMarker(ben.page, annId);
      assert.equal(after.turn, expectedTurn(await config(CUSTOMS), second.yaw));
      assert.equal(((Number(after.turn) - Number(before.turn)) % 360 + 360) % 360, 90, "turning 90° in the game turns her arrow 90°");
      assert.equal(await ben.page.locator("svg.map g.friend-player").count(), 1, "one dot per friend");
    });

    await t.test("Ann's raid ends: her dot is gone from Ben's map and her share has no position", async () => {
      await endRaid(ann);
      await eventually(async () => (await ben.page.locator(friendMarker(annId)).count()) === 0, "Ann's dot gone after her raid", SHARE_WAIT);
      assert.equal((await ben.friendView(annId)).share.pos, undefined);
      assert.equal((await ann.peerShare()).pos, undefined, "Ann's copy sends no position");
      assert.equal(await isDimmed(positionToggle(ben, annId)), true, "◎ Pos dimmed again");
      assert.equal(await ben.page.locator(OWN_MARKER).count(), 1, "Ben's own marker is untouched");
    });

    await t.test("'Share my position' off: a screenshot in a raid sends nothing; on again shares the last one at once", async () => {
      await ann.openSettings();
      assert.equal(await ann.page.isChecked("#sSquadSharePosition"), true, "on by default");
      await ann.answeredProfile(() => ann.page.uncheck("#sSquadSharePosition"));
      await ann.closeSettings();
      await eventually(() => ann.scenario.savedSettings().squad?.sharePosition === false, "an 'off' is written to the settings file as false");
      assert.equal(ann.scenario.savedSettings().squad.shareTasks, true, "the other switch is kept");
      assert.equal((await ann.scenario.api("/api/squad")).settings.sharePosition, false);

      await startRaid(ann, CUSTOMS_LOADING, CUSTOMS);
      const held = await takeGpsScreenshot(ann, customs.x - 25, 1, customs.z + 15);
      await sleep(3000); // a share would have reached Ben by now (see the timings above)
      assert.equal((await ann.peerShare()).pos, undefined, "Ann's copy doesn't send it");
      assert.equal((await ben.friendView(annId)).share.pos, undefined);
      assert.equal(await ben.page.locator(friendMarker(annId)).count(), 0, "nothing on Ben's map");

      await ann.openSettings();
      await ann.answeredProfile(() => ann.page.check("#sSquadSharePosition"));
      await ann.closeSettings();
      await eventually(async () => (await ben.page.locator(friendMarker(annId)).count()) === 1, "on again: the held position is shared", SHARE_WAIT);
      assert.equal((await ben.friendView(annId)).share.pos.x, held.x, "the screenshot taken while it was off");
      await eventually(() => ann.scenario.savedSettings().squad?.sharePosition === true, "on is written as true");
    });

    await t.test("a raid loading on another map clears it; a screenshot there shows on that map only", async () => {
      ann.scenario.appLog(WOODS_LOADING);
      await eventually(async () => (await ben.page.locator(friendMarker(annId)).count()) === 0, "cleared when the log names another map", LOG_WAIT);
      assert.equal(await chipWhere(ben, annId), "", "and not 'on Woods' before a screenshot there");
      ann.scenario.appLog(RAID_STARTED);
      await waitUntil(async () => (await ann.scenario.status()).raid.map === WOODS, { timeout: LOG_WAIT, what: "Ann's raid on Woods" });
      const woods = middleOfExtracts(WOODS);
      await takeGpsScreenshot(ann, woods.x, 1, woods.z);
      await eventually(async () => (await chipWhere(ben, annId)) === "· on Woods", "Ben's chip says 'on Woods'", SHARE_WAIT);
      assert.equal(await ben.page.locator("svg.map g.friend-player").count(), 0, "nothing on Ben's Customs");
      await ben.scenario.openMap(WOODS);
      await eventually(async () => (await ben.page.locator(friendMarker(annId)).count()) === 1, "Ann's dot on Ben's Woods");
      await endRaid(ann);
      await eventually(async () => (await ben.page.locator(friendMarker(annId)).count()) === 0, "gone after that raid too", SHARE_WAIT);
    });

    for (const player of players) player.scenario.assertNoPageErrors();
  } finally {
    for (const player of players) await player.scenario.stop().catch(() => {});
  }
});

// ---------------------------------------------------------------- age, the one timer, bad positions

/** Counts every setTimeout the page makes (with its delay), from before its scripts run. */
function countTimers() {
  const original = window.setTimeout;
  window.__stmTimers = [];
  window.setTimeout = function (handler, delay, ...rest) {
    window.__stmTimers.push(Number(delay) || 0);
    return original.call(this, handler, delay, ...rest);
  };
}

test("a friend's position fades after 5 minutes (by the one-shot timer, with no new share), hides after 30, shows 'on Woods' elsewhere, and a bad position drops the whole share", { timeout: 180_000 }, async (t) => {
  const now = Date.now();
  const customs = middleOfExtracts(CUSTOMS);
  const woods = middleOfExtracts(WOODS);
  const at = (mapKey, spot, dx, ageMs, extra = {}) => ({ pos: { map: mapKey, x: spot.x + dx, y: 1, z: spot.z, yaw: 30, t: now - ageMs, ...extra } });
  const aging = new FakeFriend("a7a7a7a7a7a7a7a7", "Aging", null); // gets its position once Vic is joined
  const faded = new FakeFriend("f1f1f1f1f1f1f1f1", "Faded", null, at(CUSTOMS, customs, -40, 10 * MINUTE_MS));
  const gone = new FakeFriend("9a9a9a9a9a9a9a9a", "Gone", null, at(CUSTOMS, customs, 40, 31 * MINUTE_MS));
  const away = new FakeFriend("8b8b8b8b8b8b8b8b", "Away", null, at(WOODS, woods, 0, 0));
  const proto = new FakeFriend("7c7c7c7c7c7c7c7c", "Proto", null, at("__proto__", customs, 0, 0));
  const spin = new FakeFriend("6d6d6d6d6d6d6d6d", "Spin", null, at(CUSTOMS, customs, 0, 0, { yaw: 400 }));
  const far = new FakeFriend("5e5e5e5e5e5e5e5e", "Far", null, at(CUSTOMS, customs, 2e6, 0));
  const fakes = [aging, faded, gone, away, proto, spin, far];
  for (const fake of fakes) await fake.start();
  const vic = new Player("Vic", "#2f9e44", await freePort(), fakes.map((fake) => fake.port), stateWithTasks([revision.name]), { map: CUSTOMS });
  try {
    await vic.scenario.start();
    await vic.page.addInitScript(countTimers);
    await vic.scenario.openMap(CUSTOMS);
    await vic.join();
    await eventually(async () => (await vic.page.locator(".squad-chip").count()) === 4, "four friends' chips", 20_000);
    await sleep(2000); // every friend was asked at join; give a refused one time to (not) appear

    await t.test("a position with a map key like '__proto__', a heading over 360° or a coordinate over 1e6 makes the server drop that share", async () => {
      const shown = (await vic.scenario.api("/api/squad")).friends.map((friend) => friend.playerId).sort();
      assert.deepEqual(shown, [aging.id, faded.id, gone.id, away.id].sort());
      const output = fs.readFileSync(vic.scenario.app.outputFile, "utf8");
      assert.match(output, /dropped a share: position map key/, "the console says why");
    });

    await t.test("over 5 minutes: half see-through, with 'Faded · 10 min ago'", async () => {
      const marker = await readFriendMarker(vic.page, faded.id);
      assert.ok(marker, "drawn");
      assert.equal(marker.faded, true);
      assert.equal(marker.opacity, "0.5", "a static opacity attribute");
      assert.equal(marker.tooltip, "Faded · 10 min ago");
      assert.equal(await isDimmed(positionToggle(vic, faded.id)), false);
    });

    await t.test("over 30 minutes: not drawn, ◎ Pos dimmed, no 'on …'", async () => {
      assert.equal(await vic.page.locator(friendMarker(gone.id)).count(), 0);
      assert.equal(await isDimmed(positionToggle(vic, gone.id)), true);
      assert.equal(await chipWhere(vic, gone.id), "");
    });

    await t.test("on another map: no dot here, 'on Woods' on the chip", async () => {
      assert.equal(await vic.page.locator(friendMarker(away.id)).count(), 0);
      assert.equal(await chipWhere(vic, away.id), "· on Woods");
      assert.equal(await vic.page.locator("svg.map g.friend-player").count(), 1, "only Faded is on Customs");
      await vic.shot("positions-ages");
    });

    await t.test("a position turning 5 minutes old fades by itself: one one-shot timer, then nothing while idle", async () => {
      aging.publish(at(CUSTOMS, customs, 80, 5 * MINUTE_MS - (Date.now() - now) - 6000)); // 5 min minus 6 s old
      await eventually(async () => (await readFriendMarker(vic.page, aging.id)) !== null, "Aging's dot", SHARE_WAIT);
      const fresh = await readFriendMarker(vic.page, aging.id);
      assert.equal(fresh.faded, false, "fresh at first");
      assert.equal(fresh.tooltip, "Aging · 5 min ago");
      await eventually(async () => (await readFriendMarker(vic.page, aging.id))?.faded, "faded with no new share", 12_000);
      const timersAtFade = await vic.page.evaluate(() => window.__stmTimers.length);
      const nextWait = await vic.page.evaluate(() => window.__stmTimers.at(-1));
      await sleep(3000);
      const timersAfterIdle = await vic.page.evaluate(() => window.__stmTimers.length);
      t.diagnostic(`after the fade, the next refresh waits ${nextWait} ms`);
      assert.ok(nextWait >= MINUTE_MS, `the next refresh is minutes away (the next fade or hide), not a loop (${nextWait} ms)`);
      assert.equal(timersAfterIdle, timersAtFade, "no timer set while idle");
      assert.equal((await readFriendMarker(vic.page, aging.id)).opacity, "0.5");
    });

    vic.scenario.assertNoPageErrors();
  } finally {
    await vic.scenario.stop().catch(() => {});
    for (const fake of fakes) fake.stop();
  }
});

// ---------------------------------------------------------------- mixed versions (opt-in)

test("mixed versions: an older copy (STM_E2E_OLD_APP) keeps taking shares that carry a position", { timeout: 240_000, skip: OLD_APP ? false : "set STM_E2E_OLD_APP=<an older build of the app, e.g. 2.8.1> to run this" }, async (t) => {
  const [oldPort, newPort] = [await freePort(), await freePort()];
  const olga = new Player("Olga", "#f08c00", oldPort, [newPort], stateWithTasks([revision.name]), { map: CUSTOMS, exe: OLD_APP });
  const nina = new Player("Nina", "#7048e8", newPort, [oldPort], stateWithTasks([revision.name]), { map: CUSTOMS });
  const players = [olga, nina];
  try {
    for (const player of players) await player.start();
    for (const player of players) await player.join();
    const [olgaId, ninaId] = await Promise.all(players.map((player) => player.playerId()));
    t.diagnostic(`older copy: ${(await olga.scenario.status()).version ?? "(no version in /api/status)"}`);
    await eventually(async () => (await olga.chip(ninaId).count()) === 1 && (await olga.chip(ninaId).textContent()).includes("online"), "Olga sees Nina online", 20_000);

    // Nina draws, then takes a GPS screenshot in a raid: her share now carries a position
    await nina.page.click("#bdraw");
    await nina.scenario.dragMap(120, 40);
    await eventually(async () => (await olga.friendLines(ninaId)) === 1, "Olga sees Nina's line", SHARE_WAIT);
    await startRaid(nina, CUSTOMS_LOADING, CUSTOMS);
    const customs = middleOfExtracts(CUSTOMS);
    await takeGpsScreenshot(nina, customs.x, 1, customs.z);
    const withPosition = await waitUntil(async () => {
      const share = await nina.peerShare();
      return share?.pos ? share : null;
    }, { timeout: SHARE_WAIT, what: "Nina's share with a position" });
    assert.equal(withPosition.v, 1, "the share format stays 1");
    await eventually(async () => (await olga.friendView(ninaId))?.share.rev === withPosition.rev, `Olga takes Nina's share rev ${withPosition.rev}, the one with a position`, SHARE_WAIT);

    // ...and keeps taking the next ones: undo and redo travel
    await nina.page.click("#dundo");
    await eventually(async () => (await olga.friendLines(ninaId)) === 0, "Nina's undo reaches Olga", SHARE_WAIT);
    await nina.page.click("#dredo");
    await eventually(async () => (await olga.friendLines(ninaId)) === 1, "and her redo", SHARE_WAIT);
    assert.match(await olga.chip(ninaId).textContent(), /online/);
    const olgaOutput = fs.readFileSync(olga.scenario.app.outputFile, "utf8");
    assert.doesNotMatch(olgaOutput, /dropped a share/, "the older copy dropped none of Nina's shares");

    // the other way: Nina sees Olga's drawings, and no position for her
    await olga.page.click("#bdraw");
    await olga.scenario.dragMap(-100, 60);
    await eventually(async () => (await nina.friendLines(olgaId)) === 1, "Nina sees Olga's line", SHARE_WAIT);
    assert.equal(await nina.page.locator(friendMarker(olgaId)).count(), 0);
    assert.equal(await isDimmed(positionToggle(nina, olgaId)), true, "Olga has no position to show");
    await olga.shot("mixed-versions-old-copy");

    for (const player of players) player.scenario.assertNoPageErrors();
  } finally {
    for (const player of players) await player.scenario.stop().catch(() => {});
  }
});
