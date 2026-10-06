#!/usr/bin/env node
// Compares two recordings of the browser suite (STM_E2E_RECORD=<dir>), e.g. before and after
// ticket 04b:
//   node tests/browser/compare.mjs <beforeDir> <afterDir> [--diff-dir <dir>] [--max-diff-percent <n>] [--tolerance <n>]
//
// - requests/*.json: each scenario's API requests (method, path, body fingerprint) must be the
//   same list in the same order. Static files (scripts, styles, fonts) are a set that ticket 04b
//   may change: their differences are listed, not failed.
// - screenshots/*.png: the share of pixels that differ, per image, and a diff image (differing
//   pixels red over a faded copy of the "after" image) in <afterDir>/diff/ or --diff-dir. An image
//   fails when more than --max-diff-percent (default 0) of its pixels differ by more than
//   --tolerance (default 0, per colour channel, 0–255).
// - state/*.json: the saved-data round trips must be equal (same keys and values).
// Exit code 0 when everything matches, 1 otherwise.
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PNG } from "pngjs";

const USAGE = "usage: node tests/browser/compare.mjs <beforeDir> <afterDir> [--diff-dir <dir>] [--max-diff-percent <n>] [--tolerance <n>]";

function parseArguments(argv) {
  const options = { diffDir: null, maxDiffPercent: 0, tolerance: 0, dirs: [] };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === "--diff-dir") options.diffDir = argv[++i];
    else if (argument === "--max-diff-percent") options.maxDiffPercent = Number(argv[++i]);
    else if (argument === "--tolerance") options.tolerance = Number(argv[++i]);
    else options.dirs.push(argument);
  }
  if (options.dirs.length !== 2 || !Number.isFinite(options.maxDiffPercent) || !Number.isFinite(options.tolerance)) {
    console.error(USAGE);
    process.exit(2);
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
const [beforeDir, afterDir] = options.dirs.map((dir) => path.resolve(dir));
const diffDir = path.resolve(options.diffDir || path.join(afterDir, "diff"));
let failures = 0;

function filesIn(dir, extension) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(extension)).sort() : [];
}

/** Every file name in either folder, with a failure for each one that's on one side only. */
function pairedFiles(subfolder, extension) {
  const before = filesIn(path.join(beforeDir, subfolder), extension);
  const after = filesIn(path.join(afterDir, subfolder), extension);
  for (const name of before.filter((name) => !after.includes(name))) report(false, `${subfolder}/${name}: only in before`);
  for (const name of after.filter((name) => !before.includes(name))) report(false, `${subfolder}/${name}: only in after`);
  return before.filter((name) => after.includes(name));
}

function report(ok, line, details = []) {
  console.log(`${ok ? "  same " : "  DIFF "} ${line}`);
  for (const detail of details) console.log("         " + detail);
  if (!ok) failures++;
}

/** Paths where two JSON values differ (at most `limit`). */
function differences(before, after, where = "", out = [], limit = 12) {
  if (out.length >= limit || isDeepStrictEqual(before, after)) return out;
  const bothObjects = before && after && typeof before === "object" && typeof after === "object" && Array.isArray(before) === Array.isArray(after);
  if (!bothObjects) {
    out.push(`${where || "(top)"}: ${JSON.stringify(before)?.slice(0, 120)} → ${JSON.stringify(after)?.slice(0, 120)}`);
    return out;
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) differences(before[key], after[key], `${where}.${key}`, out, limit);
  return out;
}

// ---------------------------------------------------------------- requests

function compareRequests() {
  console.log("\nAPI requests (same requests, same order):");
  for (const name of pairedFiles("requests", ".json")) {
    const before = JSON.parse(fs.readFileSync(path.join(beforeDir, "requests", name), "utf8"));
    const after = JSON.parse(fs.readFileSync(path.join(afterDir, "requests", name), "utf8"));
    const scenario = name.replace(/\.json$/, "");
    if (isDeepStrictEqual(before.api, after.api)) {
      report(true, `${scenario} (${before.api.filter((line) => !line.startsWith("#")).length} requests)`);
    } else {
      report(false, scenario, describeListDifference(before, after));
    }
    const staticBefore = new Set(before.static), staticAfter = new Set(after.static);
    const gone = [...staticBefore].filter((file) => !staticAfter.has(file)), added = [...staticAfter].filter((file) => !staticBefore.has(file));
    if (gone.length || added.length) console.log(`         (static files, not compared: ${gone.length} no longer loaded, ${added.length} new)`);
  }
}

function describeListDifference(before, after) {
  const lines = [];
  const length = Math.max(before.api.length, after.api.length);
  let index = 0;
  while (index < length && before.api[index] === after.api[index]) index++;
  lines.push(`first difference at request ${index + 1} (before has ${before.api.length} lines, after ${after.api.length}):`);
  for (let i = Math.max(0, index - 2); i < Math.min(length, index + 4); i++) {
    const marker = before.api[i] === after.api[i] ? "  " : "≠ ";
    lines.push(`${marker}before: ${before.api[i] ?? "(none)"}`);
    if (before.api[i] !== after.api[i]) lines.push(`  after:  ${after.api[i] ?? "(none)"}`);
  }
  const fingerprint = (line) => line?.match(/ body:([0-9a-f]+)$/)?.[1];
  const beforeBody = fingerprint(before.api[index]), afterBody = fingerprint(after.api[index]);
  if (beforeBody && afterBody && before.api[index].replace(/ body:.*/, "") === after.api[index].replace(/ body:.*/, "")) {
    try {
      lines.push("body differences: " + differences(JSON.parse(before.bodies[beforeBody]), JSON.parse(after.bodies[afterBody])).join(" | "));
    } catch {
      lines.push("the bodies differ");
    }
  }
  return lines;
}

// ---------------------------------------------------------------- screenshots

function compareScreenshots() {
  console.log(`\nScreenshots (fail above ${options.maxDiffPercent}% of pixels differing by more than ${options.tolerance}; diff images in ${diffDir}):`);
  for (const name of pairedFiles("screenshots", ".png")) {
    const before = PNG.sync.read(fs.readFileSync(path.join(beforeDir, "screenshots", name)));
    const after = PNG.sync.read(fs.readFileSync(path.join(afterDir, "screenshots", name)));
    if (before.width !== after.width || before.height !== after.height) {
      report(false, `${name}: size ${before.width}×${before.height} → ${after.width}×${after.height}`);
      continue;
    }
    const diff = new PNG({ width: after.width, height: after.height });
    let differing = 0;
    for (let i = 0; i < after.data.length; i += 4) {
      const changed = Math.max(Math.abs(before.data[i] - after.data[i]), Math.abs(before.data[i + 1] - after.data[i + 1]), Math.abs(before.data[i + 2] - after.data[i + 2]), Math.abs(before.data[i + 3] - after.data[i + 3])) > options.tolerance;
      if (changed) {
        differing++;
        diff.data.set([255, 0, 0, 255], i);
      } else {
        const grey = Math.round(0.3 * (0.299 * after.data[i] + 0.587 * after.data[i + 1] + 0.114 * after.data[i + 2]) + 0.7 * 255);
        diff.data.set([grey, grey, grey, 255], i);
      }
    }
    const percent = (100 * differing) / (after.width * after.height);
    fs.mkdirSync(diffDir, { recursive: true });
    fs.writeFileSync(path.join(diffDir, name), PNG.sync.write(diff));
    report(percent <= options.maxDiffPercent, `${name}: ${percent.toFixed(4)}% of pixels differ (${differing})`);
  }
}

// ---------------------------------------------------------------- saved data

function compareSavedData() {
  console.log("\nSaved data after a load and a save (same keys and values):");
  for (const name of pairedFiles("state", ".json")) {
    const before = JSON.parse(fs.readFileSync(path.join(beforeDir, "state", name), "utf8"));
    const after = JSON.parse(fs.readFileSync(path.join(afterDir, "state", name), "utf8"));
    report(isDeepStrictEqual(before, after), name, differences(before, after));
  }
}

for (const dir of [beforeDir, afterDir]) {
  if (!fs.existsSync(dir)) {
    console.error(`No such folder: ${dir}\n${USAGE}`);
    process.exit(2);
  }
}
console.log(`before: ${beforeDir}\nafter:  ${afterDir}`);
compareRequests();
compareScreenshots();
compareSavedData();
console.log(failures ? `\n${failures} difference(s).` : "\nEverything matches.");
process.exit(failures ? 1 : 0);
