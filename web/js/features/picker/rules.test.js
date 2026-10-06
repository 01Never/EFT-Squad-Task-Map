// Tests for the map picker rules (rules.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findTask } from "../../../../tests/support/game-data.js";
import { partsOfTask } from "../tasks/rules.js";
import { countTasksPerMap, tasksNotOnAMapCard } from "./rules.js";

const wholeTasks = (task) => partsOfTask(task);

test("a map card counts the tasks with work left on that map", () => {
  const balletLover = findTask("Ballet Lover"); // Streets
  const counts = countTasksPerMap([balletLover], ["streets-of-tarkov", "woods"], wholeTasks, {});
  assert.deepEqual(counts, { "streets-of-tarkov": 1, woods: 0 });
});

test("a task whose parts are all done no longer counts", () => {
  const balletLover = findTask("Ballet Lover");
  const ticks = {};
  for (const objective of balletLover.objs) ticks[objective.id] = true;
  const counts = countTasksPerMap([balletLover], ["streets-of-tarkov"], wholeTasks, ticks);
  assert.equal(counts["streets-of-tarkov"], 0);
});

test("hand-in tasks are listed apart from tasks on maps without a card", () => {
  const booze = findTask("Booze"); // hand-ins only
  const balletLover = findTask("Ballet Lover"); // Streets, which has no card here
  const { offMap, onOtherMaps } = tasksNotOnAMapCard([booze, balletLover], ["woods"]);
  assert.deepEqual(offMap.map((task) => task.name), ["Booze"]);
  assert.deepEqual(onOtherMaps.map((task) => task.name), ["Ballet Lover"]);
});
