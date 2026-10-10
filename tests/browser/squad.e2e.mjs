// Squad (ticket 05): three real copies of the app on the dev transport (no Tailscale): Alice, Bob
// and Cara, each with its own data folder, app port and peer port, each in its own browser page.
// Checks the acceptance list: drawings travel and undo, the per-friend toggle, task sharing on in
// one copy and off in another, "Also:" lines, badges, the filter, the popup's progress, "Friends'
// tasks", a friend going offline and coming back, and Leave.
// STM_E2E_SHOTS=<dir> also saves screenshots there.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";
import { browserSuite, Scenario, startApp, stateWithTasks, taskNamed, waitUntil } from "./harness.js";

browserSuite();

const MAP = "streets-of-tarkov";
const revision = taskNamed("Revision - Streets of Tarkov"); // three "mark" objectives
const glory = taskNamed("Glory to CPSU");
const ballet = taskNamed("Ballet Lover");
const dandies = taskNamed("Dandies");
const SHOTS_DIR = process.env.STM_E2E_SHOTS || "";

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

/** One friend: a scenario (app + browser page) joined to the squad over the dev transport. */
class Player {
  constructor(name, color, peerPort, otherPeerPorts, state) {
    this.name = name;
    this.color = color;
    this.env = {
      STM_SQUAD_DEV_LISTEN: `127.0.0.1:${peerPort}`,
      STM_SQUAD_DEV_PEERS: otherPeerPorts.map((port) => `127.0.0.1:${port}`).join(","),
    };
    this.scenario = new Scenario(`squad--${name.toLowerCase()}`, { state, env: this.env });
  }

  get page() {
    return this.scenario.page;
  }

  async start() {
    await this.scenario.start();
    await this.scenario.openMap(MAP);
  }

  async openSettings() {
    await this.page.click("#settings");
    await this.page.waitForSelector("#sSquad");
  }

  async closeSettings() {
    await this.page.click("#sClose");
  }

  /** Settings → Squad: paste an invite code and Join, then set the name and colour. */
  async join() {
    await this.openSettings();
    await this.page.fill("#sSquadKey", "tskey-auth-dev-test");
    await this.page.click("#sSquadJoin");
    await this.page.waitForSelector("#sSquadName", { timeout: 30_000 });
    await this.setProfile();
    await this.closeSettings();
  }

  async setProfile() {
    await this.page.fill("#sSquadName", this.name);
    await this.answeredProfile(() => this.page.press("#sSquadName", "Tab"));
    await this.answeredProfile(() => this.page.fill("#sSquadColor", this.color));
  }

  answeredProfile(action) {
    return this.scenario.answered("PUT", "/api/squad/profile", action);
  }

  /** The player's id (from the server), to find its chip and toggles in the others' pages. */
  async playerId() {
    return (await this.scenario.api("/api/squad")).me.playerId;
  }

  chip(friendId) {
    return this.page.locator(`.squad-chip[data-friend="${friendId}"]`);
  }

  /** The number of lines of a friend on the map. */
  friendLines(friendId) {
    return this.page.locator(`svg.map g[data-friend="${friendId}"] polyline`).count();
  }

  async shot(name) {
    if (!SHOTS_DIR) return;
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    await this.page.evaluate(() => document.fonts.ready.then(() => true));
    await this.page.screenshot({ path: path.join(SHOTS_DIR, name + ".png"), animations: "disabled" });
  }
}

async function eventually(check, what, timeout = 8000) {
  await waitUntil(check, { timeout, interval: 100, what });
}

test("three copies: drawings, task sharing, offline and back, and leaving", { timeout: 240_000 }, async (t) => {
  const ports = [await freePort(), await freePort(), await freePort()];
  const alice = new Player("Alice", "#e03131", ports[0], [ports[1], ports[2]], stateWithTasks([revision.name, glory.name, ballet.name]));
  const bob = new Player("Bob", "#1c7ed6", ports[1], [ports[0], ports[2]], stateWithTasks([revision.name, dandies.name]));
  const cara = new Player("Cara", "#2f9e44", ports[2], [ports[0], ports[1]], stateWithTasks([glory.name]));
  const players = [alice, bob, cara];
  try {
    for (const player of players) await player.start();

    // ---- not joined: the invite box; then join
    await alice.openSettings();
    assert.equal(await alice.page.locator("#sSquadKey").count(), 1, "an invite code box");
    assert.equal(await alice.page.locator("#sSquadJoin").textContent(), "Join");
    await alice.shot("settings-squad-not-joined");
    await alice.page.fill("#sSquadKey", "not-a-code");
    await alice.page.click("#sSquadJoin");
    await alice.page.waitForFunction(() => /tskey-/.test(document.querySelector("#sSquadError")?.textContent || ""));
    await alice.closeSettings();
    for (const player of players) await player.join();
    const [aliceId, bobId, caraId] = await Promise.all(players.map((player) => player.playerId()));

    for (const player of players) {
      await eventually(async () => (await player.page.locator(".squad-chip").count()) === 2, `${player.name} sees two friends`);
    }
    await eventually(async () => (await alice.chip(bobId).textContent()).includes("online"), "Bob shows online");
    assert.match(await alice.chip(bobId).textContent(), /Bob/);
    await alice.openSettings();
    assert.match(await alice.page.textContent("#sSquadStatus"), /Connected · 2 of 2 friends online/);
    await alice.shot("settings-squad-joined");
    await alice.closeSettings();

    // ---- drawings: A draws, B and C see it in A's colour; undo removes it
    await alice.page.click("#bdraw");
    const drewAt = Date.now();
    await alice.scenario.dragMap(160, 60);
    for (const other of [bob, cara]) {
      await eventually(async () => (await other.friendLines(aliceId)) === 1, `${other.name} sees Alice's line`, 5000);
    }
    t.diagnostic(`a drawing reached both friends in ${Date.now() - drewAt} ms`);
    const lineColor = await bob.page.getAttribute(`svg.map g[data-friend="${aliceId}"] polyline`, "stroke");
    assert.equal(lineColor, "#e03131", "drawn in Alice's profile colour, not the stroke's own");
    await bob.shot("map-with-friend-drawing");
    await alice.page.click("#dundo");
    for (const other of [bob, cara]) {
      await eventually(async () => (await other.friendLines(aliceId)) === 0, `${other.name}: undo removes Alice's line`);
    }
    await alice.page.click("#dredo");
    for (const other of [bob, cara]) {
      await eventually(async () => (await other.friendLines(aliceId)) === 1, `${other.name} sees the redone line`);
    }

    // ---- B hides A's drawings; C still sees them
    await bob.page.click(`[data-squad-drawings="${aliceId}"]`);
    assert.equal(await bob.friendLines(aliceId), 0, "Bob hid Alice's drawings");
    await alice.page.click("#dundo");
    await alice.page.click("#dredo");
    await eventually(async () => (await cara.friendLines(aliceId)) === 1, "Cara still sees Alice's line");
    assert.equal(await bob.friendLines(aliceId), 0, "and Bob's toggle stays off");
    await eventually(() => bob.scenario.savedState().squad?.friends[aliceId]?.drawings === false, "the choice is saved");
    await bob.page.click(`[data-squad-drawings="${aliceId}"]`);
    assert.equal(await bob.friendLines(aliceId), 1, "switched on, Alice's line is back");
    await alice.page.click("#bdraw"); // leave draw mode

    // ---- tasks: nothing is shared until it is switched on
    await eventually(async () => (await bob.page.locator(".squad-tasks").count()) === 0, "no friends' tasks block yet");
    assert.equal(await bob.page.locator(".also").count(), 0);
    assert.equal(await bob.page.locator("svg.map .squad-dot").count(), 0);
    await bob.page.click(`[data-squad-tasks="${aliceId}"]`);
    assert.equal(await bob.page.locator(".also").count(), 0, "Alice isn't sharing tasks yet");

    await alice.openSettings();
    await alice.page.check("#sSquadShareTasks");
    await alice.closeSettings();
    const bobRow = `#panel .task[data-task="${revision.id}"]`;
    await eventually(async () => (await bob.page.locator(bobRow + " .also").count()) === 1, "Bob's Revision row says 'Also: Alice'", 8000);
    assert.equal((await bob.page.textContent(bobRow + " .also")).trim(), "Also: Alice");
    assert.equal(await bob.page.locator(`#panel .task[data-task="${dandies.id}"] .also`).count(), 0, "Dandies isn't shared");

    // badges: a dot in Alice's colour on each of Bob's Revision markers, and none on Dandies
    const dots = await bob.page.locator("svg.map g.mk .squad-dot").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("fill")));
    assert.ok(dots.length >= 1);
    assert.ok(dots.every((fill) => fill === "#e03131"), "dots are in Alice's colour");
    assert.equal(dots.length, revision.objs.length, "one dot on each of Revision's markers");

    // the "Friends' tasks" block: what Alice has that Bob doesn't (not Revision)
    const block = bob.page.locator(".squad-tasks");
    assert.equal(await block.count(), 1);
    const blockText = await block.textContent();
    assert.ok(blockText.includes(ballet.name) || blockText.includes(glory.name), "Alice's other tasks are listed");
    assert.ok(!blockText.includes(revision.name), "a task Bob has is not repeated");
    assert.ok(await bob.page.locator("svg.map .friend-marker").count() > 0, "smaller markers for Alice's other tasks");
    // ... and none of it is on Bob's own list or in his saved data
    assert.equal(await bob.page.locator(`#panel .tasks .task[data-task="${ballet.id}"]`).count(), 0);
    assert.equal(bob.scenario.savedState().tasks[ballet.id], undefined);

    // Alice ticks one objective; Bob's popup says "Alice 1/3"
    await alice.page.click(`#panel .task[data-task="${revision.id}"] .trow`);
    await alice.page.check(`#panel [data-tickbox="${revision.objs[0].id}"]`);
    await bob.page.click(bobRow + " .trow");
    await eventually(async () => /Alice 1\/3/.test((await bob.page.textContent("#pop")) || ""), "Bob's popup shows Alice's progress", 8000);
    const popup = await bob.page.textContent("#pop");
    assert.match(popup, /Also: Alice/);
    await bob.shot("popup-also");

    // the filter: only tasks a shown friend also has
    await bob.page.click('[data-act="squadonly"]');
    assert.equal(await bob.page.locator("#panel .cat .task").count(), 1, "only Revision is listed");
    assert.equal(await bob.page.locator("#panel .cat .task").first().getAttribute("data-task"), revision.id);
    assert.equal(await bob.page.locator("svg.map g.mk").count(), revision.objs.length, "only Revision's markers");
    await bob.page.click('[data-act="squadonly"]');

    // Alice sees nothing of Bob's tasks (he shares none), even with his toggle on
    await alice.page.click(`[data-squad-tasks="${bobId}"]`);
    assert.equal(await alice.page.locator(".also").count(), 0);
    assert.equal(await alice.page.locator(".squad-tasks").count(), 0);
    await bob.shot("panel-chips-and-filter");

    // ---- Cara goes offline: the others show "last seen"; she comes back with new data
    const caraSlug = cara.scenario.slug;
    await cara.scenario.app.stop();
    await eventually(async () => /last seen/.test(await alice.chip(caraId).textContent()), "Alice sees Cara's 'last seen'", 15_000);
    await eventually(async () => /last seen/.test(await bob.chip(caraId).textContent()), "Bob sees Cara's 'last seen'", 15_000);
    assert.equal(await alice.page.locator(".squad-chip").count(), 2, "she stays in the list");
    await alice.shot("chips-friend-offline");
    cara.scenario.app = await startApp({ slug: caraSlug, dataDir: cara.scenario.app.dataDir, keepData: true, env: cara.env });
    await cara.page.goto(cara.scenario.base + `/#/map/${MAP}`);
    await cara.scenario.waitForMap(MAP);
    await cara.page.click("#bdraw");
    await cara.scenario.dragMap(-100, 80);
    await eventually(async () => (await alice.chip(caraId).textContent()).includes("online"), "Cara is online again for Alice", 20_000);
    await eventually(async () => (await alice.friendLines(caraId)) === 1, "Cara's new drawing reaches Alice", 8000);

    // ---- Leave: Alice's friends are gone from her page and her cache
    await alice.openSettings();
    await alice.page.click("#sSquadLeave"); // the confirm is accepted by the harness
    await alice.page.waitForSelector("#sSquadKey");
    await alice.closeSettings();
    assert.equal(await alice.page.locator(".squad-chip").count(), 0);
    assert.equal(await alice.page.locator("svg.map g[data-friend]").count(), 0);
    assert.equal(await alice.page.locator(".also, .squad-dot").count(), 0);
    const cache = JSON.parse(fs.readFileSync(path.join(alice.scenario.app.dataDir, "squad-task-map-squad.json"), "utf8"));
    assert.deepEqual(cache.friends || {}, {}, "friends' cache is cleared");
    assert.equal((await alice.scenario.api("/api/squad")).settings.joined, false);

    for (const player of players) player.scenario.assertNoPageErrors();
  } finally {
    for (const player of players) await player.scenario.stop().catch(() => {});
  }
});

// ---------------------------------------------------------------- hostile friends (QA round 2)

/** A friend that is only a peer API serving the share we give it, so its name and task ids are ours. */
class FakeFriend {
  constructor(id, name, tasks) {
    this.share = { v: 1, player: { id, name, color: "#ff922b" }, rev: 1, updatedAt: 1000, draw: {}, tasks };
  }

  async start() {
    this.port = await freePort();
    this.server = http.createServer((req, res) => {
      if (req.url === "/squad/v1/share") {
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify(this.share));
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(": hi\n\nevent: share\ndata: " + JSON.stringify(this.share) + "\n\n");
    });
    await new Promise((resolve) => this.server.listen(this.port, "127.0.0.1", resolve));
  }

  stop() {
    this.server.close();
    this.server.closeAllConnections();
  }
}

test("a 32-wide name keeps the toggles and rows in the panel; friends with 'toString' task ids or a direction override are refused", { timeout: 180_000 }, async () => {
  // Real game ids are 24 hex characters; the server refuses a share with anything else (QA round 3).
  const wide = new FakeFriend("a1a1a1a1a1a1a1a1", "W".repeat(32), { [glory.id]: { ticks: {}, pct: 0 } });
  const hostileIds = new FakeFriend("c3c3c3c3c3c3c3c3", "Ids", {
    toString: { ticks: { toString: true }, pct: 1 },
    valueOf: { ticks: {}, pct: 1 },
    hasOwnProperty: { ticks: {}, pct: 1 },
  });
  const rtl = new FakeFriend("b2b2b2b2b2b2b2b2", "\u202eevil\u202c Mike", null);
  const fakes = [wide, hostileIds, rtl];
  for (const fake of fakes) await fake.start();
  const ownPort = await freePort();
  const victim = new Player("Victim", "#e03131", ownPort, fakes.map((fake) => fake.port), stateWithTasks([revision.name, glory.name]));
  try {
    await victim.start();
    await victim.openSettings();
    await victim.page.fill("#sSquadKey", "tskey-auth-dev-test");
    await victim.page.click("#sSquadJoin");
    await victim.page.waitForSelector("#sSquadName", { timeout: 30_000 });
    await victim.closeSettings();
    await eventually(async () => (await victim.page.locator(".squad-chip").count()) === 1, "the wide friend shows", 20_000);
    // the other two have been fetched by now too (all three are asked at join); give them a moment
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const shownFriends = (await victim.scenario.api("/api/squad")).friends.map((friend) => friend.playerId);
    assert.deepEqual(shownFriends, [wide.share.player.id], "the 'toString' and direction-override friends are refused");

    const ownTasks = () => victim.page.locator("#panel .cat .task").count();
    const ownMarkers = () => victim.page.locator("svg.map g.mk").count();
    const [tasksBefore, markersBefore] = [await ownTasks(), await ownMarkers()];
    assert.ok(tasksBefore > 0 && markersBefore > 0, "the victim has a list and markers");

    const togglesInsidePanel = async (what) => {
      const fits = await victim.page.evaluate(() => {
        const panel = document.querySelector("#panel").getBoundingClientRect();
        return [...document.querySelectorAll(".squad-toggle")].map((button) => {
          const box = button.getBoundingClientRect();
          return box.width > 0 && box.left >= panel.left && box.right <= panel.right;
        });
      });
      assert.deepEqual(fits, [true, true], `${what}: both toggles are inside the panel`);
    };
    const panelDoesNotOverflow = async (what) => {
      const [scroll, client] = await victim.page.evaluate(() => [document.querySelector("#panel").scrollWidth, document.querySelector("#panel").clientWidth]);
      assert.ok(scroll <= client, `${what}: the panel doesn't scroll sideways (${scroll} > ${client})`);
    };
    await togglesInsidePanel("desktop");
    await victim.shot("chips-long-name");

    // the wide friend's tasks on: "Also: WWW…" on the shared row wraps inside the panel
    await victim.page.click(`[data-squad-tasks="${wide.share.player.id}"]`);
    await eventually(async () => (await victim.page.locator(".squad-chip").count()) === 1, "chip still there");
    await panelDoesNotOverflow("desktop, tasks on");
    await victim.page.setViewportSize({ width: 390, height: 800 });
    await togglesInsidePanel("phone");
    await panelDoesNotOverflow("phone, tasks on");
    await victim.shot("chips-long-name-phone");
    await victim.page.setViewportSize({ width: 1280, height: 800 });

    assert.equal(await ownTasks(), tasksBefore, "your task list is intact");
    assert.equal(await ownMarkers(), markersBefore, "your markers are intact");
    await victim.page.reload();
    await victim.scenario.waitForMap(MAP);
    assert.equal(await ownTasks(), tasksBefore, "your task list is intact after a reload");
    assert.equal(await ownMarkers(), markersBefore, "your markers are intact after a reload");
    await togglesInsidePanel("after reload");
    victim.scenario.assertNoPageErrors();
  } finally {
    await victim.scenario.stop().catch(() => {});
    for (const fake of fakes) fake.stop();
  }
});

// ---------------------------------------------------------------- 2.8.1: the filter with nobody sharing

test("'Shared with squad' left on while no shown friend shares tasks hides none of your tasks (2.8.1)", { timeout: 180_000 }, async () => {
  // The owner's 2.8.0 report: one friend "Player", last seen a while ago, sharing no tasks, and the
  // filter on: every category said "Nothing here" and no map had a task marker.
  const quiet = new FakeFriend("d4d4d4d4d4d4d4d4", "Player", null);
  const sharer = new FakeFriend("e5e5e5e5e5e5e5e5", "Sam", { [glory.id]: { ticks: {}, pct: 0 } });
  const fakes = [quiet, sharer];
  for (const fake of fakes) await fake.start();
  const state = stateWithTasks([revision.name, glory.name]);
  state.squad = { friends: {}, sharedOnly: true }; // saved "on", as in the owner's file
  const owner = new Player("Owner", "#e03131", await freePort(), fakes.map((fake) => fake.port), state);
  const ownTasks = () => owner.page.locator("#panel .cat .task").count();
  const ownMarkers = () => owner.page.locator("svg.map g.mk").count();
  const filterChip = () => owner.page.locator('[data-act="squadonly"]');
  try {
    await owner.start();
    const [tasksBefore, markersBefore] = [await ownTasks(), await ownMarkers()];
    assert.ok(tasksBefore > 1 && markersBefore > 1, "the owner has a list and markers");

    await owner.join();
    await eventually(async () => (await owner.page.locator(".squad-chip").count()) === 2, "both friends show", 20_000);
    quiet.stop();
    await eventually(async () => /last seen/.test(await owner.chip(quiet.share.player.id).textContent()), "Player shows 'last seen'", 15_000);

    // nobody whose tasks you show shares them: the filter does nothing and says why
    assert.equal(await ownTasks(), tasksBefore, "every row is still listed");
    assert.equal(await ownMarkers(), markersBefore, "every marker is still drawn");
    assert.equal(await filterChip().isDisabled(), true, "the chip can't be used yet");
    assert.equal(await filterChip().getAttribute("aria-pressed"), "false", "and doesn't look on");
    assert.match(await filterChip().getAttribute("title"), /Tasks/);
    await owner.shot("filter-inactive");

    // Sam's ☰ Tasks on: the saved choice applies again, only Glory is left
    await owner.page.click(`[data-squad-tasks="${sharer.share.player.id}"]`);
    assert.equal(await filterChip().isDisabled(), false);
    assert.equal(await filterChip().getAttribute("aria-pressed"), "true");
    const listed = await owner.page.locator("#panel .cat .task").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-task")));
    assert.ok(listed.length > 0 && listed.every((id) => id === glory.id), "only the task Sam also has");
    const filteredMarkers = await ownMarkers();
    assert.ok(filteredMarkers > 0 && filteredMarkers < markersBefore, "only Glory's markers");

    // switched off by hand: everything is back
    await filterChip().click();
    assert.equal(await ownTasks(), tasksBefore);
    assert.equal(await ownMarkers(), markersBefore);
    await eventually(() => owner.scenario.savedState().squad?.sharedOnly === false, "switching it off is saved");

    // Sam's tasks off again with the filter on: nothing hides, also after a reload
    await filterChip().click();
    await owner.page.click(`[data-squad-tasks="${sharer.share.player.id}"]`);
    assert.equal(await ownTasks(), tasksBefore);
    await owner.page.reload();
    await owner.scenario.waitForMap(MAP);
    await eventually(async () => (await owner.page.locator(".squad-chip").count()) === 2, "friends after the reload");
    assert.equal(await ownTasks(), tasksBefore, "every row after a reload");
    assert.equal(await ownMarkers(), markersBefore, "every marker after a reload");
    owner.scenario.assertNoPageErrors();
  } finally {
    await owner.scenario.stop().catch(() => {});
    for (const fake of fakes) fake.stop();
  }
});
