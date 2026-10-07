import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPALIVE_LIMIT_BYTES, shouldUseKeepalive, retryDelayMs } from "./saving-rules.js";

test("a normal save never uses keepalive", () => {
  assert.equal(shouldUseKeepalive("{}", false), false);
});

test("a save while the page closes uses keepalive when the body is small", () => {
  assert.equal(shouldUseKeepalive("x".repeat(KEEPALIVE_LIMIT_BYTES), true), true);
});

test("a save while the page closes does not use keepalive above 64 KiB", () => {
  assert.equal(shouldUseKeepalive("x".repeat(KEEPALIVE_LIMIT_BYTES + 1), true), false);
});

test("the limit counts bytes, not characters", () => {
  assert.equal(shouldUseKeepalive("é".repeat(KEEPALIVE_LIMIT_BYTES / 2 + 1), true), false);
});

test("retry: soon after a network error, later after an error answer", () => {
  assert.equal(retryDelayMs(false), 1500);
  assert.ok(retryDelayMs(true) > 1500);
});
