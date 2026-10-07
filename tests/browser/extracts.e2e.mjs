// Ticket 06: "my extracts" read from the first in-raid screenshot (OpenAI vision, here the mock).
// The mock's preset list is for Customs: Crossroads, Old Gas Station Gate and Transit to Factory
// match, "Administraton Gate" is misread by a letter and still matches, "Imaginary Gate" is on no
// map. Model calls are counted in the mock's request log (lines ending "extracts=true").
import assert from "node:assert/strict";
import { test } from "node:test";
import { browserSuite, withScenario, waitUntil, sleep, middleOfExtracts, OPENAI_TEST_KEY, MOCK_PORT } from "./harness.js";

browserSuite();

const LOG_WAIT = { timeout: 15_000 }; // one 5 s log check, the 500 ms save delay, and some slack
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const PRESET_MARKS = ["Administration Gate", "Crossroads", "Old Gas Station Gate", "Transit to Factory"];

async function extractReads() {
  const log = await (await fetch(MOCK + "/log")).json();
  return log.filter((line) => line.includes("extracts=true")).length;
}

async function setExtractList(list) {
  await fetch(MOCK + "/set-extracts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(list) });
}

async function startRaidOnCustoms(s) {
  s.appLog("scene preset path:maps/customs_preset.bundle rcid:x");
  s.appLog("GameStarted:12.3 real:4.5");
  await s.page.waitForSelector("#navinfo .raid", LOG_WAIT);
}

const withKey = { settings: { openaiKey: OPENAI_TEST_KEY, extractsNoticeSeen: true } };

test("the first raid screenshot marks my extracts, once per raid, and raid end clears them", async (t) => {
  await withScenario(t, withKey, async (s) => {
    const page = s.page;
    await s.openMap("customs");
    const before = await extractReads();
    const middle = middleOfExtracts("customs");

    s.step("raid 1: the first screenshot is read");
    await startRaidOnCustoms(s);
    await s.saving(async () => {
      s.dropGps(middle.x, 1.5, middle.z, undefined, { realPicture: true });
      await s.waitForToast("Marked 4 extracts from your screenshot (1 not recognised: Imaginary Gate)");
    });
    const marks = s.savedState().prefs.customs.extMarked;
    assert.deepEqual(Object.keys(marks).sort(), PRESET_MARKS);
    assert.deepEqual(marks["Old Gas Station Gate"], { auto: true, note: "Requires paracord" });
    assert.deepEqual(await page.$$eval("svg.map g.ex.on", (groups) => groups.map((group) => group.dataset.name).sort()), PRESET_MARKS, "marked extracts are drawn even when their kind's chip is off");
    assert.equal(await page.locator("#panel .exlist .tag.ai").count(), 4, "an AI tag on each auto mark");
    assert.match(await page.textContent("#panel .exlist"), /Requires paracord/);

    s.step("closest extract uses the auto marks at once");
    await page.waitForSelector("#gpsclosest");
    assert.ok(PRESET_MARKS.includes((await page.textContent("#gpsclosest")).split(" · ")[0]));
    assert.match(await page.textContent("#gpsbar-closest"), /Closest:/);

    s.step("later screenshots are not read again");
    await s.dropGpsAndWait(middle.x + 20, 1.5, middle.z + 20);
    await sleep(500);
    assert.equal((await extractReads()) - before, 1, "one model call for the raid");

    s.step("clicking an auto-marked extract unmarks it");
    await s.saving(() => s.clickExtract("Crossroads"));
    assert.equal("Crossroads" in s.savedState().prefs.customs.extMarked, false);

    s.step("raid end clears the marks; the next raid reads again");
    await s.saving(async () => {
      s.appLog("PrepareSelectedProfileLocally ProfileId:0 AccountId:1");
      await s.waitForToast("Raid over");
    }, LOG_WAIT);
    assert.deepEqual(s.savedState().prefs.customs.extMarked, {});
    await startRaidOnCustoms(s);
    await s.saving(async () => {
      s.dropGps(middle.x, 1.5, middle.z, undefined, { realPicture: true });
      await s.waitForToast("Marked 4 extracts");
    });
    assert.equal((await extractReads()) - before, 2, "one model call per raid");
  });
});

test("a screenshot without the extract list is skipped and the next one is tried, up to three", async (t) => {
  await withScenario(t, withKey, async (s) => {
    const before = await extractReads();
    const middle = middleOfExtracts("customs");
    const page = s.page;
    await setExtractList({ visible: false, extracts: [] });
    try {
      await s.openMap("customs");
      await startRaidOnCustoms(s);
      for (let shot = 1; shot <= 4; shot++) {
        s.dropGps(middle.x, 1.5, middle.z + shot, undefined, { realPicture: true });
        await waitUntil(async () => (await extractReads()) - before >= Math.min(shot, 3), { what: `read ${shot}` });
        await sleep(300);
      }
      assert.equal((await extractReads()) - before, 3, "three tries, then no more");
      assert.deepEqual(await page.locator("svg.map g.ex.on").count(), 0, "nothing was marked");
      assert.equal(await page.locator("#panel .exlist").count(), 0);
    } finally {
      await setExtractList({ visible: true, extracts: [{ name: "Crossroads", note: "Available" }, { name: "Old Gas Station Gate", note: "Requires paracord" }, { name: "Administraton Gate", note: null }, { name: "Transit to Factory", note: null }, { name: "Imaginary Gate", note: null }] });
    }
  });
});

test("nothing is sent without an OpenAI key", async (t) => {
  await withScenario(t, {}, async (s) => {
    const before = await extractReads();
    const middle = middleOfExtracts("customs");
    await s.openMap("customs");
    await startRaidOnCustoms(s);
    await s.dropGpsAndWait(middle.x, 1.5, middle.z);
    s.dropGps(middle.x, 1.5, middle.z + 5, undefined, { realPicture: true });
    await sleep(1500);
    assert.equal((await extractReads()) - before, 0);
  });
});

test("nothing is sent with the setting off", async (t) => {
  await withScenario(t, { settings: { ...withKey.settings, readExtracts: false } }, async (s) => {
    const before = await extractReads();
    const middle = middleOfExtracts("customs");
    await s.openMap("customs");
    await startRaidOnCustoms(s);
    s.dropGps(middle.x, 1.5, middle.z, undefined, { realPicture: true });
    await sleep(1500);
    assert.equal((await extractReads()) - before, 0);
    await s.page.click("#settings");
    assert.equal(await s.page.isChecked("#sReadExt"), false);
  });
});

test("with a key and no choice yet, a one-time notice explains what is sent, and nothing is sent until it is answered", async (t) => {
  await withScenario(t, { settings: { openaiKey: OPENAI_TEST_KEY } }, async (s) => {
    const page = s.page;
    const before = await extractReads();
    const middle = middleOfExtracts("customs");
    await s.openPicker();
    await page.waitForSelector(".modal #exOn");
    assert.match(await page.textContent(".modal"), /first in-raid screenshot of each raid/);

    await startRaidOnCustoms(s);
    s.dropGps(middle.x, 1.5, middle.z, undefined, { realPicture: true });
    await sleep(1500);
    assert.equal((await extractReads()) - before, 0, "nothing sent before the notice is answered");

    await page.click("#exOn");
    await waitUntil(() => s.savedSettings().extractsNoticeSeen === true, { what: "the answer to be saved" });
    assert.equal((await s.status()).settings.extractsNotice, false);
  });
});
