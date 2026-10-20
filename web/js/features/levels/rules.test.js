// Tests for the level rules (rules.js) on the real map settings: The Lab (stacked levels, ticket
// 31) and the maps whose floors draw over their base (Customs, Streets).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapConfigs } from "../../../../tests/support/game-data.js";
import { fillMissingFields } from "../../app/saved-data.js";
import { isPlaceNameShown } from "../../map/place-names.js";
import {
  FOLLOW_MY_LEVEL,
  BASE_LEVEL,
  levelStyleOf,
  levelOfPosition,
  levelPickerOptions,
  defaultLevelChoice,
  savedLevelChoice,
  levelToShow,
  visibleGroups,
  layerOfLevelShown,
} from "./rules.js";

const lab = mapConfigs.find((config) => config.key === "the-lab");
const customs = mapConfigs.find((config) => config.key === "customs");
const streets = mapConfigs.find((config) => config.key === "streets-of-tarkov");
const woods = mapConfigs.find((config) => config.key === "woods");

// Real spots on The Lab (extracts in testdata/jsontarkovdev, and the middle of the main hall).
const labMedicalElevator = { x: -112.3, y: -3.11, z: -344.04 }; // Technical
const labHangarGate = { x: -170.49, y: 5.54, z: -218.87 }; // high, but outside the 2nd level's area
const labMainHallUpstairs = { x: -170, y: 4, z: -350 }; // inside the 2nd level's area
const labMainHallDownstairs = { x: -170, y: 0.5, z: -350 };

const levelNameAt = (config, spot) => {
  const level = levelOfPosition(config, spot.x, spot.y, spot.z);
  return level ? level.name : null;
};

// ---------------------------------------------------------------- which level a position is on

test("on The Lab, anything below -0.9 m is Technical", () => {
  assert.equal(levelNameAt(lab, labMedicalElevator), "Technical");
  assert.equal(levelNameAt(lab, { x: -170, y: -0.91, z: -350 }), "Technical");
  assert.equal(levelNameAt(lab, { x: -170, y: -0.9, z: -350 }), null, "-0.9 itself is the 1st level");
});

test("on The Lab, 3 m and up inside the second level's area is the Second Level", () => {
  assert.equal(levelNameAt(lab, labMainHallUpstairs), "Second Level");
  assert.equal(levelNameAt(lab, { x: -170, y: 3, z: -350 }), "Second Level", "3 m itself is upstairs");
  assert.equal(levelNameAt(lab, { x: -170, y: 2.99, z: -350 }), null);
});

test("on The Lab, a high spot outside the second level's area (the hangar) is the 1st level", () => {
  assert.equal(levelNameAt(lab, labHangarGate), null);
});

test("on The Lab, the 1st level is everything else, and a position without height", () => {
  assert.equal(levelNameAt(lab, labMainHallDownstairs), null);
  assert.equal(levelOfPosition(lab, -170, null, -350), null);
  assert.equal(levelOfPosition(lab, -170, undefined, -350), null);
});

// ---------------------------------------------------------------- the picker's options and defaults

test("The Lab's picker lists follow me, 1st Level, Second Level and Technical", () => {
  assert.deepEqual(levelPickerOptions(lab), [
    { value: FOLLOW_MY_LEVEL, name: "All levels (follow me)" },
    { value: BASE_LEVEL, name: "1st Level" },
    { value: "Second_Level", name: "Second Level" },
    { value: "Technical_Level", name: "Technical" },
  ]);
});

test("Customs' picker keeps Ground and its floors with pictures, after the new follow option", () => {
  const names = levelPickerOptions(customs).map((option) => option.name);
  assert.deepEqual(names, ["All levels (follow me)", "Ground", "2nd Floor", "3rd Floor", "Underground"]);
});

test("a map without level pictures has no picker", () => {
  assert.deepEqual(levelPickerOptions(woods), []);
});

test("The Lab follows you by default; maps with floors over their base start on the base", () => {
  assert.equal(levelStyleOf(lab), "stacked");
  assert.equal(levelStyleOf(customs), "overlay");
  assert.equal(defaultLevelChoice(lab), FOLLOW_MY_LEVEL);
  assert.equal(defaultLevelChoice(customs), BASE_LEVEL);
  assert.equal(defaultLevelChoice(streets), BASE_LEVEL);
});

test("the saved choice is used per map, and the default when there is none", () => {
  assert.equal(savedLevelChoice({ level: "Technical_Level" }, lab), "Technical_Level");
  assert.equal(savedLevelChoice({ level: FOLLOW_MY_LEVEL }, customs), FOLLOW_MY_LEVEL);
  assert.equal(savedLevelChoice({}, lab), FOLLOW_MY_LEVEL);
  assert.equal(savedLevelChoice(undefined, lab), FOLLOW_MY_LEVEL);
  assert.equal(savedLevelChoice(undefined, customs), BASE_LEVEL);
});

test("a saved choice that isn't one of the map's levels falls back to the default", () => {
  assert.equal(savedLevelChoice({ level: "Second_Floor" }, lab), FOLLOW_MY_LEVEL);
  assert.equal(savedLevelChoice({ level: "Technical_Level" }, customs), BASE_LEVEL);
});

// ---------------------------------------------------------------- the level shown

test("follow me shows the level of your newest position, and switches when it changes", () => {
  assert.equal(levelToShow(FOLLOW_MY_LEVEL, labMainHallUpstairs, lab), "Second_Level");
  assert.equal(levelToShow(FOLLOW_MY_LEVEL, labMedicalElevator, lab), "Technical_Level");
  assert.equal(levelToShow(FOLLOW_MY_LEVEL, labMainHallDownstairs, lab), BASE_LEVEL);
  assert.equal(levelToShow(FOLLOW_MY_LEVEL, labHangarGate, lab), BASE_LEVEL);
});

test("follow me with no position yet shows the base level", () => {
  assert.equal(levelToShow(FOLLOW_MY_LEVEL, null, lab), BASE_LEVEL);
  assert.equal(levelToShow(FOLLOW_MY_LEVEL, null, customs), BASE_LEVEL);
});

test("a chosen level never changes with a new position", () => {
  for (const position of [null, labMainHallUpstairs, labMedicalElevator, labMainHallDownstairs]) {
    assert.equal(levelToShow("Technical_Level", position, lab), "Technical_Level");
    assert.equal(levelToShow(BASE_LEVEL, position, lab), BASE_LEVEL);
  }
});

test("follow me on Customs shows the floor you're on, and the base for a floor without a picture", () => {
  const dormsUpstairs = { x: 200, y: 4, z: 150 }; // the dorms' 2nd floor area
  assert.equal(levelToShow(FOLLOW_MY_LEVEL, dormsUpstairs, customs), "Second_Floor");
  // Customs' "4th Floor" has heights but no picture in the art.
  const fourthFloor = customs.layers.find((layer) => layer.name === "4th Floor");
  assert.equal(fourthFloor.svgLayer, null);
  const [area] = fourthFloor.extents[0].bounds;
  const insideArea = {
    x: (area[0][0] + area[1][0]) / 2,
    y: fourthFloor.extents[0].height[0] + 0.1,
    z: (area[0][1] + area[1][1]) / 2,
  };
  assert.equal(levelNameAt(customs, insideArea), "4th Floor");
  assert.equal(levelToShow(FOLLOW_MY_LEVEL, insideArea, customs), BASE_LEVEL);
});

// ---------------------------------------------------------------- which pictures show

test("on The Lab exactly one level's picture shows", () => {
  assert.deepEqual(visibleGroups(lab, BASE_LEVEL), ["First_Level"]);
  assert.deepEqual(visibleGroups(lab, "Second_Level"), ["Second_Level"]);
  assert.deepEqual(visibleGroups(lab, "Technical_Level"), ["Technical_Level"]);
});

test("on Customs the base (with the ground floor's insides) always shows, plus the floor picked", () => {
  assert.deepEqual(visibleGroups(customs, BASE_LEVEL), ["Ground_Level", "First_Floor"]);
  const ground = ["Ground_Level", "First_Floor"];
  assert.deepEqual(visibleGroups(customs, "Second_Floor"), [...ground, "Second_Floor"]);
  // In the art's order: Customs' underground group sits between its ground groups.
  const underground = ["Ground_Level", "Underground_Level", "First_Floor"];
  assert.deepEqual(visibleGroups(customs, "Underground_Level"), underground);
});

test("any map gets stacked levels from its config alone", () => {
  const madeUp = {
    key: "made-up",
    baseLayer: "Ground",
    levelStyle: "stacked",
    baseLevelName: "Lobby",
    layers: [{ name: "Roof", svgLayer: "Roof", extents: [{ height: [10, 1000] }] }],
  };
  const config = /** @type {any} */ (madeUp);
  const names = levelPickerOptions(config).map((option) => option.name);
  assert.deepEqual(names, ["All levels (follow me)", "Lobby", "Roof"]);
  assert.equal(defaultLevelChoice(config), FOLLOW_MY_LEVEL);
  assert.equal(levelToShow(FOLLOW_MY_LEVEL, { x: 0, y: 12, z: 0 }, config), "Roof");
  assert.deepEqual(visibleGroups(config, "Roof"), ["Roof"]);
  assert.deepEqual(visibleGroups(config, BASE_LEVEL), ["Ground"]);
  assert.deepEqual(visibleGroups({ ...config, levelStyle: undefined }, "Roof"), ["Ground", "Roof"]);
});

// ---------------------------------------------------------------- place names

test("The Lab's place names follow the level shown", () => {
  const mapTopHeight = lab.heightRange[1];
  const namesOn = (levelShown) => lab.labels
    .filter((label) => isPlaceNameShown(label, layerOfLevelShown(lab, levelShown), mapTopHeight))
    .map((label) => label.t);
  assert.ok(namesOn(BASE_LEVEL).includes("Main Working Area"));
  assert.ok(!namesOn(BASE_LEVEL).includes("Cafeteria"));
  assert.ok(namesOn("Second_Level").includes("Cafeteria"));
  assert.ok(!namesOn("Second_Level").includes("Main Working Area"));
  assert.deepEqual(namesOn("Technical_Level"), ["Boiler Room"]);
});

// ---------------------------------------------------------------- saved data

test("loading saved data keeps a level choice, drops a damaged one, and adds none", () => {
  const saved = fillMissingFields(/** @type {any} */ ({
    version: 3,
    cats: [],
    prefs: { "the-lab": { level: "Technical_Level" }, customs: { level: 7 }, woods: {} },
  }));
  assert.equal(saved.prefs["the-lab"].level, "Technical_Level");
  assert.equal("level" in saved.prefs.customs, false);
  assert.equal("level" in saved.prefs.woods, false, "absent means the map's default");
});
