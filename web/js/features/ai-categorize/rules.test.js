// Tests for the AI Categorize rules (rules.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshState, blankTaskEntry } from "../../app/saved-data.js";
import { chatHistoryForRequest, applyAssignments, undoAssignments } from "./rules.js";

/** A taskEntry() for tests: creates the entry when missing, like the page does. */
function taskEntryIn(saved) {
  return (taskId) => (saved.tasks[taskId] = saved.tasks[taskId] || blankTaskEntry(0));
}

const answer = {
  reply: "Moved 1 part that needs a key.",
  new_categories: [{ name: "Key runs", color: "#ff0000" }],
  assignments: [{ part_id: "t1:go", name: "Task 1", from: "Scout & extract", category: "Key runs", reason: "needs a key" }],
  model: "gpt-5.4-mini",
};

test("the chat history tells the model what you did with each answer", () => {
  const chat = [
    { role: "user", text: "Key runs please" },
    { role: "bot", result: answer, applied: 1 },
    { role: "user", text: "Undo that" },
    { role: "bot", result: answer, undone: true, discarded: true },
    { role: "bot", error: "timeout" },
  ];
  assert.deepEqual(chatHistoryForRequest(chat), [
    { role: "user", content: "Key runs please" },
    { role: "assistant", content: "Moved 1 part that needs a key. [Player applied 1 of the proposed changes.]" },
    { role: "user", content: "Undo that" },
    { role: "assistant", content: "Moved 1 part that needs a key. [Player applied, then undid these changes.]" },
  ]);
});

test("applying creates the new category before Unsorted and moves the part into it by hand", () => {
  const saved = freshState();
  const undo = applyAssignments(saved, answer, answer.assignments, taskEntryIn(saved), () => "c-new");

  const unsortedIndex = saved.cats.findIndex((category) => category.builtin === "unsorted");
  assert.equal(saved.cats[unsortedIndex - 1].name, "Key runs");
  assert.equal(saved.cats[unsortedIndex - 1].color, "#ff0000");
  assert.deepEqual(saved.tasks.t1.partCats["t1:go"], { cat: "c-new", manual: true });
  assert.deepEqual(undo, { parts: { "t1:go": null }, cats: ["c-new"] });
});

test("a category name that already exists, in any case, is reused", () => {
  const saved = freshState();
  const keyRuns = { ...answer, new_categories: [], assignments: [{ ...answer.assignments[0], category: "mark" }] };
  const undo = applyAssignments(saved, keyRuns, keyRuns.assignments, taskEntryIn(saved), () => "c-new");
  assert.equal(saved.tasks.t1.partCats["t1:go"].cat, "b-mark");
  assert.deepEqual(undo.cats, []);
});

test("undo puts the parts back and removes the categories it made, unless something is in them now", () => {
  const saved = freshState();
  const categoryCountBefore = saved.cats.length;
  const undo = applyAssignments(saved, answer, answer.assignments, taskEntryIn(saved), () => "c-new");
  undoAssignments(saved, undo, taskEntryIn(saved));
  assert.deepEqual(saved.tasks.t1.partCats, {});
  assert.equal(saved.cats.length, categoryCountBefore);

  const savedAgain = freshState();
  const undoAgain = applyAssignments(savedAgain, answer, answer.assignments, taskEntryIn(savedAgain), () => "c-new");
  taskEntryIn(savedAgain)("t2").partCats["t2:*"] = { cat: "c-new", manual: true }; // moved there by hand since
  undoAssignments(savedAgain, undoAgain, taskEntryIn(savedAgain));
  assert.ok(savedAgain.cats.some((category) => category.id === "c-new"));
});
