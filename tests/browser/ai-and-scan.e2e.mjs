// The two OpenAI features, against the offline mock: AI Categorize and Scan tasks.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  browserSuite, withScenario, readFixture, stateWithTasks, taskNamed, taskNameOf, taskEntry, assertMatchesRecorded, OPENAI_TEST_KEY,
} from "./harness.js";

browserSuite();

const ballet = taskNamed("Ballet Lover");
const audiophile = taskNamed("Audiophile");
const dandies = taskNamed("Dandies");
const glory = taskNamed("Glory to CPSU");
const shortage = taskNamed("Shortage");

test("AI Categorize: add the key, ask, apply the answer and undo it", async (t) => {
  // The mock moves every part with a key into a new "Key runs" category: here Ballet Lover (one
  // part) and both parts of Audiophile. Revision and Glory to CPSU need no key.
  const state = stateWithTasks([ballet.name, audiophile.name, "Revision - Streets of Tarkov", glory.name]);
  const keyedParts = [ballet.id + ":*", audiophile.id + ":go", audiophile.id + ":retrieve"];
  await withScenario(t, { state }, async (s) => {
    const page = s.page;
    await s.openMap("streets-of-tarkov");
    assert.match(await page.textContent("#panel .aihead"), /not set up/);

    await page.click('#panel [data-ai-act="key"]');
    await page.waitForSelector(".modal #aikey");
    await page.fill("#aikey", "sk-wrong_1234567890abcdefghijkl");
    await s.answered("PUT", "/api/ai/key", () => page.click("#aisave"));
    await page.waitForFunction(() => {
      const text = document.getElementById("aierr")?.textContent;
      return text && text !== "Testing key…";
    });
    const refusal = await page.textContent("#aierr");
    assert.equal(await page.locator(".modal #aikey").count(), 1, "a wrong key keeps the dialog open");

    await page.fill("#aikey", OPENAI_TEST_KEY);
    await s.answered("PUT", "/api/ai/key", () => page.click("#aisave"));
    await s.waitForToast("OpenAI key saved");
    // Ticket 06: the first key brings the one-time "what is sent" notice for reading extracts.
    await page.waitForSelector(".modal #exOn");
    assert.match(await page.textContent(".modal"), /first in-raid screenshot of each raid/);
    await s.answered("PUT", "/api/settings", () => page.click("#exOn"));
    await page.waitForFunction(() => !document.querySelector(".modal"));
    assert.match(await page.textContent("#panel .aihead .s"), /gpt-5\.4-mini/);
    const ai = (await s.status()).ai;
    assert.equal(ai.hasKey, true);
    assert.notEqual(ai.key, OPENAI_TEST_KEY, "the page never gets the whole key back");
    assertMatchesRecorded("ai-wrong-key-message", { refusal });

    await page.fill("#aitext", "Make a category called Key runs for parts that need a key on this map");
    await page.click('#panel [data-ai-act="send"]');
    await page.waitForSelector("#panel .msg.bot[data-mi]", { timeout: 30_000 });
    assert.match(await page.textContent("#panel .msg.bot[data-mi]"), /^Moved 3 parts that need keys\./);
    const proposed = await page.$$eval("#panel .msg .ch li", (items) => items.map((item) => item.textContent));
    assert.equal(proposed.length, keyedParts.length);
    assert.ok(proposed.every((line) => /^(Ballet Lover|Audiophile)\b.*: .+ → Key runs/.test(line)), proposed.join("\n"));
    assertMatchesRecorded("ai-proposed-changes", proposed);

    await s.saving(() => page.click('#panel [data-ai-act="apply"]'));
    await s.waitForToast("Applied 3 changes");
    assert.equal(await page.textContent("#panel .msg .acts2 .ok"), "Applied 3 changes");
    const keyRuns = s.savedState().cats.find((category) => category.name === "Key runs");
    assert.ok(keyRuns, "a Key runs category was made");
    assert.equal(keyRuns.color, "#4dabf7");
    assert.equal(keyRuns.icon, "star");
    const inKeyRuns = await page.$$eval(`#panel .cat[data-cat="${keyRuns.id}"] .task`, (rows) => rows.map((row) => row.dataset.part).sort());
    assert.deepEqual(inKeyRuns, [...keyedParts].sort());
    const saved = s.savedState();
    for (const part of keyedParts) assert.deepEqual(saved.tasks[part.split(":")[0]].partCats[part], { cat: keyRuns.id, manual: true });

    await s.saving(() => page.click('#panel [data-ai-act="undo"]'));
    await s.waitForToast("Undone");
    assert.match(await page.textContent("#panel .msg .acts2"), /Undone/);
    const undone = s.savedState();
    assert.equal(undone.cats.some((category) => category.name === "Key runs"), false, "the new category is gone");
    assert.deepEqual(undone.tasks[ballet.id].partCats, {});
    assert.deepEqual(undone.tasks[audiophile.id].partCats, {});
    assert.equal(await page.locator(`#panel .cat[data-cat="${keyRuns.id}"]`).count(), 0);
  });
});

test("Scan without an OpenAI key asks for the key first", async (t) => {
  await withScenario(t, { state: readFixture("fresh-v2-state.json") }, async (s) => {
    const page = s.page;
    await s.openPicker();
    await page.click("#pscan");
    await s.waitForToast("Scanning reads your screenshots with OpenAI — add your key first");
    await page.waitForSelector(".modal #aikey");
    assert.equal(await page.isHidden("#capbar"), true, "no capture starts");
  });
});

test("Scan: captured screenshots are read, confirming replaces the list and deletes them, cancelling keeps them", async (t) => {
  const state = stateWithTasks([dandies.name, glory.name]);
  state.tasks[shortage.id] = taskEntry({ active: false, partCats: { "*": { cat: "unsorted", manual: true } } });
  state.ticks[glory.objs[0].id] = true;
  state.subs.push({ id: "sub-glory", task: glory.id, text: "glory sub", done: false, map: null, x: null, z: null, f: "" });
  state.subs.push({ id: "sub-dandies", task: dandies.id, text: "dandies sub", done: false, map: null, x: null, z: null, f: "" });
  await withScenario(t, { state, settings: { openaiKey: OPENAI_TEST_KEY, extractsNoticeSeen: true } }, async (s) => {
    const page = s.page;
    await s.openPicker();
    assert.equal(await page.textContent(".picker .lede"), "2 active tasks. Pick a map.");

    // Capture: each new screenshot shows up as a thumbnail.
    await s.answered("POST", "/api/scan/start", () => page.click("#pscan"));
    await page.waitForSelector("#capbar:not([hidden]) #capdone[disabled]");
    assert.match(await page.textContent("#capbar"), /0 captured/);
    s.dropScreenshot("2026-10-05[15-00]_1.png");
    await page.waitForSelector("#capbar #capdone:not([disabled])");
    assert.equal(await page.textContent("#capdone"), "Done (1)");
    assert.equal(await page.locator("#capbar .th img").count(), 1);

    // Read (the mock's vision answer: 8 rows, one misspelled, one not a task) and review.
    await page.click("#capdone");
    await page.waitForSelector(".modal #rvok", { timeout: 30_000 });
    const review = await page.evaluate(() => ({
      note: document.querySelector(".modal .mnote").textContent,
      sections: [...document.querySelectorAll(".modal h4")].map((heading) => heading.textContent),
      newTasks: [...document.querySelectorAll(".modal [data-add]")].map((box) => box.closest("label").textContent.trim()),
      spellingFixed: document.querySelectorAll(".modal .tag.warnt").length,
      button: document.getElementById("rvok").textContent,
    }));
    assert.equal(review.button, "Update list & delete 1 screenshot");
    assert.equal(review.note, "Read 8 rows from 1 screenshot. New tasks are added. Tasks on your list that aren't in these screenshots are removed.");
    assert.equal(review.spellingFixed, 1, "“Seizing the Initative” is matched with its spelling fixed");
    assertMatchesRecorded("scan-review", review);

    await s.saving(() => page.click("#rvok"));
    await s.waitForToast("Added 6 tasks · removed 1 · deleted 1 screenshot");
    assert.deepEqual(s.screenshotFiles(), [], "the confirmed screenshot is deleted");
    const saved = s.savedState();
    const activeNames = Object.entries(saved.tasks).filter(([, entry]) => entry.active).map(([id]) => taskNameOf(id)).sort();
    assert.deepEqual(activeNames, ["A Fuel Matter", "Anesthesia", "Ballet Lover", "Booze", "Dandies", "Seizing the Initiative", "The Good Times - Part 1"]);
    assert.equal(saved.tasks[glory.id], undefined, "a task not in the scan is forgotten");
    assert.equal(saved.ticks[glory.objs[0].id], undefined, "with its ticks");
    assert.deepEqual(saved.subs.map((sub) => sub.id), ["sub-dandies"], "and its sub-tasks");
    assert.equal(saved.tasks[shortage.id].active, false, "an inactive task's entry is kept");
    assert.equal(saved.tasks[dandies.id].source, "manual", "a task already on the list keeps its source");
    assert.equal(await page.isHidden("#capbar"), true);

    // Cancel at the review: nothing is deleted or changed.
    await s.answered("POST", "/api/scan/start", () => page.click("#pscan"));
    s.dropScreenshot("2026-10-05[15-05]_2.png");
    await page.waitForSelector("#capbar #capdone:not([disabled])");
    await page.click("#capdone");
    await page.waitForSelector(".modal #rvcancel", { timeout: 30_000 });
    const beforeCancel = s.savedState();
    await s.answered("POST", "/api/scan/cancel", () => page.click("#rvcancel"));
    assert.equal(await page.locator(".modal").count(), 0);
    assert.equal(await page.isHidden("#capbar"), true);
    assert.deepEqual(s.screenshotFiles(), ["2026-10-05[15-05]_2.png"], "Cancel keeps the screenshot");
    assert.deepEqual(s.savedState(), beforeCancel, "Cancel changes nothing");

    // Cancel while capturing.
    await s.answered("POST", "/api/scan/start", () => page.click("#pscan"));
    s.dropScreenshot("2026-10-05[15-10]_3.png");
    await page.waitForSelector("#capbar #capdone:not([disabled])");
    await s.answered("POST", "/api/scan/cancel", () => page.click("#capcancel"));
    assert.equal(await page.isHidden("#capbar"), true);
    assert.deepEqual(s.screenshotFiles(), ["2026-10-05[15-05]_2.png", "2026-10-05[15-10]_3.png"]);
  });
});
