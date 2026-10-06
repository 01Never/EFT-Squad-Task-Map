// Tests for the sub-task rules (rules.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newSubTask, unpinSubTask, pinPlace } from "./rules.js";

test("a new sub-task is not done and not pinned anywhere", () => {
  assert.deepEqual(newSubTask("s1", "t1", "Bring a flashlight"), {
    id: "s1",
    task: "t1",
    text: "Bring a flashlight",
    done: false,
    map: null,
    x: null,
    z: null,
    f: "",
  });
});

test("a pin is here, on another map, or nowhere; unpinning keeps the sub-task", () => {
  const subTask = { ...newSubTask("s1", "t1", "Stash here"), map: "customs", x: 10, z: 20 };
  assert.equal(pinPlace(subTask, "customs"), "here");
  assert.equal(pinPlace(subTask, "woods"), "elsewhere");

  unpinSubTask(subTask);
  assert.equal(pinPlace(subTask, "customs"), "none");
  assert.equal(subTask.text, "Stash here");
});
