// Tests for the settings rules (rules.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { timeAgo, gameDataDescription } from "./rules.js";

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const MINUTE_MS = 60_000;

test("times read as just now, minutes, hours or days ago; no time reads as never", () => {
  assert.equal(timeAgo(NOW - 20_000, NOW), "just now");
  assert.equal(timeAgo(NOW - 5 * MINUTE_MS, NOW), "5 min ago");
  assert.equal(timeAgo(NOW - 3 * 60 * MINUTE_MS, NOW), "3 h ago");
  assert.equal(timeAgo(NOW - 2 * 24 * 60 * MINUTE_MS, NOW), "2 d ago");
  assert.equal(timeAgo(null, NOW), "never");
});

test("the game data line says the mode, the task count and where the data came from", () => {
  const live = { origin: "live", mode: "regular", tasks: 515, fetchedAt: NOW - 20_000, generated: null, error: null, refreshing: false };
  assert.equal(gameDataDescription(live, NOW), "PvP · 515 tasks · downloaded just now");

  const cache = { ...live, origin: "cache", mode: "pve", fetchedAt: NOW - 5 * MINUTE_MS };
  assert.equal(gameDataDescription(cache, NOW), "PvE · 515 tasks · saved copy from 5 min ago");

  const builtIn = { ...live, origin: "built-in", generated: "2026-09-30T08:00:00Z" };
  assert.equal(gameDataDescription(builtIn, NOW), "PvP · 515 tasks · built-in copy (2026-09-30)");
});
