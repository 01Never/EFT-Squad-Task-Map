// Tests for the scan rules (rules.js): matching names, and what a scan's results do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gameData } from "../../../../tests/support/game-data.js";
import { makeTaskNameMatcher, matchScannedRows, shouldScanReplaceList, estimatedThousandTokens } from "./rules.js";

const matcher = makeTaskNameMatcher(gameData.tasks);

test("exact and misspelt names find their task; unknown names find nothing", () => {
  assert.equal(matcher.match("Ballet Lover").task.name, "Ballet Lover");

  const misspelt = matcher.match("Seizing the Initative");
  assert.equal(misspelt && misspelt.task.name, "Seizing the Initiative");

  assert.equal(matcher.match("Totally Fake Task"), null);
});

test("a task seen on two screenshots keeps its highest progress, and unknown names are listed once", () => {
  const rows = [
    { name: "Ballet Lover", progress: 20 },
    { name: "Ballet Lover", progress: 60 },
    { name: "Totally Fake Task" },
    { name: "Totally Fake Task" },
  ];
  const { found, unknown } = matchScannedRows(rows, matcher);
  assert.equal(found.size, 1);
  assert.equal([...found.values()][0].progress, 60);
  assert.deepEqual(unknown, ["Totally Fake Task"]);
});

test("a scan replaces the list only when every screenshot was read and something was recognised", () => {
  assert.equal(shouldScanReplaceList([], 3), true);
  assert.equal(shouldScanReplaceList(["shot.png: timeout"], 3), false);
  assert.equal(shouldScanReplaceList([], 0), false);
});

test("the cost estimate shows one decimal up to six screenshots", () => {
  assert.equal(estimatedThousandTokens(3), "4.5");
  assert.equal(estimatedThousandTokens(7), "11");
});
