import { test } from "node:test";
import assert from "node:assert/strict";
import { modeCards } from "./rules.js";

const entry = (active) => ({ active });
const saved = {
  modes: {
    regular: { tasks: { a: entry(true), b: entry(true), c: entry(false) } },
    pve: { tasks: { d: entry(true) } },
    "pvp-season": { tasks: {} },
  },
};

test("the cards come in the game's order with their names and kinds", () => {
  const cards = modeCards(saved, "regular", null);
  assert.deepEqual(cards.map((card) => [card.mode, card.name, card.kind]), [
    ["pve", "PvE", "Regular"],
    ["regular", "PvP", "Regular"],
    ["pvp-season", "PvP Season", "Seasonal"],
  ]);
});

test("each card counts the active tasks of its own mode's list", () => {
  const cards = modeCards(saved, "regular", null);
  assert.deepEqual(cards.map((card) => card.activeTasks), [1, 2, 0]);
});

test("a mode with no list yet has no tasks", () => {
  const cards = modeCards({ modes: {} }, "regular", null);
  assert.deepEqual(cards.map((card) => card.activeTasks), [0, 0, 0]);
});

test("Last used is the Settings mode", () => {
  const cards = modeCards(saved, "pve", null);
  assert.deepEqual(cards.map((card) => card.lastUsed), [true, false, false]);
});

test("Game is in this mode only when the log's mode is known", () => {
  assert.deepEqual(modeCards(saved, "regular", "pvp-season").map((card) => card.gameIsInThisMode), [false, false, true]);
  assert.deepEqual(modeCards(saved, "regular", null).map((card) => card.gameIsInThisMode), [false, false, false]);
  assert.deepEqual(modeCards(saved, "regular", undefined).map((card) => card.gameIsInThisMode), [false, false, false]);
});
