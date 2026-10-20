// Levels (ticket 31): The Lab, a map whose levels are separate pictures, and the level picker
// (`#floors select`) that shows one level or follows the level of your newest GPS screenshot.
// Customs' floors still draw over its ground, with the new follow option added.
import assert from "node:assert/strict";
import { test } from "node:test";
import { browserSuite, withScenario, readFixture, stateWithEveryTask, OWN_MARKER } from "./harness.js";

browserSuite();

const PICKER = "#floors select";

// Real spots on The Lab (game metres): the main hall upstairs and downstairs, and the medical
// elevator down in Technical.
const LAB_UPSTAIRS = { x: -170, y: 4, z: -350 };
const LAB_TECHNICAL = { x: -112.3, y: -3.11, z: -344.04 };

/** The map art's groups that show (no `off` class), by id. */
function shownArtGroups(page) {
  return page.$$eval("svg.map > g.lyr", (groups) => groups.filter((group) => !group.classList.contains("off")).map((group) => group.id));
}

/** The level picker's options as "value: text", and the selected value. */
async function levelPicker(page) {
  const options = await page.$$eval(`${PICKER} option`, (all) => all.map((option) => `${option.value}: ${option.textContent}`));
  const selected = await page.$eval(PICKER, (select) => select.value);
  return { options, selected };
}

test("The Lab has a card on the picker with its task count and a picture", async (t) => {
  await withScenario(t, { state: stateWithEveryTask() }, async (s) => {
    await s.openPicker();
    const card = s.page.locator('.picker .card[href="#/regular/map/the-lab"]');
    assert.equal(await card.locator(".meta b").textContent(), "The Lab");
    assert.match(await card.locator(".meta span.has").textContent(), /^\d+ tasks$/);
    await card.locator(".thumb svg").waitFor({ state: "attached" });
    const thumbnailGroups = await card.locator(".thumb svg > g").evaluateAll((groups) => groups.map((group) => group.id));
    assert.deepEqual(thumbnailGroups, ["First_Level"], "the card shows the 1st level only");
  });
});

test("The Lab: one level's picture at a time; a chosen level stays, follow me follows your screenshots", async (t) => {
  await withScenario(t, { state: readFixture("fresh-v2-state.json") }, async (s) => {
    const page = s.page;
    await s.openMap("the-lab");
    assert.deepEqual(await page.$$eval("svg.map > g.lyr", (groups) => groups.map((group) => group.id)), ["First_Level", "Second_Level", "Technical_Level"]);
    assert.deepEqual(await levelPicker(page), {
      options: ["follow: All levels (follow me)", "base: 1st Level", "Second_Level: Second Level", "Technical_Level: Technical"],
      selected: "follow",
    }, "The Lab follows you by default");
    assert.deepEqual(await shownArtGroups(page), ["First_Level"], "no position yet: the 1st level");

    s.step("choose Technical");
    await s.saving(() => page.selectOption(PICKER, "Technical_Level"));
    assert.deepEqual(await shownArtGroups(page), ["Technical_Level"], "only Technical shows");
    assert.equal(s.savedState().prefs["the-lab"].level, "Technical_Level");

    s.step("a second-level screenshot moves you, the map stays on Technical");
    await s.dropGpsAndWait(LAB_UPSTAIRS.x, LAB_UPSTAIRS.y, LAB_UPSTAIRS.z);
    assert.equal(await page.locator(OWN_MARKER).count(), 1, "your marker is drawn");
    assert.match(await page.textContent("#gpsbar-you"), /You \(floor 2\)/, "with your real level");
    assert.deepEqual(await shownArtGroups(page), ["Technical_Level"], "your choice wins over the screenshot");
    assert.equal((await levelPicker(page)).selected, "Technical_Level");

    s.step("follow me shows your level");
    await s.saving(() => page.selectOption(PICKER, "follow"));
    assert.deepEqual(await shownArtGroups(page), ["Second_Level"]);

    s.step("a technical-height screenshot switches to Technical");
    await s.dropGpsAndWait(LAB_TECHNICAL.x, LAB_TECHNICAL.y, LAB_TECHNICAL.z);
    assert.deepEqual(await shownArtGroups(page), ["Technical_Level"]);
    assert.equal((await levelPicker(page)).selected, "follow");

    s.step("the 1st level by name");
    await s.saving(() => page.selectOption(PICKER, "base"));
    assert.deepEqual(await shownArtGroups(page), ["First_Level"]);
    assert.equal(s.savedState().prefs["the-lab"].level, "base");

    s.step("the choice is kept after a reload");
    await s.reload();
    await s.waitForMap("the-lab");
    assert.equal((await levelPicker(page)).selected, "base");
    assert.deepEqual(await shownArtGroups(page), ["First_Level"]);
  });
});

test("The Lab's place names follow the level shown", async (t) => {
  await withScenario(t, { state: readFixture("fresh-v2-state.json") }, async (s) => {
    const page = s.page;
    await s.openMap("the-lab");
    const placeNames = () => page.$$eval("svg.map text", (texts) => texts.map((text) => text.textContent));
    assert.ok((await placeNames()).includes("Main Working Area"));
    assert.ok(!(await placeNames()).includes("Cafeteria"));
    await s.saving(() => page.selectOption(PICKER, "Second_Level"));
    assert.ok((await placeNames()).includes("Cafeteria"));
    assert.ok(!(await placeNames()).includes("Main Working Area"));
  });
});

test("Customs' floor picker works as before, with All levels (follow me) added", async (t) => {
  await withScenario(t, { state: readFixture("fresh-v2-state.json") }, async (s) => {
    const page = s.page;
    await s.openMap("customs");
    assert.deepEqual(await levelPicker(page), {
      options: ["follow: All levels (follow me)", "base: Ground", "Second_Floor: 2nd Floor", "Third_Floor: 3rd Floor", "Underground_Level: Underground"],
      selected: "base",
    }, "Customs still starts on Ground");
    assert.deepEqual(await shownArtGroups(page), ["Ground_Level", "First_Floor"]);

    await s.saving(() => page.selectOption(PICKER, "Second_Floor"));
    assert.deepEqual(await shownArtGroups(page), ["Ground_Level", "First_Floor", "Second_Floor"], "a floor draws over the ground");

    await s.dropGpsAndWait(-210, 1, -110); // big red, downstairs
    assert.deepEqual(await shownArtGroups(page), ["Ground_Level", "First_Floor", "Second_Floor"], "the chosen floor stays");

    await s.saving(() => page.selectOption(PICKER, "follow"));
    assert.deepEqual(await shownArtGroups(page), ["Ground_Level", "First_Floor"], "follow me: you're on the ground");
    await s.dropGpsAndWait(200, 4, 150); // dorms, 2nd floor
    assert.deepEqual(await shownArtGroups(page), ["Ground_Level", "First_Floor", "Second_Floor"]);
  });
});
