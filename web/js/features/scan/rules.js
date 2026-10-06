// @ts-check
// Scan tasks: matching task names read from screenshots (or typed into "Add a task by name") to
// the game data, and what a scan's results do to your list. Plain functions only: no DOM, no
// network. scan.js runs the capture, the reading and the review dialog.

/** @import { Task } from "../../app/types.js" */

// A name that isn't an exact match still counts when it's at least this similar to a task's name
// (1 = identical; Levenshtein distance / longer length). v2's value: a misread letter or two
// ("Seizing the Initative") still matches, another task's name doesn't.
export const NAME_MATCH_MIN_SIMILARITY = 0.82;

// Names whose lengths differ by more than this many characters are never matched (and not
// compared, which keeps the search quick).
const NAME_MATCH_MAX_LENGTH_DIFFERENCE = 8;

// Screenshots are shrunk to at most this many pixels on the long edge before they're sent to
// OpenAI (as JPEG at this quality): enough to read the task list, and a small upload.
export const SCAN_IMAGE_MAX_EDGE_PIXELS = 2048;
export const SCAN_JPEG_QUALITY = 0.9;

// How many screenshots are read at the same time.
export const SCAN_PARALLEL_READS = 3;

// The cost estimate shown while capturing: about 1–2k input tokens per screenshot.
const ESTIMATED_THOUSAND_TOKENS_PER_SCREENSHOT = 1.5;

// ---------------------------------------------------------------- task names

/**
 * A name reduced to what matters for matching: lower case letters and digits only.
 * @param {unknown} name
 */
export function normalizedName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * The Levenshtein distance: how many single-letter changes turn `from` into `to`.
 * @param {string} from
 * @param {string} to
 */
export function editDistance(from, to) {
  if (!from.length || !to.length) return Math.max(from.length, to.length);
  // Row i holds the distances from the first i letters of `from` to each start of `to`.
  let previousRow = Array.from({ length: to.length + 1 }, (_, j) => j);
  for (let i = 1; i <= from.length; i++) {
    const currentRow = [i];
    for (let j = 1; j <= to.length; j++) {
      const substitutionCost = from[i - 1] === to[j - 1] ? 0 : 1;
      const deletion = previousRow[j] + 1;
      const insertion = currentRow[j - 1] + 1;
      const substitution = previousRow[j - 1] + substitutionCost;
      currentRow[j] = Math.min(deletion, insertion, substitution);
    }
    previousRow = currentRow;
  }
  return previousRow[to.length];
}

/**
 * How alike two names are: 1 for identical, 0 for nothing in common.
 * @param {string} first
 * @param {string} second
 */
export function nameSimilarity(first, second) {
  return 1 - editDistance(first, second) / Math.max(first.length, second.length, 1);
}

/**
 * A matcher for task names. `match(name, trader)` finds the task: by exact (normalized) name,
 * else by the most similar name if it's at least NAME_MATCH_MIN_SIMILARITY alike (`fixed: true`).
 * Several tasks with the same name are told apart by `trader` when given; otherwise the first.
 * @param {Task[]} tasks
 */
export function makeTaskNameMatcher(tasks) {
  /** @type {Map<string, Task[]>} */
  const tasksByName = new Map();
  for (const task of tasks) {
    const name = normalizedName(task.name);
    if (!tasksByName.has(name)) tasksByName.set(name, []);
    tasksByName.get(name).push(task);
  }
  const knownNames = [...tasksByName.keys()];

  /**
   * @param {string} readName
   * @param {string | null} [trader]
   * @returns {{ task: Task, fixed: boolean } | null}
   */
  function match(readName, trader) {
    const name = normalizedName(readName);
    if (!name) return null;
    let candidates = tasksByName.get(name);
    let fixed = false;
    if (!candidates) {
      const closest = mostSimilarName(name, knownNames);
      if (closest.similarity >= NAME_MATCH_MIN_SIMILARITY) {
        candidates = tasksByName.get(closest.name);
        fixed = true;
      }
    }
    if (!candidates) return null;
    return { task: pickByTrader(candidates, trader), fixed };
  }
  return { match };
}

/** The known name most similar to `name` (the first one wins a tie). */
function mostSimilarName(name, knownNames) {
  let best = { name: null, similarity: 0 };
  for (const known of knownNames) {
    if (Math.abs(known.length - name.length) > NAME_MATCH_MAX_LENGTH_DIFFERENCE) continue;
    const similarity = nameSimilarity(name, known);
    if (similarity > best.similarity) best = { name: known, similarity };
  }
  return best;
}

/** Same-name tasks: the one from this trader, else the first. */
function pickByTrader(candidates, trader) {
  if (candidates.length > 1 && trader) {
    const traderName = normalizedName(trader);
    return candidates.find((task) => normalizedName(task.trader) === traderName) || candidates[0];
  }
  return candidates[0];
}

// ---------------------------------------------------------------- scan results

/**
 * @typedef {object} ScannedRow One task line the AI read from a screenshot.
 * @property {string} name
 * @property {string | null} [trader]
 * @property {number | null} [progress] percent, when the screenshot shows it
 */

/**
 * @typedef {object} FoundTask
 * @property {Task} task
 * @property {number | null | undefined} progress
 * @property {string | null} fixed the name as read, when it only matched by similarity
 */

/**
 * Match every row read from the screenshots. A task seen on several screenshots keeps its
 * highest progress. Names that match nothing are listed once each.
 * @param {ScannedRow[]} rows
 * @param {{ match: (name: string, trader?: string | null) => { task: Task, fixed: boolean } | null }} matcher
 * @returns {{ found: Map<string, FoundTask>, unknown: string[] }}
 */
export function matchScannedRows(rows, matcher) {
  /** @type {Map<string, FoundTask>} */
  const found = new Map();
  const unknown = [];
  for (const row of rows) {
    const matched = matcher.match(row.name, row.trader);
    if (!matched) {
      if (!unknown.includes(row.name)) unknown.push(row.name);
      continue;
    }
    const earlier = found.get(matched.task.id);
    if (!earlier || (row.progress ?? -1) > (earlier.progress ?? -1)) {
      found.set(matched.task.id, { task: matched.task, progress: row.progress, fixed: matched.fixed ? row.name : null });
    }
  }
  return { found, unknown };
}

/**
 * The scan replaces your list (owner's decision after 2.0.1), but only when every screenshot was
 * read and something was recognised. Otherwise it only adds.
 * @param {string[]} errors one per screenshot that couldn't be read
 * @param {number} foundCount
 */
export function shouldScanReplaceList(errors, foundCount) {
  return !errors.length && foundCount > 0;
}

/**
 * The sentence under "Scan results" that says what confirming will do.
 * @param {boolean} replacesList
 * @param {string[]} errors
 */
export function scanResultNote(replacesList, errors) {
  if (replacesList) {
    return "New tasks are added. Tasks on your list that aren't in these screenshots are removed.";
  }
  if (errors.length) {
    return "Some screenshots couldn't be read, so nothing is removed from your list; new tasks are still added.";
  }
  return "No tasks were recognised, so nothing is removed from your list.";
}

/**
 * "≈1.5" (thousand tokens) for the cost estimate: one decimal up to 6 screenshots, whole
 * thousands above.
 * @param {number} screenshotCount
 */
export function estimatedThousandTokens(screenshotCount) {
  const decimals = screenshotCount > 6 ? 0 : 1;
  return (screenshotCount * ESTIMATED_THOUSAND_TOKENS_PER_SCREENSHOT).toFixed(decimals);
}
