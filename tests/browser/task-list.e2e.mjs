// The task list on a map: adding tasks, ticking objectives against what's in your bag, pins,
// extracts, categories, selection, hiding the list, Settings and the phone layout.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  browserSuite, withScenario, readFixture, stateWithTasks, taskNamed, middleOfExtracts, waitUntil, MS2000_MARKER_ID,
} from "./harness.js";

browserSuite();

const revision = taskNamed("Revision - Streets of Tarkov"); // three "mark" objectives on Streets, one part
const glory = taskNamed("Glory to CPSU"); // split in two: scouting (go) and pick-up (retrieve)
const ballet = taskNamed("Ballet Lover");
const dandies = taskNamed("Dandies");
const FOUR_STREETS_TASKS = [revision.name, glory.name, ballet.name, dandies.name];

const markerCount = (page) => page.locator("svg.map g.mk").count();

test("adding a task by name lists it, and ticking a marker objective uses a marker from the bag; unticking gives it back", async (t) => {
  const [firstMark, secondMark] = revision.objs;
  await withScenario(t, { state: readFixture("fresh-v2-state.json") }, async (s) => {
    const page = s.page;
    await s.openMap("streets-of-tarkov");

    await page.fill("#addtask", "No Such Task At All");
    await page.press("#addtask", "Enter");
    await s.waitForToast("No task called “No Such Task At All”");

    await s.saving(async () => {
      await page.fill("#addtask", revision.name);
      await page.press("#addtask", "Enter");
    });
    await s.waitForToast(`Added “${revision.name}”`);
    const row = `#panel .task[data-task="${revision.id}"]`;
    assert.equal(await page.locator(row).count(), 1, "the task has a row");
    assert.equal(await markerCount(page), revision.objs.length, "one marker per objective");
    const entry = s.savedState().tasks[revision.id];
    assert.equal(entry.active, true);
    assert.equal(entry.source, "manual");
    assert.equal(await page.locator(row + " .bang").count(), 1, "not ready: no marker in the bag");

    // Put one marker in the bag (Bring list).
    await s.saving(() => page.click('#panel [data-tab="bring"]'));
    const markerLine = `#panel .bl[data-key="${MS2000_MARKER_ID}"]`;
    assert.equal(await page.textContent(markerLine + " .need"), "need 3");
    await s.saving(() => page.click(markerLine + ' [data-have="1"]'));
    assert.equal(await page.inputValue(markerLine + " [data-haveset]"), "1");
    await s.saving(() => page.click('#panel [data-tab="tasks"]'));
    assert.equal(await page.locator(row + " .bang").count(), 0, "ready once there's a marker in the bag");

    // Tick the first marker objective: one marker comes out of the bag.
    await page.click(row + " .trow");
    await s.saving(() => page.check(`#panel [data-tickbox="${firstMark.id}"]`));
    let saved = s.savedState();
    assert.equal(saved.ticks[firstMark.id], true);
    assert.equal(saved.have[MS2000_MARKER_ID], 0, "ticking a marker objective takes one from the bag");
    assert.deepEqual(saved.used, { [firstMark.id]: 1 });

    // A second tick with an empty bag takes nothing; unticking it gives nothing back.
    await s.saving(() => page.check(`#panel [data-tickbox="${secondMark.id}"]`));
    saved = s.savedState();
    assert.equal(saved.have[MS2000_MARKER_ID], 0);
    assert.deepEqual(saved.used, { [firstMark.id]: 1 });
    await s.saving(() => page.uncheck(`#panel [data-tickbox="${secondMark.id}"]`));
    assert.equal(s.savedState().have[MS2000_MARKER_ID], 0, "unticking only gives back what that tick took");

    // Unticking the first gives its marker back.
    await s.saving(() => page.uncheck(`#panel [data-tickbox="${firstMark.id}"]`));
    saved = s.savedState();
    assert.equal(saved.have[MS2000_MARKER_ID], 1, "unticking gives the marker back");
    assert.deepEqual(saved.used, {});
    assert.equal(saved.ticks[firstMark.id], undefined);

    await s.saving(() => page.click('#panel [data-tab="bring"]'));
    assert.equal(await page.inputValue(markerLine + " [data-haveset]"), "1");
    assert.equal(await page.textContent(markerLine + " .need"), "need 3");
  });
});

test("a pinned task stays alone on the list, the map and the Bring list with Pinned only on", async (t) => {
  await withScenario(t, { state: stateWithTasks(FOUR_STREETS_TASKS) }, async (s) => {
    const page = s.page;
    await s.openMap("streets-of-tarkov");
    const allMarkers = await markerCount(page);

    await s.saving(() => page.click(`#panel .task[data-task="${ballet.id}"] [data-act="pin"]`));
    assert.equal(await page.locator(`#panel .task[data-task="${ballet.id}"] .pinb.on`).count(), 1);
    assert.equal(await page.textContent('#panel [data-act="pinnedonly"] .n'), "1");
    assert.equal(s.savedState().tasks[ballet.id].pinned, true);
    assert.equal(await page.locator('#panel [data-act="clearpins"]').count(), 1, "Clear pins is offered");

    await s.saving(() => page.click("#bpin"));
    assert.equal(await page.getAttribute("#bpin", "aria-pressed"), "true");
    assert.equal(await page.getAttribute('#panel [data-act="pinnedonly"]', "aria-pressed"), "true");
    const listed = await page.$$eval("#panel .tasks .task", (rows) => [...new Set(rows.map((row) => row.dataset.task))]);
    assert.deepEqual(listed, [ballet.id], "only the pinned task is listed");
    const pinnedMarkers = await markerCount(page);
    assert.ok(pinnedMarkers > 0 && pinnedMarkers < allMarkers, `only its markers (${pinnedMarkers} of ${allMarkers})`);
    assert.equal(s.savedState().pinnedOnly, true);

    await s.saving(() => page.click('#panel [data-tab="bring"]'));
    assert.match(await page.textContent("#panel .bring"), /Showing pinned tasks only\./);
    const bringFor = await page.$$eval("#panel .bl .bt", (lines) => lines.map((line) => line.textContent));
    assert.ok(bringFor.length > 0 && bringFor.every((text) => text.includes(ballet.name)), "the Bring list is only for the pinned task");
    await s.saving(() => page.click('#panel [data-tab="tasks"]'));

    await s.saving(() => page.click('#panel [data-act="pinnedonly"]'));
    assert.equal(await page.getAttribute("#bpin", "aria-pressed"), "false");
    assert.equal(await markerCount(page), allMarkers, "every marker is back");
  });
});

test("clicking an extract on the map marks it, clicking again or Clear unmarks it", async (t) => {
  await withScenario(t, { state: stateWithTasks(FOUR_STREETS_TASKS) }, async (s) => {
    const page = s.page;
    await s.openMap("streets-of-tarkov");
    const marked = () => page.$$eval("svg.map g.ex.on", (groups) => groups.map((group) => group.dataset.name));

    await s.saving(() => s.clickExtract("Crash Site"));
    assert.deepEqual(await marked(), ["Crash Site"]);
    assert.deepEqual(s.savedState().prefs["streets-of-tarkov"].extMarked, { "Crash Site": true });
    assert.equal(await page.textContent('#panel [data-act="clearext"]'), "Clear 1 marked");

    await s.saving(() => s.clickExtract("Crash Site"));
    assert.deepEqual(await marked(), []);
    assert.deepEqual(s.savedState().prefs["streets-of-tarkov"].extMarked, {});

    await s.saving(() => s.clickExtract("Collapsed Crane"));
    await s.saving(() => s.clickExtract("Damaged House"));
    assert.deepEqual((await marked()).sort(), ["Collapsed Crane", "Damaged House"]);
    await s.saving(() => page.click('#panel [data-act="clearext"]'));
    assert.deepEqual(await marked(), []);
    assert.deepEqual(s.savedState().prefs["streets-of-tarkov"].extMarked, {});
  });
});

test("Move to puts a part in another category, Re-sort everything puts it back with Undo, and Don't split joins a split task", async (t) => {
  const state = stateWithTasks([glory.name, "Spotter"]);
  state.cats.splice(state.cats.length - 1, 0, { id: "c-night-raids", name: "Night raids", color: "#e599f7", icon: "hexagon", visible: true, builtin: null });
  const scoutingPart = glory.id + ":go";
  const rowOf = (part) => `#panel .task[data-part="${part}"]`;
  const categoryOf = (page, part) => page.$eval(rowOf(part), (row) => row.closest(".cat").dataset.cat);
  await withScenario(t, { state }, async (s) => {
    const page = s.page;
    await s.openMap("streets-of-tarkov");
    assert.equal(await categoryOf(page, scoutingPart), "b-go", "scouting starts in Scout & extract");

    await page.click(rowOf(scoutingPart) + " .trow");
    await s.saving(() => page.selectOption(`#panel select[data-move="${scoutingPart}"]`, "c-night-raids"));
    assert.equal(await categoryOf(page, scoutingPart), "c-night-raids");
    assert.deepEqual(s.savedState().tasks[glory.id].partCats, { [scoutingPart]: { cat: "c-night-raids", manual: true } });
    assert.equal(await page.locator(rowOf(scoutingPart) + ' [data-act="unmove"]').count(), 1, "reset is offered");

    await page.click("#panel details.menu summary");
    await s.saving(() => page.click('#panel [data-act="resortall"]'));
    assert.match(s.dialogs.at(-1), /^Put every part back into its default category\?/);
    assert.equal(await categoryOf(page, scoutingPart), "b-go", "Re-sort everything undoes the move");
    assert.deepEqual(s.savedState().tasks[glory.id].partCats, {});
    await s.waitForToast("Re-sorted everything");
    assert.equal(await page.textContent("#toastAct"), "Undo");
    await s.saving(() => page.click("#toastAct"));
    assert.equal(await categoryOf(page, scoutingPart), "c-night-raids", "Undo brings the move back");
    assert.deepEqual(s.savedState().tasks[glory.id].partCats, { [scoutingPart]: { cat: "c-night-raids", manual: true } });

    // Don't split: one row for the whole task. (A move stored on one part doesn't apply to the
    // whole task: HANDOFF §11, kept as is.)
    const gloryRows = () => page.$$eval(`#panel .task[data-task="${glory.id}"]`, (rows) => rows.map((row) => row.dataset.part));
    assert.deepEqual((await gloryRows()).sort(), [glory.id + ":go", glory.id + ":retrieve"]);
    await s.saving(() => page.click(`#panel [data-nosplit="${glory.id}"]`)); // the row closes: click, not check()
    assert.deepEqual(await gloryRows(), [glory.id + ":*"]);
    assert.equal(await page.locator(`#panel .task[data-task="${glory.id}"] .partof`).count(), 0);
    assert.equal(await categoryOf(page, glory.id + ":*"), "b-retrieve", "the whole task takes the first kind of work by precedence");
    assert.equal(s.savedState().tasks[glory.id].noSplit, true);

    await page.click(rowOf(glory.id + ":*") + " .trow");
    await s.saving(() => page.click(`#panel [data-nosplit="${glory.id}"]`));
    assert.deepEqual((await gloryRows()).sort(), [glory.id + ":go", glory.id + ":retrieve"]);
    assert.equal(s.savedState().tasks[glory.id].noSplit, false);
  });
});

test("selecting a row highlights it and flashes its markers; a marker click selects too; Esc and an empty-map click deselect", async (t) => {
  const part = revision.id + ":*";
  await withScenario(t, { state: stateWithTasks(FOUR_STREETS_TASKS) }, async (s) => {
    const page = s.page;
    await s.openMap("streets-of-tarkov");
    const selection = () => page.evaluate(() => ({
      rows: [...document.querySelectorAll("#panel .task.sel")].map((row) => row.dataset.part),
      rings: document.querySelectorAll("#fx .ping").length,
      popup: getComputedStyle(document.getElementById("pop")).display !== "none" ? document.querySelector("#pop h3")?.textContent : null,
    }));

    await page.click(`#panel .task[data-part="${part}"] .trow`);
    assert.deepEqual(await selection(), { rows: [part], rings: revision.objs.length, popup: revision.name });
    const rings = await page.evaluate(() => {
      const stage = document.getElementById("stage").getBoundingClientRect();
      return [...document.querySelectorAll("#fx .ping")].map((ping) => {
        const box = ping.getBoundingClientRect();
        const halo = getComputedStyle(ping.querySelector("i.halo"));
        const wave = getComputedStyle(ping.querySelector("i.wave"));
        return {
          onMap: box.left >= stage.left && box.left <= stage.right && box.top >= stage.top && box.top <= stage.bottom,
          animations: `${halo.animationName} ${halo.animationIterationCount} / ${wave.animationName} ${wave.animationIterationCount}`,
        };
      });
    });
    for (const ring of rings) assert.deepEqual(ring, { onMap: true, animations: "halo infinite / wave infinite" }, "each selected marker flashes, on the map");
    const rowBox = await page.locator("#panel .task.sel .trow-wrap").boundingBox();
    const panelBox = await page.locator("#panel").boundingBox();
    assert.ok(rowBox.y >= panelBox.y && rowBox.y + rowBox.height <= panelBox.y + panelBox.height, "the selected row is in view");

    await page.keyboard.press("Escape");
    assert.deepEqual(await selection(), { rows: [], rings: 0, popup: null }, "Esc deselects");
    assert.equal(await page.locator("#panel .tbody").count(), 0, "Esc also closes the row it had opened");
    await page.click(`#panel .task[data-part="${part}"] .trow`);
    assert.deepEqual((await selection()).rows, [part], "the next click on that row selects it again");
    await page.click("#pop .x");
    assert.deepEqual(await selection(), { rows: [], rings: 0, popup: null }, "the popup's × deselects");
    assert.equal(await page.locator("#panel .tbody").count(), 0, "the popup's × closes the row too");

    // Click a marker on the map.
    const markerPoint = await page.evaluate(() => {
      for (const marker of document.querySelectorAll("svg.map g.mk")) {
        const box = marker.querySelector("path").getBoundingClientRect();
        const x = box.left + box.width / 2, y = box.top + box.height / 2;
        if (document.elementFromPoint(x, y)?.closest("g.mk") === marker) return { x, y };
      }
      return null;
    });
    assert.ok(markerPoint, "a marker can be clicked");
    await page.mouse.click(markerPoint.x, markerPoint.y);
    await page.waitForSelector("#panel .task.sel");
    const picked = await selection();
    assert.equal(picked.rows.length, 1);
    const pickedName = await page.$eval("#panel .task.sel .nm", (name) => name.firstChild.textContent);
    assert.equal(picked.popup, pickedName, "the popup shows the clicked marker's task");
    assert.ok(picked.rings >= 1);

    const empty = await s.emptyMapPoint();
    assert.ok(empty, "an empty spot on the map");
    await page.mouse.click(empty.x, empty.y);
    assert.deepEqual(await selection(), { rows: [], rings: 0, popup: null }, "an empty-map click deselects");

    // Deselecting closes the row it had opened, so the next click on that row selects it again.
    assert.equal(await page.locator("#panel .tbody").count(), 0, "an empty-map click closes the row");
    const otherRow = part;
    await page.click(`#panel .task[data-part="${otherRow}"] .trow`);
    assert.deepEqual((await selection()).rows, [otherRow]);
    await page.click(`#panel .task[data-part="${otherRow}"] .trow`);
    assert.deepEqual(await selection(), { rows: [], rings: 0, popup: null });
    assert.equal(await page.locator("#panel .tbody").count(), 0);
  });
});

test("Hide gives the map the whole window and keeps the view; ◂ Tasks brings the list back", async (t) => {
  await withScenario(t, { state: stateWithTasks(FOUR_STREETS_TASKS) }, async (s) => {
    const page = s.page;
    await s.openMap("streets-of-tarkov");
    await page.click("#zin");
    await s.nextFrame();
    const view = async () => {
      const box = await s.viewBox();
      return { centreX: box.x + box.w / 2, centreY: box.y + box.h / 2, zoom: await s.zoom(), width: (await page.locator("svg.map").boundingBox()).width };
    };
    const assertSameView = (before, after, what) => {
      assert.ok(Math.abs(before.centreX - after.centreX) < 0.01 && Math.abs(before.centreY - after.centreY) < 0.01, `${what}: same centre`);
      assert.ok(Math.abs(before.zoom / after.zoom - 1) < 1e-6, `${what}: same zoom`);
    };

    const shown = await view();
    await s.saving(() => page.click('#panel [data-act="hidepanel"]'));
    await page.waitForFunction((width) => document.querySelector("svg.map").getBoundingClientRect().width > width + 100, shown.width);
    await s.nextFrame();
    assert.equal(await page.locator(".app.nopanel").count(), 1);
    assert.equal(await page.isVisible("#panel"), false);
    assert.equal(await page.isVisible("#showpanel"), true);
    const hidden = await view();
    assertSameView(shown, hidden, "hiding the list");
    assert.equal(s.savedState().panelHidden, true);

    await s.reload();
    await s.waitForMap("streets-of-tarkov");
    assert.equal(await page.isVisible("#panel"), false, "still hidden after a reload");

    const beforeShow = await view();
    await s.saving(() => page.click("#showpanel"));
    await page.waitForFunction((width) => document.querySelector("svg.map").getBoundingClientRect().width < width - 100, beforeShow.width);
    await s.nextFrame();
    assert.equal(await page.isVisible("#panel"), true);
    assert.equal(await page.isVisible("#showpanel"), false);
    assertSameView(beforeShow, await view(), "showing the list");
    assert.equal(s.savedState().panelHidden, false);
  });
});

/** The two Settings checkboxes are normal squares at the left of the first line of their label (they were slivers). */
async function assertSettingsCheckboxesLookNormal(page) {
  for (const id of ["sFollow", "sCenter"]) {
    const box = await page.locator("#" + id).boundingBox();
    const label = await page.locator(`label:has(#${id})`).boundingBox();
    assert.ok(box.width >= 16 && box.height >= 16 && Math.abs(box.width - box.height) < 1, `#${id} is a normal square checkbox, not a sliver (${box.width}x${box.height})`);
    assert.ok(box.x - label.x < 12, `#${id} sits at the left of its label`);
    const textLeft = await page.evaluate((checkboxId) => {
      const text = [...document.getElementById(checkboxId).parentElement.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const range = document.createRange();
      range.selectNodeContents(text);
      return Math.min(...[...range.getClientRects()].map((rect) => rect.left));
    }, id);
    assert.ok(textLeft >= box.x + box.width - 1, `#${id}'s text starts to the right of the box, not under it`);
  }
}

test("Settings saves Follow my position and Center on me, and the toolbar follows", async (t) => {
  await withScenario(t, { state: stateWithTasks([dandies.name]) }, async (s) => {
    const page = s.page;
    await s.openMap("streets-of-tarkov");
    assert.equal(await page.getAttribute("#bfollow", "aria-pressed"), "false");

    await page.click("#settings");
    await page.waitForSelector(".modal #sSave");
    assert.equal(await page.textContent(".modal h3"), "Settings");
    assert.equal(await page.inputValue("#sMode"), "regular");
    assert.equal(await page.isChecked("#sFollow"), true, "Follow my position is on by default");
    assert.equal(await page.isChecked("#sCenter"), false, "Center on me is off by default");
    await assertSettingsCheckboxesLookNormal(page);
    await page.locator("label:has(#sCenter)").click({ position: { x: 150, y: 8 } }); // the label text toggles it too
    assert.equal(await page.isChecked("#sCenter"), true, "clicking the label text ticks the box");
    await page.uncheck("#sCenter");
    const taskCount = (await s.api("/api/data")).tasks.length;
    assert.match(await page.textContent(".modal"), new RegExp(`PvP · ${taskCount} tasks · downloaded just now`));
    assert.match(await page.textContent(".modal"), /No key yet/);

    await page.uncheck("#sFollow");
    await page.check("#sCenter");
    await s.answered("PUT", "/api/settings", () => page.click("#sSave"));
    await s.waitForToast("Settings saved");
    assert.equal(await page.locator(".modal").count(), 0, "the dialog closes");
    assert.equal(await page.getAttribute("#bfollow", "aria-pressed"), "true", "the toolbar's Follow shows Center on me");
    const settings = (await s.status()).settings;
    assert.equal(settings.followPosition, false);
    assert.equal(settings.autoCenter, true);
    assert.equal(s.savedSettings().followPosition, false);
    assert.equal(s.savedSettings().autoCenter, true);

    await page.click("#settings");
    await page.waitForSelector(".modal #sClose");
    assert.equal(await page.isChecked("#sFollow"), false);
    assert.equal(await page.isChecked("#sCenter"), true);
    await page.click("#sClose");
    assert.equal(await page.locator(".modal").count(), 0);
  });
});

test("at phone width the list sits under the map, Hide isn't offered, and Find me works", async (t) => {
  await withScenario(t, { phone: true, state: stateWithTasks(FOUR_STREETS_TASKS) }, async (s) => {
    const page = s.page;
    // A position from before the page opened: shown, but not pulsing.
    const middle = middleOfExtracts("streets-of-tarkov");
    s.dropGps(middle.x, 1, middle.z);
    await waitUntil(async () => (await s.status()).gps, { what: "the server to read the GPS screenshot" });
    await s.openMap("streets-of-tarkov");
    assert.equal(await page.$eval(".app", (app) => getComputedStyle(app).display), "block");
    const stage = await page.locator("#stage").boundingBox();
    const panel = await page.locator("#panel").boundingBox();
    assert.ok(panel.y >= stage.y + stage.height - 1, "the list is under the map");
    assert.equal(await page.isVisible('#panel [data-act="hidepanel"]'), false, "no Hide button");
    assert.equal(await page.isVisible("#showpanel"), false);
    assert.equal(await page.isVisible("#bfindme .lbl"), false, "toolbar labels are hidden");

    await page.tap(`#panel .task[data-part="${revision.id}:*"] .trow`);
    await page.waitForSelector(`#panel .task.sel[data-part="${revision.id}:*"]`);

    assert.equal(await page.locator("svg.map g[data-r]").count(), 1, "your marker is drawn");
    assert.equal(await page.locator(".findme-ring").count(), 0, "no pulse for a position from before");
    await page.tap("#bfindme");
    assert.equal(await page.locator(".findme-ring").count(), 3, "Find me pulses");

    await page.tap("#settings");
    await page.waitForSelector(".modal #sSave");
    await assertSettingsCheckboxesLookNormal(page);
  });
});
