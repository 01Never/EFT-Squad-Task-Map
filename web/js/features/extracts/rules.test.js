// Tests for the extract rules (rules.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractsThatCount, closestExtract, approximateDistanceText } from "./rules.js";

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
