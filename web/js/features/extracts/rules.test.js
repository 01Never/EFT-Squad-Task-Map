// Tests for the extract rules (rules.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractsThatCount,
  closestExtract,
  approximateDistanceText,
  isExtractMarked,
  isAutoMark,
  autoMarkNote,
  applyAutoMarks,
  toggleExtractMark,
  matchReadExtracts,
  extractsReadMessage,
} from "./rules.js";

const crashSite = { n: "Crash Site", k: "pmc", x: 100, z: 0 };
const zb1011 = { n: "ZB-1011", k: "scav", x: 30, z: 0 };
const oldGas = { n: "Old Gas Station", k: "shared", x: 0, z: 200 };
const transit = { n: "Transit to Reserve", k: "transit", x: 5, z: 5 };
const all = [crashSite, zb1011, oldGas, transit];
const pmcAndShared = { pmc: true, scav: false, shared: true, transit: true };

test("with nothing marked, the extracts shown by the chips count, transits never do", () => {
  const result = extractsThatCount(all, {}, pmcAndShared);
  assert.equal(result.basis, "shown");
  assert.deepEqual(result.candidates.map((e) => e.n), ["Crash Site", "Old Gas Station"]);
});

test("once anything is marked, only marked extracts count, whatever the chips show", () => {
  const result = extractsThatCount(all, { "ZB-1011": true }, pmcAndShared);
  assert.equal(result.basis, "marked");
  assert.deepEqual(result.candidates.map((e) => e.n), ["ZB-1011"]);
});

test("a transit counts when you mark it yourself", () => {
  const result = extractsThatCount(all, { "Transit to Reserve": true, "Crash Site": true }, pmcAndShared);
  assert.deepEqual(result.candidates.map((e) => e.n), ["Crash Site", "Transit to Reserve"]);
});

test("marks from an older format (an object instead of true) still count", () => {
  const result = extractsThatCount(all, { "Crash Site": { auto: true } }, pmcAndShared);
  assert.deepEqual(result.candidates.map((e) => e.n), ["Crash Site"]);
});

test("the closest extract is the nearest in a straight line", () => {
  const best = closestExtract({ x: 0, z: 0 }, [crashSite, oldGas, zb1011]);
  assert.equal(best && best.extract.n, "ZB-1011");
  assert.equal(best && best.distanceMeters, 30);
});

test("no candidates means no closest extract", () => {
  assert.equal(closestExtract({ x: 0, z: 0 }, []), null);
});

test("distance text says it's approximate", () => {
  assert.equal(approximateDistanceText(183), "~180 m");
  assert.equal(approximateDistanceText(42), "~40 m");
  assert.equal(approximateDistanceText(1530), "~1.5 km");
});

// ---------------------------------------------------------------- ticket 06: auto marks

test("an old plain true mark still reads as marked, and so does an auto mark", () => {
  assert.equal(isExtractMarked(true), true);
  assert.equal(isExtractMarked({ auto: true, note: "Requires paracord" }), true);
  assert.equal(isExtractMarked(undefined), false);
  assert.equal(isAutoMark(true), false, "a click is not an auto mark");
  assert.equal(isAutoMark({ auto: true, note: null }), true);
});

test("a mark's note is its requirement text, and empty for clicks and notes that weren't read", () => {
  assert.equal(autoMarkNote({ auto: true, note: "Requires paracord" }), "Requires paracord");
  assert.equal(autoMarkNote({ auto: true, note: null }), "");
  assert.equal(autoMarkNote(true), "");
});

test("the closest extract uses auto marks at once, together with old marks", () => {
  const marked = {};
  toggleExtractMark(marked, "Old Gas Station"); // a click: true
  applyAutoMarks(marked, [{ name: "ZB-1011", note: null }]);
  const result = extractsThatCount(all, marked, pmcAndShared);
  assert.equal(result.basis, "marked");
  assert.deepEqual(result.candidates.map((e) => e.n), ["ZB-1011", "Old Gas Station"]);
});

test("auto marks keep a mark you made by hand, add new ones, and refresh an older auto note", () => {
  const marked = { "Crash Site": true, "ZB-1011": { auto: true, note: "old" } };
  applyAutoMarks(marked, [
    { name: "Crash Site", note: "Available" },
    { name: "ZB-1011", note: "Requires paracord" },
    { name: "Old Gas Station", note: null },
  ]);
  assert.deepEqual(marked, {
    "Crash Site": true,
    "ZB-1011": { auto: true, note: "Requires paracord" },
    "Old Gas Station": { auto: true, note: null },
  });
});

test("clicking an auto-marked extract unmarks it, clicking again marks it by hand", () => {
  const marked = { "Crash Site": { auto: true, note: null } };
  toggleExtractMark(marked, "Crash Site");
  assert.deepEqual(marked, {});
  toggleExtractMark(marked, "Crash Site");
  assert.deepEqual(marked, { "Crash Site": true });
});

test("names read from a screenshot are matched to the open map when the server didn't know the map", () => {
  const read = [
    { name: "crossroads", note: "Available" },
    { name: "Old Gas Stat1on", note: null },
    { name: "Imaginary Gate", note: null },
  ];
  const result = matchReadExtracts(read, ["Crossroads", "Old Gas Station", "Transit to Factory"]);
  assert.deepEqual(result.marked, [
    { name: "Crossroads", note: "Available" },
    { name: "Old Gas Station", note: null },
  ]);
  assert.deepEqual(result.unknown, ["Imaginary Gate"]);
});

test("the toast says how many were marked and which names weren't recognised", () => {
  assert.equal(extractsReadMessage(4, ["Foo Gate"]), "Marked 4 extracts from your screenshot (1 not recognised: Foo Gate)");
  assert.equal(extractsReadMessage(1, []), "Marked 1 extract from your screenshot");
  assert.equal(extractsReadMessage(0, ["A", "B"]), "Marked 0 extracts from your screenshot (2 not recognised: A, B)");
});
