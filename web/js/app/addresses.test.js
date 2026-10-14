import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAddress, pickerAddress, mapAddress, mapKeyOfAddress, samePageInMode, crumbsFor } from "./addresses.js";

const MAPS = ["customs", "shoreline"];
const parse = (hash, settingsMode = "regular") => parseAddress(hash, MAPS, settingsMode);

test("the start address is the mode select page", () => {
  for (const hash of ["", "#", "#/"]) assert.deepEqual(parse(hash), { page: "select" }, hash);
});

test("each mode has a picker and maps", () => {
  assert.deepEqual(parse("#/pve/maps"), { page: "picker", mode: "pve" });
  assert.deepEqual(parse("#/pvp-season/map/shoreline"), { page: "map", mode: "pvp-season", mapKey: "shoreline" });
  assert.deepEqual(parse("#/regular/map/customs/"), { page: "map", mode: "regular", mapKey: "customs" });
});

test("building addresses", () => {
  assert.equal(pickerAddress("pve"), "#/pve/maps");
  assert.equal(mapAddress("pvp-season", "customs"), "#/pvp-season/map/customs");
  for (const address of ["#/pve/maps", "#/pve/map/customs"]) {
    assert.ok(parse(address).page !== "redirect", address);
  }
});

test("the old map address redirects to the Settings mode's map", () => {
  assert.deepEqual(parse("#/map/customs", "pve"), { page: "redirect", hash: "#/pve/map/customs" });
  assert.deepEqual(parse("#/map/customs"), { page: "redirect", hash: "#/regular/map/customs" });
});

test("an unknown mode goes to the mode select page, an unknown map to that mode's picker", () => {
  assert.deepEqual(parse("#/arena/maps"), { page: "redirect", hash: "#/" });
  assert.deepEqual(parse("#/arena/map/customs"), { page: "redirect", hash: "#/" });
  assert.deepEqual(parse("#/pve/map/atlantis"), { page: "redirect", hash: "#/pve/maps" });
  assert.deepEqual(parse("#/nonsense"), { page: "redirect", hash: "#/" });
});

test("the old redirect ends on a page that exists, even for an unknown map", () => {
  const first = parse("#/map/atlantis", "pve");
  assert.equal(first.page, "redirect");
  assert.deepEqual(parse(first.hash, "pve"), { page: "redirect", hash: "#/pve/maps" });
});

test("mapKeyOfAddress only knows map addresses", () => {
  assert.equal(mapKeyOfAddress("#/pve/map/customs"), "customs");
  assert.equal(mapKeyOfAddress("#/pve/maps"), null);
  assert.equal(mapKeyOfAddress("#/"), null);
});

test("the same page in another mode", () => {
  assert.equal(samePageInMode("#/regular/maps", "pve"), "#/pve/maps");
  assert.equal(samePageInMode("#/regular/map/customs", "pve"), "#/pve/map/customs");
  assert.equal(samePageInMode("#/", "pve"), null);
});

test("crumbs: a map reads Mode / Maps / Map, the first two are links", () => {
  const crumbs = crumbsFor({ page: "map", mode: "pvp-season", mapKey: "shoreline" }, "Shoreline");
  assert.deepEqual(crumbs.parts, [
    { text: "PvP Season", href: "#/" },
    { text: "Maps", href: "#/pvp-season/maps" },
    { text: "Shoreline", href: null },
  ]);
  assert.deepEqual(crumbs.back, { text: "Maps", href: "#/pvp-season/maps" });
});

test("crumbs: the picker reads Mode / Maps", () => {
  const crumbs = crumbsFor({ page: "picker", mode: "regular" });
  assert.deepEqual(crumbs.parts, [{ text: "PvP", href: "#/" }, { text: "Maps", href: null }]);
  assert.deepEqual(crumbs.back, { text: "PvP", href: "#/" });
});

test("crumbs: the mode select page is plain text with no way back", () => {
  const crumbs = crumbsFor({ page: "select" });
  assert.deepEqual(crumbs.parts, [{ text: "Pick a game mode", href: null }]);
  assert.equal(crumbs.back, null);
});
