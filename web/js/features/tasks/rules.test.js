// Tests for the task rules (rules.js): kind of work, splitting into parts, progress, forgetting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findTask } from "../../../../tests/support/game-data.js";
import { freshState, emptyTaskList } from "../../app/saved-data.js";
import {
  actionOfObjective,
  partsOfTask,
  isPartDone,
  partProgressPercent,
  isOneRaidTask,
  forgetTask,
  finishTaskEntry,
  applyTaskEventFromGame,
  tickObjective,
  isTaskOnMyList,
  isObjectiveDone,
  removeTaskFromList,
  togglePinnedTask,
  isRowListed,
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
  const list = emptyTaskList();
  const dandies = findTask("Dandies");
  list.tasks[dandies.id] = { active: true, pinned: true, partCats: {} };
  list.ticks[dandies.objs[0].id] = true;
  list.subs = [{ id: "s1", task: dandies.id }];

  assert.equal(finishTaskEntry(list, dandies.id, dandies), true);
  assert.equal(list.tasks[dandies.id].active, false);
  assert.equal(list.tasks[dandies.id].pinned, false);
  assert.equal(list.ticks[dandies.objs[0].id], undefined);
  assert.equal(list.subs.length, 1);
  assert.equal(finishTaskEntry(list, dandies.id, dandies), false, "a task not on the list isn't finished again");
});

test("a forgotten task leaves nothing behind; other tasks are untouched", () => {
  const list = emptyTaskList();
  const dandies = findTask("Dandies");
  const booze = findTask("Booze");
  const wholeTaskInUnsorted = { "*": { cat: "unsorted", manual: true } };
  list.tasks[dandies.id] = { active: true, pinned: true, partCats: wholeTaskInUnsorted };
  list.tasks[booze.id] = { active: true };
  list.ticks[dandies.objs[0].id] = true;
  list.ticks[booze.objs[0].id] = true;
  list.used = { [dandies.objs[0].id]: 1 };
  list.subs = [{ id: "s1", task: dandies.id }, { id: "s2", task: booze.id }];

  forgetTask(list, dandies.id, dandies);

  assert.equal(list.tasks[dandies.id], undefined);
  assert.equal(list.ticks[dandies.objs[0].id], undefined);
  assert.equal(list.used[dandies.objs[0].id], undefined);
  assert.deepEqual(list.subs.map((subTask) => subTask.id), ["s2"]);
  assert.equal(list.tasks[booze.id].active, true);
  assert.equal(list.ticks[booze.objs[0].id], true);
});

test("a task accepted in PvE goes on the PvE list, even while PvP Season is shown", () => {
  const saved = freshState();
  const dandies = findTask("Dandies");
  const event = { type: "task", taskId: dandies.id, status: "started", mode: "pve" };

  const result = applyTaskEventFromGame(saved, event, dandies, "pvp-season", 1000);

  assert.deepEqual(result, { mode: "pve", isNew: true });
  assert.equal(saved.modes.pve.tasks[dandies.id].active, true);
  assert.equal(saved.modes.pve.tasks[dandies.id].source, "log");
  assert.equal(saved.modes["pvp-season"].tasks[dandies.id], undefined, "the shown list is untouched");
  assert.equal(saved.modes.regular.tasks[dandies.id], undefined);
});

test("a task finished in PvE leaves the PvE list only; the same task stays on the other lists", () => {
  const saved = freshState();
  const dandies = findTask("Dandies");
  for (const mode of ["regular", "pve", "pvp-season"]) {
    saved.modes[mode].tasks[dandies.id] = { active: true, pinned: true, partCats: {} };
    saved.modes[mode].ticks[dandies.objs[0].id] = true;
  }
  const event = { type: "task", taskId: dandies.id, status: "finished", mode: "pve" };

  applyTaskEventFromGame(saved, event, dandies, "pvp-season", 1000);

  assert.equal(saved.modes.pve.tasks[dandies.id].active, false);
  assert.equal(saved.modes.pve.ticks[dandies.objs[0].id], undefined);
  assert.equal(saved.modes["pvp-season"].tasks[dandies.id].active, true);
  assert.equal(saved.modes["pvp-season"].ticks[dandies.objs[0].id], true);
  assert.equal(saved.modes.regular.tasks[dandies.id].active, true);
});

test("a task event without a mode (queued by an older version), or with an unknown one, goes to the shown list", () => {
  const dandies = findTask("Dandies");
  const withoutMode = freshState();
  applyTaskEventFromGame(withoutMode, { type: "task", taskId: dandies.id, status: "started" }, dandies, "pvp-season", 1);
  assert.equal(withoutMode.modes["pvp-season"].tasks[dandies.id].active, true);
  assert.equal(withoutMode.modes.regular.tasks[dandies.id], undefined);

  const unknownMode = freshState();
  const event = { type: "task", taskId: dandies.id, status: "started", mode: "arena" };
  const result = applyTaskEventFromGame(unknownMode, event, dandies, "pve", 1);
  assert.equal(result.mode, "pve");
  assert.equal(unknownMode.modes.pve.tasks[dandies.id].active, true);
  assert.equal("arena" in unknownMode.modes, false);
});

test("a task accepted again in the game is not new: the toast isn't shown twice", () => {
  const saved = freshState();
  const dandies = findTask("Dandies");
  const event = { type: "task", taskId: dandies.id, status: "started", mode: "regular" };
  applyTaskEventFromGame(saved, event, dandies, "regular", 1);
  assert.equal(applyTaskEventFromGame(saved, event, dandies, "regular", 2).isNew, false);
});

// ---------------------------------------------------------------- ticket 26: tasks that aren't yours

test("only a task on your list can be ticked; a squadmate's task (not on it, or only pinned) can't", () => {
  const dandies = findTask("Dandies");
  const [firstObjective] = dandies.objs;
  const list = emptyTaskList();
  assert.deepEqual(tickObjective(list, dandies.id, firstObjective, true), { isDone: false, countChange: 0 }, "not on the list at all");
  togglePinnedTask(list, dandies.id, 1);
  assert.equal(isTaskOnMyList(list, dandies.id), false, "a pin doesn't put it on your list");
  assert.equal(tickObjective(list, dandies.id, firstObjective, true).isDone, false, "pinned only");
  assert.deepEqual(list.ticks, {}, "nothing was ticked");

  list.tasks[dandies.id].active = true;
  const result = tickObjective(list, dandies.id, firstObjective, true);
  assert.equal(result.isDone, true);
  assert.ok(result.countChange > 0);
  assert.ok(isObjectiveDone(firstObjective, list.ticks));
});

test("a squadmate's task can't be removed or finished: it was never on your list", () => {
  const dandies = findTask("Dandies");
  const list = emptyTaskList();
  togglePinnedTask(list, dandies.id, 1);
  assert.equal(removeTaskFromList(list, dandies.id), false);
  assert.equal(list.tasks[dandies.id].pinned, true, "the pin stays");
  assert.equal(finishTaskEntry(list, dandies.id, dandies), false);
  assert.equal(removeTaskFromList(list, "not-a-task"), false);

  list.tasks[dandies.id].active = true;
  assert.equal(removeTaskFromList(list, dandies.id), true, "yours: off the list and unpinned");
  assert.deepEqual([list.tasks[dandies.id].active, list.tasks[dandies.id].pinned], [false, false]);
});

test("a row is listed when it isn't done, and pinned under 'Pinned only'", () => {
  const row = { task: findTask("Dandies"), part: partsOfTask(findTask("Dandies"))[0], cat: null, done: false, pinned: false };
  assert.equal(isRowListed(row, false), true);
  assert.equal(isRowListed(row, true), false);
  assert.equal(isRowListed({ ...row, pinned: true, notMine: true }, true), true);
  assert.equal(isRowListed({ ...row, done: true }, false), false);
});
