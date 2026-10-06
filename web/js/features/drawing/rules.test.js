// Tests for the drawing rules (rules.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { simplifyStroke, strokeForSaving } from "./rules.js";

test("simplifying a line keeps both ends and drops points that are nearly in line", () => {
  const simplified = simplifyStroke([[0, 0], [1, 0.001], [2, 0], [3, 5]], 0.1);
  assert.deepEqual(simplified[0], [0, 0]);
  assert.deepEqual(simplified[simplified.length - 1], [3, 5]);
  assert.equal(simplified.length, 3);
});

test("a click without moving is saved as a short dot, in game units", () => {
  const identity = { toGame: (x, y) => [x, y], unit: 2 };
  const stroke = strokeForSaving([[10, 20]], 4, "#ff4d4d", identity);
  assert.deepEqual(stroke, { c: "#ff4d4d", w: 2, pts: [[10, 20], [10.05, 20]] });
});
