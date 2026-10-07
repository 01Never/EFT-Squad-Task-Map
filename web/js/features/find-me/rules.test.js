// Tests for the find-me rules (rules.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PULSE_DURATION_MS,
  PULSE_RING_CYCLE_MS,
  PULSE_RING_COUNT,
  pulseRemainingMs,
  pulseRingTimings,
  isInsideArea,
  chipPositionToward,
  distanceMeters,
  formatDistance,
  viewChangeForNewPosition,
  isWellInsideArea,
} from "./rules.js";

test("with auto-center on, every new position centres the map", () => {
  for (const isWellInView of [true, false]) {
    for (const isFollowOn of [true, false]) {
      assert.equal(viewChangeForNewPosition({ isAutoCenterOn: true, isFollowOn, isWellInView }), "centre");
    }
  }
});

test("with auto-center off, an on-screen position leaves the map where it is", () => {
  assert.equal(viewChangeForNewPosition({ isAutoCenterOn: false, isFollowOn: true, isWellInView: true }), "leave");
});

test("with auto-center off, an off-screen position is brought into view if Follow is on", () => {
  assert.equal(viewChangeForNewPosition({ isAutoCenterOn: false, isFollowOn: true, isWellInView: false }), "centre");
  assert.equal(viewChangeForNewPosition({ isAutoCenterOn: false, isFollowOn: false, isWellInView: false }), "leave");
});

test("a position in the outer 10% of the view doesn't count as well in view", () => {
  const area = { width: 1000, height: 500 };
  assert.equal(isWellInsideArea({ x: 500, y: 250 }, area, 0.1), true);
  assert.equal(isWellInsideArea({ x: 950, y: 250 }, area, 0.1), false);
  assert.equal(isWellInsideArea({ x: 500, y: 30 }, area, 0.1), false);
});

test("a pulse that never started has nothing left to run", () => {
  assert.equal(pulseRemainingMs(0, 123456), 0);
});

test("a pulse runs for 6 seconds from when it started", () => {
  assert.equal(PULSE_DURATION_MS, 6_000);
  assert.equal(pulseRemainingMs(1_000, 1_000), 6_000);
  assert.equal(pulseRemainingMs(1_000, 5_000), 2_000);
  assert.equal(pulseRemainingMs(1_000, 7_000), 0);
});

test("a fresh pulse starts its rings a third of a cycle apart, all ending at 6 seconds", () => {
  const timings = pulseRingTimings(0);
  assert.equal(timings.length, PULSE_RING_COUNT);
  timings.forEach((timing, ring) => {
    const startsAtMs = timing.delayMs;
    const endsAtMs = startsAtMs + timing.iterations * PULSE_RING_CYCLE_MS;
    assert.equal(startsAtMs, (ring * PULSE_RING_CYCLE_MS) / PULSE_RING_COUNT);
    assert.ok(Math.abs(endsAtMs - PULSE_DURATION_MS) < 1e-6);
  });
});

test("a pulse re-drawn halfway carries on instead of restarting", () => {
  const elapsedMs = 3_000;
  for (const timing of pulseRingTimings(elapsedMs)) {
    assert.ok(timing.delayMs < 0, "the animation is already under way");
    const endsAtMsFromNow = timing.delayMs + timing.iterations * PULSE_RING_CYCLE_MS;
    assert.ok(Math.abs(endsAtMsFromNow - (PULSE_DURATION_MS - elapsedMs)) < 1e-6);
  }
});

test("a finished pulse has no rings", () => {
  assert.deepEqual(pulseRingTimings(6_000), []);
  assert.deepEqual(pulseRingTimings(-5), []);
});

test("the player is on screen only when the marker's centre is clear of the edges", () => {
  const area = { width: 800, height: 600 };
  assert.equal(isInsideArea({ x: 400, y: 300 }, area, 12), true);
  assert.equal(isInsideArea({ x: 5, y: 300 }, area, 12), false);
  assert.equal(isInsideArea({ x: 400, y: 900 }, area, 12), false);
});

test("the chip sits on the edge in the player's direction, fully inside the map area", () => {
  const area = { width: 800, height: 600 };
  const chip = { width: 100, height: 30 };

  const toTheRight = chipPositionToward(area, { x: 2000, y: 300 }, chip, 8);
  assert.equal(toTheRight.x, 800 - 50 - 8);
  assert.equal(toTheRight.y, 300);
  assert.equal(toTheRight.angleDegrees, 0);

  const below = chipPositionToward(area, { x: 400, y: 5000 }, chip, 8);
  assert.equal(below.x, 400);
  assert.equal(below.y, 600 - 15 - 8);
  assert.equal(below.angleDegrees, 90);

  // Up and to the left: whichever edge the line meets first wins (here the top).
  const upLeft = chipPositionToward(area, { x: 0, y: -1000 }, chip, 8);
  assert.equal(upLeft.y, 15 + 8);
  assert.ok(upLeft.x > 50 + 8 && upLeft.x < 400, "between the left edge and the centre");
});

test("distance ignores height and uses game units as metres", () => {
  assert.equal(distanceMeters({ x: 0, z: 0 }, { x: 30, z: 40 }), 50);
});

test("distance text is rounded the way you'd say it", () => {
  assert.equal(formatDistance(43), "45 m");
  assert.equal(formatDistance(238), "240 m");
  assert.equal(formatDistance(1234), "1.2 km");
});
