// Tests for the task rules (rules.js): kind of work, splitting into parts, progress, forgetting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findTask } from "../../../../tests/support/game-data.js";
import { freshState } from "../../app/saved-data.js";
import {
  actionOfObjective,
  partsOfTask,
  isPartDone,
  partProgressPercent,
  isOneRaidTask,
  forgetTask,
  finishTaskEntry,
} from "./rules.js";

test("kills are sorted into boss, PMC and scav by their targets and wording", () => {
  const killa = { type: "shoot", d: "Locate and neutralize Killa", targets: [] };
  const pmcsAtScavBase = { type: "shoot", d: "Eliminate PMC operatives at the Scav base on Customs", targets: [] };
  const scavs = { type: "shoot", d: "Eliminate Scavs", targets: [] };
  const anyTarget = { type: "shoot", d: "Eliminate any target", targets: ["Any"] };
  const anyPmcTarget = { type: "shoot", d: "x", targets: ["AnyPmc"] };

  assert.equal(actionOfObjective(killa), "boss");
  assert.equal(actionOfObjective(pmcsAtScavBase), "pmc");
  assert.equal(actionOfObjective(scavs), "scav");
  assert.equal(actionOfObjective(anyTarget), "scav");
  assert.equal(actionOfObjective(anyPmcTarget), "pmc");
});

test("a task whose objectives are all one kind stays one part", () => {
  const capturingOutposts = partsOfTask(findTask("Capturing Outposts"));
  assert.equal(capturingOutposts.length, 1);
  assert.equal(capturingOutposts[0].action, "pmc");

  assert.equal(partsOfTask(findTask("A Fuel Matter"))[0].action, "mark");
  assert.equal(partsOfTask(findTask("Cease Fire!"))[0].action, "go");
});

test("pick up, extract and hand over make one Retrieve part", () => {
  const paramedic = partsOfTask(findTask("Paramedic"));
  assert.equal(paramedic.length, 1);
  assert.equal(paramedic[0].action, "retrieve");
  assert.equal(paramedic[0].objs.length, 3);
});

test("a task that says '(In one raid)' never splits", () => {
  const secretsOfPolikhim = findTask("Secrets of Polikhim");
  assert.equal(isOneRaidTask(secretsOfPolikhim), true);
  assert.equal(partsOfTask(secretsOfPolikhim).length, 1);
});

test("a mixed task splits by kind, and Don't split merges it under the hardest kind", () => {
  const dandies = findTask("Dandies"); // kills + stash items

  const parts = partsOfTask(dandies);
  const actions = parts.map((part) => part.action).sort();
  assert.deepEqual(actions, ["plant", "scav"]);
  assert.equal(parts.every((part) => part.split && part.total === 2), true);

  const whole = partsOfTask(dandies, true);
  assert.equal(whole.length, 1);
  assert.equal(whole[0].action, "scav");
});

test("a task that is only hand-ins is off-map", () => {
  assert.equal(partsOfTask(findTask("Booze"))[0].action, "offmap");
});

test("a part is half done with one of two objectives ticked and done with both", () => {
  const part = partsOfTask(findTask("A Fuel Matter"))[0];
  const ticks = { [part.objs[0].id]: true };
  assert.equal(isPartDone(part, ticks), false);
  assert.equal(partProgressPercent(part, ticks), 50);

  ticks[part.objs[1].id] = true;
  assert.equal(isPartDone(part, ticks), true);
});

test("a task finished in the game leaves the list unpinned with its ticks cleared, keeping its sub-tasks", () => {
  const saved = freshState();
  const dandies = findTask("Dandies");
  saved.tasks[dandies.id] = { active: true, pinned: true, partCats: {} };
  saved.ticks[dandies.objs[0].id] = true;
  saved.subs = [{ id: "s1", task: dandies.id }];

  assert.equal(finishTaskEntry(saved, dandies.id, dandies), true);
  assert.equal(saved.tasks[dandies.id].active, false);
  assert.equal(saved.tasks[dandies.id].pinned, false);
  assert.equal(saved.ticks[dandies.objs[0].id], undefined);
  assert.equal(saved.subs.length, 1);
  assert.equal(finishTaskEntry(saved, dandies.id, dandies), false, "a task not on the list isn't finished again");
});

test("a forgotten task leaves nothing behind; other tasks are untouched", () => {
  const saved = freshState();
  const dandies = findTask("Dandies");
  const booze = findTask("Booze");
  const wholeTaskInUnsorted = { "*": { cat: "unsorted", manual: true } };
  saved.tasks[dandies.id] = { active: true, pinned: true, partCats: wholeTaskInUnsorted };
  saved.tasks[booze.id] = { active: true };
  saved.ticks[dandies.objs[0].id] = true;
  saved.ticks[booze.objs[0].id] = true;
  saved.used = { [dandies.objs[0].id]: 1 };
  saved.subs = [{ id: "s1", task: dandies.id }, { id: "s2", task: booze.id }];

  forgetTask(saved, dandies.id, dandies);

  assert.equal(saved.tasks[dandies.id], undefined);
  assert.equal(saved.ticks[dandies.objs[0].id], undefined);
  assert.equal(saved.used[dandies.objs[0].id], undefined);
  assert.deepEqual(saved.subs.map((subTask) => subTask.id), ["s2"]);
  assert.equal(saved.tasks[booze.id].active, true);
  assert.equal(saved.ticks[booze.objs[0].id], true);
});
