// Squad (ticket 05): three real copies of the app on the dev transport (no Tailscale): Alice, Bob
// and Cara, each with its own data folder, app port and peer port, each in its own browser page.
// Checks the acceptance list: drawings travel and undo, the per-friend toggle, task sharing on in
// one copy and off in another ("Share my tasks" is on by default since ticket 17), who has a task
// (colour boxes), badges, the filter, the popup's progress, squadmates' tasks as crosshatched rows
// of your own list (ticket 26: selectable, pinnable, never tickable; ☰ Tasks on by default) and as
// see-through task markers with the friend's colour square under each part's main spot (ticket 27),
// a friend going offline and coming back, and Leave. Friends' positions (ticket 17) are in
// squad-positions.e2e.mjs.
// STM_E2E_SHOTS=<dir> also saves screenshots there.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { browserSuite, startApp, stateWithTasks, taskNamed } from "./harness.js";
import { Player, FakeFriend, freePort, eventually, STREETS, SHOTS_DIR } from "./squad-players.js";
import { partsOfTask } from "../../web/js/features/tasks/rules.js";
import { DEFAULT_CATEGORIES } from "../../web/js/features/tasks/categories.js";
import { requirementsOf } from "../../web/js/features/readiness/rules.js";
import { markerShapePath } from "../../web/js/map/marker-shapes.js";

browserSuite();

const MAP = STREETS;
const revision = taskNamed("Revision - Streets of Tarkov"); // three "mark" objectives
const glory = taskNamed("Glory to CPSU");
const ballet = taskNamed("Ballet Lover");
const dandies = taskNamed("Dandies");

/**
 * The category a part of a squadmate's task lands in by default: the built-in for its kind of
 * work ("<task id>:<kind>", or "<task id>:*" for a whole task).
 * @param {string} partKey
 */
function defaultCategoryIdOf(partKey) {
  const [taskId, kind] = partKey.split(":");
  const task = taskNamedById(taskId);
  const action = kind === "*" ? partsOfTask(task)[0].action : kind;
  return DEFAULT_CATEGORIES.find((category) => category.builtin === action).id;
}

function taskNamedById(taskId) {
  return [revision, glory, ballet, dandies].find((task) => task.id === taskId);
}

/**
 * Bob's start: Revision and Dandies, carrying what Revision's marks need, so its markers are ready
 * (fully opaque) and only a squadmate's task is see-through.
 */
function bobsState() {
  const state = stateWithTasks([revision.name, dandies.name]);
  for (const objective of revision.objs) {
    for (const requirement of requirementsOf(objective)) state.have[requirement.key] = 3;
  }
  return state;
}

// A task spot's radius in SVG units (map/markers.js).
const TASK_MARKER_RADIUS = 8.5;

/**
 * Every task marker on a page's map: its part, whether it's a squadmate's task you don't have
 * (.notmine), the opacity of its shape and badges, its shape, and the friend squares on it.
 * @param {import("playwright-core").Page} page
 */
function mapMarkers(page) {
  return page.$$eval("svg.map g.mk", (markers) => markers.map((marker) => {
    const body = marker.querySelector(":scope > g");
    const shape = body.querySelector(":scope > path");
    return {
      part: marker.getAttribute("data-part"),
      isNotMine: marker.classList.contains("notmine"),
      bodyOpacity: Number(body.getAttribute("opacity")),
      markerOpacity: Number(getComputedStyle(marker).opacity),
      shape: shape ? { d: shape.getAttribute("d"), fill: shape.getAttribute("fill"), stroke: shape.getAttribute("stroke") } : null,
      squares: [...marker.querySelectorAll(":scope > .squad-square")].map((square) => square.getAttribute("fill")),
      squaresInsideBody: body.querySelectorAll(".squad-square").length,
    };
  }));
}

/** The colour of the first friend box in a row, as the browser draws it. */
function swatchColor(page, rowSelector) {
  return page.locator(rowSelector + " .squad-swatch").first().evaluate((swatch) => getComputedStyle(swatch).backgroundColor);
}

test("three copies: drawings, task sharing, offline and back, and leaving", { timeout: 240_000 }, async (t) => {
  const ports = [await freePort(), await freePort(), await freePort()];
  const alice = new Player("Alice", "#e03131", ports[0], [ports[1], ports[2]], stateWithTasks([revision.name, glory.name, ballet.name]));
  const bob = new Player("Bob", "#1c7ed6", ports[1], [ports[0], ports[2]], bobsState());
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

    // ---- tasks: ☰ Tasks is on by default (ticket 26); "Share my tasks" and "Share my position" are
    // on by default too (ticket 17), and the settings file says so
    assert.equal(await bob.page.getAttribute(`[data-squad-tasks="${aliceId}"]`, "aria-pressed"), "true", "☰ Tasks on by default");
    assert.equal(await bob.page.locator(".squad-tasks").count(), 0, "the old Friends' tasks block is gone");
    // Cara keeps her tasks to herself here, so only Alice's show on Bob's list and map
    await cara.openSettings();
    await cara.answeredProfile(() => cara.page.uncheck("#sSquadShareTasks"));
    await cara.closeSettings();
    const caraShareOf = async (player) => (await player.scenario.api("/api/squad")).friends.find((friend) => friend.playerId === caraId)?.share;
    await eventually(async () => (await caraShareOf(bob))?.tasks === null, "Bob has Cara's share without tasks");

    await alice.openSettings();
    assert.equal(await alice.page.isChecked("#sSquadShareTasks"), true, "Share my tasks is on by default");
    assert.equal(await alice.page.isChecked("#sSquadSharePosition"), true, "Share my position is on by default");
    await alice.closeSettings();
    const aliceSquadSettings = alice.scenario.savedSettings().squad;
    assert.equal(aliceSquadSettings.shareTasks, true, "both switches are written to the settings file");
    assert.equal(aliceSquadSettings.sharePosition, true);
    // Bob switches it off: the "off in another copy" case (Alice sees none of his tasks below)
    await bob.openSettings();
    await bob.answeredProfile(() => bob.page.uncheck("#sSquadShareTasks"));
    await bob.closeSettings();
    await eventually(() => bob.scenario.savedSettings().squad?.shareTasks === false, "an 'off' is written as false");
    const bobRow = `#panel .task[data-task="${revision.id}"]`;
    await eventually(async () => (await bob.page.locator(bobRow + " .squad-box").count()) === 1, "Bob's Revision row has Alice's box", 8000);
    assert.equal((await bob.page.textContent(bobRow + " .squad-box")).trim(), "Alice");
    assert.equal(await swatchColor(bob.page, bobRow), "rgb(224, 49, 49)", "the box is in Alice's colour");
    assert.equal(await bob.page.locator(`#panel .task[data-task="${dandies.id}"] .squad-box`).count(), 0, "Dandies isn't shared");
    assert.equal(await bob.page.locator(`${bobRow}.notmine`).count(), 0, "Revision is Bob's own row");

    // ticket 27: Alice's square under the main spot of Revision (both have it), none on Dandies;
    // Revision is Bob's, so fully opaque
    const markers = await mapMarkers(bob.page);
    const revisionMarkers = markers.filter((marker) => marker.part.startsWith(revision.id + ":"));
    assert.equal(revisionMarkers.length, revision.objs.length);
    assert.ok(revisionMarkers.every((marker) => !marker.isNotMine && marker.bodyOpacity === 1), "Revision is fully opaque");
    assert.deepEqual(revisionMarkers.flatMap((marker) => marker.squares), ["#e03131"], "one square in Alice's colour, on the main spot only");
    assert.ok(markers.filter((marker) => marker.part.startsWith(dandies.id + ":")).every((marker) => !marker.squares.length), "none on Dandies");
    assert.equal(await bob.page.locator("svg.map .squad-dot").count(), 0, "the old bottom-left dots are gone");

    // Alice's tasks Bob doesn't have are rows of his list: crosshatched, in their default category
    const squadRows = bob.page.locator("#panel .cat .task.notmine");
    const squadTaskIds = new Set(await squadRows.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-task"))));
    assert.ok(squadTaskIds.has(ballet.id) || squadTaskIds.has(glory.id), "Alice's other tasks are listed");
    assert.ok(!squadTaskIds.has(revision.id) && !squadTaskIds.has(dandies.id), "Bob's own tasks are not repeated");
    for (const placed of await squadRows.evaluateAll((rows) =>
      rows.map((row) => ({ part: row.getAttribute("data-part"), cat: row.closest(".cat").getAttribute("data-cat"), image: getComputedStyle(row).backgroundImage })),
    )) {
      assert.equal(placed.cat, defaultCategoryIdOf(placed.part), `${placed.part} is in its default category`);
      assert.match(placed.image, /repeating-linear-gradient/, `${placed.part} is crosshatched`);
    }
    const squadTask = squadTaskIds.has(ballet.id) ? ballet : glory;
    const squadRow = `#panel .task.notmine[data-task="${squadTask.id}"]`;
    assert.equal((await bob.page.textContent(squadRow + " .squad-box")).trim(), "Alice", "with Alice's box");
    assert.match(await bob.page.textContent("#panel .phead"), /\+\d+ from squad/, "the header says how many are the squad's");
    const headerCount = Number((await bob.page.textContent("#panel .phead small")).match(/^(\d+) task/)[1]);
    assert.equal(headerCount, 2, "Bob's own count stays his two tasks");
    // ticket 27: on the map they are task markers like Bob's own (the category's shape and
    // colour), see-through, with Alice's opaque square under each part's main spot only
    const friendOnlyMarkers = (await mapMarkers(bob.page)).filter((marker) => marker.isNotMine);
    assert.ok(friendOnlyMarkers.length > 0, "Alice's other tasks are on Bob's map");
    assert.equal(await bob.page.locator("svg.map .friend-marker").count(), 0, "the old small friend markers are gone");
    const bobsCategories = bob.scenario.savedState().cats;
    for (const marker of friendOnlyMarkers) {
      assert.ok([ballet.id, glory.id].some((id) => marker.part.startsWith(id + ":")), `${marker.part} is one of Alice's tasks`);
      const category = bobsCategories.find((candidate) => candidate.id === defaultCategoryIdOf(marker.part));
      assert.equal(marker.shape.d, markerShapePath(category.icon, TASK_MARKER_RADIUS), `${marker.part} has its category's shape`);
      const isPossibleSpot = marker.shape.fill === "#fff";
      assert.equal(isPossibleSpot ? marker.shape.stroke : marker.shape.fill, category.color, `${marker.part} in its category's colour`);
      assert.equal(marker.bodyOpacity, 0.5, `${marker.part} is see-through`);
      assert.equal(marker.markerOpacity, 1, "the marker's group itself (and so its squares) is opaque");
      assert.equal(marker.squaresInsideBody, 0);
    }
    const friendOnlyParts = new Set(friendOnlyMarkers.map((marker) => marker.part));
    for (const part of friendOnlyParts) {
      const squares = friendOnlyMarkers.filter((marker) => marker.part === part).flatMap((marker) => marker.squares);
      assert.deepEqual(squares, ["#e03131"], `${part}: Alice's square under its main spot only`);
    }
    const squadMarker = bob.page.locator(`svg.map g.mk.notmine[data-part^="${squadTask.id}:"]`).first();
    await squadMarker.click({ force: true });
    await bob.page.waitForSelector(`${squadRow}.sel`);
    assert.equal((await bob.page.textContent("#pop h3")).trim(), squadTask.name, "clicking it selects it");
    assert.ok((await bob.page.locator("#fx > *").count()) > 0, "and flashes it");
    await bob.shot("squad-markers");
    await bob.page.keyboard.press("Escape");
    assert.equal(bob.scenario.savedList().tasks[squadTask.id], undefined, "nothing in Bob's saved data");
    if (SHOTS_DIR) await bob.page.evaluate(() => document.querySelector("#panel .cat").scrollIntoView());
    await bob.shot("squad-rows-in-list");

    // clicking selects it like his own: open, outlined, the popup; nothing can be ticked
    await bob.page.click(squadRow + " .trow");
    await bob.page.waitForSelector(`${squadRow}.sel .tbody`);
    await bob.page.waitForSelector("#pop h3");
    assert.equal((await bob.page.textContent("#pop h3")).trim(), squadTask.name);
    assert.equal(await bob.page.locator(`${squadRow} [data-tickbox], #pop [data-tickbox], ${squadRow} [data-tick], #pop [data-tick]`).count(), 0, "no working tick controls");
    const disabledTicks = await bob.page.locator(`${squadRow} .objs input, ${squadRow} .objs button, #pop .objs input, #pop .objs button`).evaluateAll((controls) =>
      controls.map((control) => [control.disabled, control.title]),
    );
    assert.ok(disabledTicks.length > 0);
    assert.ok(disabledTicks.every(([disabled, title]) => disabled && title === "Not on your task list"), "tick controls disabled");
    assert.equal(await bob.page.locator(`${squadRow} [data-move], ${squadRow} [data-act="remove"], ${squadRow} [data-addsub]`).count(), 0, "no Move to, Remove or sub-tasks");
    assert.match(await bob.page.textContent("#pop"), /Alice/, "the popup has Alice's box");
    await bob.shot("squad-row-selected");

    // pinning it: kept as a pin only, and listed under Pinned only
    await bob.page.click(squadRow + " .pinb");
    await eventually(() => bob.scenario.savedList().tasks[squadTask.id]?.pinned === true, "the pin is saved");
    assert.equal(bob.scenario.savedList().tasks[squadTask.id].active, false, "not on Bob's list");
    await bob.page.click('#panel [data-act="pinnedonly"]');
    assert.deepEqual(
      await bob.page.locator("#panel .cat .task").evaluateAll((rows) => [...new Set(rows.map((row) => row.getAttribute("data-task")))]),
      [squadTask.id],
      "Pinned only shows the pinned squad task",
    );
    await bob.page.click('#panel [data-act="pinnedonly"]');
    await bob.page.click(squadRow + " .pinb");
    await eventually(() => bob.scenario.savedList().tasks[squadTask.id]?.pinned === false, "unpinned");
    await bob.page.keyboard.press("Escape");

    // Alice ticks one objective; Bob's popup says "Alice 1/3"
    await alice.page.click(`#panel .task[data-task="${revision.id}"] .trow`);
    await alice.page.check(`#panel [data-tickbox="${revision.objs[0].id}"]`);
    await bob.page.click(bobRow + " .trow");
    await eventually(async () => /Alice 1\/3/.test((await bob.page.textContent("#pop")) || ""), "Bob's popup shows Alice's progress", 8000);
    assert.equal((await bob.page.textContent("#pop .squad-boxes")).trim(), "Alice", "the popup has Alice's box");
    await bob.shot("popup-also");

    // the filter: only tasks a shown friend also has (Alice's own tasks stay, she has them)
    await bob.page.click('[data-act="squadonly"]');
    const ownRows = "#panel .cat .task:not(.notmine)";
    assert.equal(await bob.page.locator(ownRows).count(), 1, "only Revision of Bob's own");
    assert.equal(await bob.page.locator(ownRows).first().getAttribute("data-task"), revision.id);
    assert.ok(await bob.page.locator("#panel .cat .task.notmine").count() > 0, "Alice's tasks stay listed");
    assert.equal(await bob.page.locator("svg.map g.mk:not(.notmine)").count(), revision.objs.length, "only Revision's markers of Bob's own");
    assert.ok(await bob.page.locator("svg.map g.mk.notmine").count() > 0, "Alice's tasks stay on the map");
    await bob.page.click('[data-act="squadonly"]');

    // Alice sees nothing of Bob's tasks (he shares none), with his toggle on by default
    assert.equal(await alice.page.locator("#panel .squad-boxes").count(), 0);
    assert.equal(await alice.page.locator("#panel .task.notmine").count(), 0);
    await bob.shot("panel-chips-and-filter");

    // Bob switches Alice's ☰ Tasks off: her rows and boxes go; on again, they're back
    await bob.page.click(`[data-squad-tasks="${aliceId}"]`);
    assert.equal(await bob.page.locator("#panel .task.notmine").count(), 0, "Alice's rows are gone");
    assert.equal(await bob.page.locator("#panel .squad-boxes").count(), 0);
    assert.equal(await bob.page.locator("svg.map g.mk.notmine, svg.map .squad-square").count(), 0, "her markers and squares are gone");
    await eventually(() => bob.scenario.savedState().squad?.friends[aliceId]?.tasks === false, "the choice is saved");
    await bob.page.click(`[data-squad-tasks="${aliceId}"]`);
    assert.ok(await bob.page.locator("#panel .task.notmine").count() > 0, "back on");
    assert.ok(await bob.page.locator("svg.map g.mk.notmine").count() > 0, "her markers are back");

    // ---- Cara goes offline: the others show "last seen"; she comes back with new data
    const caraSlug = cara.scenario.slug;
    await cara.scenario.app.stop();
    await eventually(async () => /last seen/.test(await alice.chip(caraId).textContent()), "Alice sees Cara's 'last seen'", 15_000);
    await eventually(async () => /last seen/.test(await bob.chip(caraId).textContent()), "Bob sees Cara's 'last seen'", 15_000);
    assert.equal(await alice.page.locator(".squad-chip").count(), 2, "she stays in the list");
    await alice.shot("chips-friend-offline");
    cara.scenario.app = await startApp({ slug: caraSlug, dataDir: cara.scenario.app.dataDir, keepData: true, env: cara.env });
    await cara.page.goto(cara.scenario.base + `/#/regular/map/${MAP}`);
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
    assert.equal(await alice.page.locator(".squad-boxes, .squad-square, .task.notmine, g.mk.notmine").count(), 0);
    const cache = JSON.parse(fs.readFileSync(path.join(alice.scenario.app.dataDir, "squad-task-map-squad.json"), "utf8"));
    assert.deepEqual(cache.friends || {}, {}, "friends' cache is cleared");
    assert.equal((await alice.scenario.api("/api/squad")).settings.joined, false);

    for (const player of players) player.scenario.assertNoPageErrors();
  } finally {
    for (const player of players) await player.scenario.stop().catch(() => {});
  }
});

// ---------------------------------------------------------------- hostile friends (QA round 2)

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

    const ownTasks = () => victim.page.locator("#panel .cat .task:not(.notmine)").count();
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
      // ✎ Draw, ☰ Tasks and (ticket 17) ◎ Pos
      assert.deepEqual(fits, [true, true, true], `${what}: all three toggles are inside the panel`);
    };
    const panelDoesNotOverflow = async (what) => {
      const [scroll, client] = await victim.page.evaluate(() => [document.querySelector("#panel").scrollWidth, document.querySelector("#panel").clientWidth]);
      assert.ok(scroll <= client, `${what}: the panel doesn't scroll sideways (${scroll} > ${client})`);
    };
    await togglesInsidePanel("desktop");
    await victim.shot("chips-long-name");

    // the wide friend's tasks are on by default (ticket 26): the "WWW…" box on the shared row
    // wraps inside the panel
    await eventually(async () => (await victim.page.locator("#panel .squad-box").count()) >= 1, "the wide friend's box on Glory");
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
  // saved "on", as in the owner's file; Sam's ☰ Tasks saved off (☰ Tasks is on by default since
  // ticket 26, and an explicit off is kept)
  state.squad = { friends: { [sharer.share.player.id]: { drawings: true, tasks: false } }, sharedOnly: true };
  const owner = new Player("Owner", "#e03131", await freePort(), fakes.map((fake) => fake.port), state);
  const ownTasks = () => owner.page.locator("#panel .cat .task:not(.notmine)").count();
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
