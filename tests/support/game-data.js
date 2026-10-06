// Shared by the page's logic tests (web/js/**/*.test.js): the real game data and map settings,
// so the rules are tested on real tasks. Test-only; not part of the page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

/**
 * Reads a JSON file given relative to the repository root.
 * @param {string} pathFromRoot
 */
export function readRepoJson(pathFromRoot) {
  const text = readFileSync(new URL("../../" + pathFromRoot, import.meta.url), "utf8");
  return JSON.parse(text);
}

/**
 * The bundled game-data snapshot, already converted to the page's "stm-v2" format. The golden
 * file is exactly what the (Go) converter produces from assets/game-data.json, so these tests
 * don't depend on the converter.
 */
function loadConvertedGameData() {
  const gzipped = readFileSync(new URL("../../testdata/golden/data-snapshot.json.gz", import.meta.url));
  return JSON.parse(gunzipSync(gzipped).toString("utf8"));
}

export const gameData = loadConvertedGameData();
export const mapConfigs = readRepoJson("assets/maps-config.json");

/**
 * Finds a task by its exact English name (every name used in the tests is unique in the data).
 * @param {string} name
 */
export function findTask(name) {
  const task = gameData.tasks.find((candidate) => candidate.name === name);
  assert.ok(task, `task "${name}" should exist in the game data`);
  return task;
}
