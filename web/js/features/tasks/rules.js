// @ts-check
// Tasks: what kind of work each objective is, how a task splits into parts, which maps it's on,
// tick progress, and adding / finishing / forgetting tasks in the saved data.
// Plain functions only: no DOM, no network. Categories are in categories.js.

/** @import { Task, Objective, Part, Action, SavedState, TaskEntry, PartOnMap, MapInfo } from "../../app/types.js" */

// A task kept whole takes the first of these actions it contains: the "hardest" kind of work.
export const WHOLE_TASK_ACTION_ORDER = ["boss", "pmc", "scav", "plant", "mark", "retrieve", "go"];

/** How each action is named in the list ("part 2 of 3: marking"). */
export const ACTION_LABELS = {
  boss: "boss",
  pmc: "PMC kills",
  scav: "kills",
  mark: "marking",
  plant: "placing",
  retrieve: "pick-up",
  go: "scouting",
  offmap: "hand-in",
};

// Objective types that never happen at a place on a map (hand-ins, builds, levels…).
const OFF_MAP_OBJECTIVE_TYPES = new Set([
  "findItem",
  "giveItem",
  "buildWeapon",
  "sellItem",
  "skill",
  "traderLevel",
  "traderStanding",
  "taskStatus",
  "experience",
  "playerLevel",
]);

// Kill targets that make a kill objective a boss hunt (matched in the targets and the text).
// Open question for the owner: "The Wedge" isn't here, so it counts as a Scav kill (HANDOFF §12).
const BOSS_NAMES =
  /\b(reshala|killa|tagilla|glukhar|sanitar|shturman|kollontay|kaban|partisan|zryachiy|knight|big ?pipe|birdeye|goons)\b/;
const PMC_TARGETS = /pmc|usec|bear/;
const PMC_WORDING = /\bpmcs?\b|pmc operatives|\busec\b|\bbear operatives\b/;

// ---------------------------------------------------------------- kind of work

/**
 * The kind of work an objective is. Kills are a boss hunt, PMC kills or "any" kills (Scavs),
 * by their targets and wording. Objectives with no place on a map are "offmap".
 * @param {Objective} objective
 * @returns {Action}
 */
export function actionOfObjective(objective) {
  if (objective.type === "shoot") {
    return killAction(objective);
  }
  if (objective.type === "mark") return "mark";
  if (objective.type === "plantItem" || objective.type === "plantQuestItem") return "plant";
  if (objective.type === "findQuestItem") return "retrieve";
  if (objective.type === "visit" || objective.type === "extract" || objective.type === "useItem") {
    return "go";
  }
  if (OFF_MAP_OBJECTIVE_TYPES.has(objective.type)) return "offmap";
  const hasAPlace = (objective.zones && objective.zones.length) || (objective.maps && objective.maps.length);
  return hasAPlace ? "go" : "offmap";
}

/**
 * @param {Objective} objective a "shoot" objective
 * @returns {Action}
 */
function killAction(objective) {
  const targets = (objective.targets || []).join(" ").toLowerCase();
  const text = (objective.d || "").toLowerCase();
  if (BOSS_NAMES.test(targets) || BOSS_NAMES.test(text)) return "boss";
  if (PMC_TARGETS.test(targets) || PMC_WORDING.test(text)) return "pmc";
  return "scav";
}

/**
 * Whether the task must be done in one raid (its text says "(In one raid)"): such tasks never split.
 * @param {Task} task
 */
export function isOneRaidTask(task) {
  return task.objs.some((objective) => /\(in one raid\)/i.test(objective.d || ""));
}

// ---------------------------------------------------------------- parts

// Splitting is pure and the game data rarely changes, so each task's parts are kept until new
// game data arrives (clearPartsCache).
const partsCache = new Map();

/** Forget the remembered parts (call when new game data arrives). */
export function clearPartsCache() {
  partsCache.clear();
}

/**
 * Split a task into parts by kind of work.
 * - Glue rules: a "hand over" (giveQuestItem) joins the part that picks that item up (else the
 *   Retrieve part); a "survive and extract" joins the group before it (or the first group).
 * - Tasks stay whole when they say "(In one raid)", when you ticked Don't split (`noSplit`), or
 *   when they have only one group. A whole task is keyed "<id>:*" and takes the first action in
 *   WHOLE_TASK_ACTION_ORDER; split parts are keyed "<id>:<action>", ordered by their first objective.
 * @param {Task} task
 * @param {boolean} [noSplit]
 * @returns {Part[]}
 */
export function partsOfTask(task, noSplit = false) {
  const cacheKey = task.id + (noSplit ? "|1" : "|0");
  if (partsCache.has(cacheKey)) {
    return partsCache.get(cacheKey);
  }
  const { groups, groupByAction } = groupObjectivesByAction(task);
  const staysWhole = noSplit || isOneRaidTask(task) || groups.length <= 1;
  const parts = staysWhole ? [wholeTaskPart(task, groups, groupByAction)] : splitParts(task, groups);
  partsCache.set(cacheKey, parts);
  return parts;
}

/**
 * The task's on-map objectives grouped by action, in order of first appearance, with the glue
 * rules applied. Off-map objectives are left out.
 * @param {Task} task
 */
function groupObjectivesByAction(task) {
  /** @type {{ action: Action, objs: Objective[] }[]} */
  const groups = [];
  /** @type {Record<string, { action: Action, objs: Objective[] }>} */
  const groupByAction = {};
  const extractsBeforeAnyGroup = [];
  const handOvers = [];
  let lastGroup = null;
  for (const objective of task.objs) {
    if (objective.type === "giveQuestItem") {
      handOvers.push(objective);
      continue;
    }
    if (objective.type === "extract") {
      if (lastGroup) lastGroup.objs.push(objective);
      else extractsBeforeAnyGroup.push(objective);
      continue;
    }
    const action = actionOfObjective(objective);
    if (action === "offmap") continue;
    let group = groupByAction[action];
    if (!group) {
      group = groupByAction[action] = { action, objs: [] };
      groups.push(group);
    }
    group.objs.push(objective);
    lastGroup = group;
  }
  addLeadingExtracts(groups, groupByAction, extractsBeforeAnyGroup);
  addHandOvers(groups, groupByAction, handOvers);
  return { groups, groupByAction };
}

/** An extract before any other objective joins the first group, or becomes a "go" group of its own. */
function addLeadingExtracts(groups, groupByAction, extracts) {
  if (!extracts.length) return;
  if (groups.length) {
    groups[0].objs.push(...extracts);
  } else {
    const group = (groupByAction.go = { action: "go", objs: extracts });
    groups.push(group);
  }
}

/** A hand-over joins the group that finds the same quest item, else the Retrieve group (if any). */
function addHandOvers(groups, groupByAction, handOvers) {
  for (const handOver of handOvers) {
    const findsThisItem = (group) =>
      group.objs.some((objective) => objective.type === "findQuestItem" && objective.qi && objective.qi === handOver.qi);
    const home = groups.find(findsThisItem) || groupByAction.retrieve;
    if (home) home.objs.push(handOver);
  }
}

/**
 * @param {Task} task
 * @param {Objective[]} objectives
 * @returns {Objective[]} the same objectives, in the task's order
 */
function inTaskOrder(task, objectives) {
  return objectives.slice().sort((a, b) => task.objs.indexOf(a) - task.objs.indexOf(b));
}

/** @returns {Part} */
function wholeTaskPart(task, groups, groupByAction) {
  const action = groups.length ? WHOLE_TASK_ACTION_ORDER.find((candidate) => groupByAction[candidate]) : "offmap";
  const objectives = inTaskOrder(task, groups.flatMap((group) => group.objs));
  return { key: task.id + ":*", action, objs: objectives, split: false, index: 0, total: 1 };
}

/** @returns {Part[]} one part per group, ordered by where each group starts in the task */
function splitParts(task, groups) {
  const firstIndexOf = (group) => task.objs.indexOf(inTaskOrder(task, group.objs)[0]);
  const ordered = groups.slice().sort((a, b) => firstIndexOf(a) - firstIndexOf(b));
  return ordered.map((group, index) => ({
    key: task.id + ":" + group.action,
    action: group.action,
    objs: inTaskOrder(task, group.objs),
    split: true,
    index,
    total: ordered.length,
  }));
}

/**
 * Whether the task would split (so "Don't split" is worth offering).
 * @param {Task} task
 */
export function canTaskSplit(task) {
  return partsOfTask(task, false).length > 1;
}

/**
 * "part 2 of 3: marking" for a split part; "" for a whole task.
 * @param {Part} part
 */
export function partLabel(part) {
  return part.split ? `part ${part.index + 1} of ${part.total}: ${ACTION_LABELS[part.action]}` : "";
}

// ---------------------------------------------------------------- maps

/**
 * Whether an objective happens on this map: a zone, possible spot or map listed for it. An
 * objective with none of those belongs to the task's own map.
 * @param {Objective} objective
 * @param {string} mapKey
 * @param {Task} task
 */
export function isObjectiveOnMap(objective, mapKey, task) {
  const hasZoneHere = objective.zones.some((zone) => zone.m === mapKey);
  const hasSpotHere = objective.poss.some((spots) => spots.m === mapKey);
  if (hasZoneHere || hasSpotHere || objective.maps.includes(mapKey)) return true;
  const hasNoPlace = !objective.maps.length && !objective.zones.length && !objective.poss.length;
  return hasNoPlace && task.map === mapKey;
}

/**
 * Whether any of the task is on this map.
 * @param {Task} task
 * @param {string} mapKey
 */
export function isTaskOnMap(task, mapKey) {
  if (task.map === mapKey) return true;
  return task.objs.some(
    (objective) =>
      objective.maps.includes(mapKey) ||
      objective.zones.some((zone) => zone.m === mapKey) ||
      objective.poss.some((spots) => spots.m === mapKey),
  );
}

/**
 * Every map the task mentions, the task's own map first, then in objective order.
 * @param {Task} task
 * @returns {string[]}
 */
export function mapsOfTask(task) {
  const mapKeys = new Set();
  if (task.map) mapKeys.add(task.map);
  for (const objective of task.objs) {
    objective.maps.forEach((mapKey) => mapKey && mapKeys.add(mapKey));
    objective.zones.forEach((zone) => zone.m && mapKeys.add(zone.m));
    objective.poss.forEach((spots) => spots.m && mapKeys.add(spots.m));
  }
  return [...mapKeys];
}

/**
 * @param {Part} part
 * @param {string} mapKey
 * @param {Task} task
 */
export function isPartOnMap(part, mapKey, task) {
  return part.objs.some((objective) => isObjectiveOnMap(objective, mapKey, task));
}

/**
 * Where an "extract" objective without a zone happens: the extracts its text names ("survive and
 * extract through Crash Site"), then the transit of "transit from X to Y", in the data's order.
 * @param {Objective} objective
 * @param {MapInfo} mapInfo
 * @returns {{ x: number, z: number }[]}
 */
export function placesNamedByExtractObjective(objective, mapInfo) {
  const places = [];
  const text = objective.d.toLowerCase();
  for (const extract of mapInfo.extracts) {
    if (text.includes(extract.n.toLowerCase())) places.push(extract);
  }
  const transitTo = objective.d.match(/transit from .+? to (.+?)(?: \(|$)/i);
  if (transitTo) {
    const transitName = "transit to " + transitTo[1].toLowerCase().trim();
    for (const transit of mapInfo.transits) {
      if (transit.n.toLowerCase() === transitName) places.push(transit);
    }
  }
  return places;
}

/**
 * A task with nothing to do on a map (only hand-ins, builds…): its found-in-raid items still go
 * in every map's Bring list.
 * @param {Task} task
 */
export function isOffMapTask(task) {
  return partsOfTask(task)[0].action === "offmap";
}

// ---------------------------------------------------------------- ticks and progress

/**
 * How many ticks finish an objective: its count, at least 1.
 * @param {Objective} objective
 */
export function tickTarget(objective) {
  return Math.max(objective.n || 0, 1);
}

/**
 * How far an objective is: a saved `true` is done; a saved count is kept between 0 and the target.
 * @param {Objective} objective
 * @param {Record<string, true | number>} ticks
 */
export function tickCount(objective, ticks) {
  const saved = ticks[objective.id];
  if (saved === true) return tickTarget(objective);
  return typeof saved === "number" ? Math.max(0, Math.min(saved, tickTarget(objective))) : 0;
}

/**
 * @param {Objective} objective
 * @param {Record<string, true | number>} ticks
 */
export function isObjectiveDone(objective, ticks) {
  return tickCount(objective, ticks) >= tickTarget(objective);
}

/**
 * Objectives with more than one to do (kills, items) get a − n/N + counter instead of a checkbox.
 * @param {Objective} objective
 */
export function usesCounter(objective) {
  return (objective.n || 0) > 1;
}

/** The objectives that count for progress: the non-optional ones, or all when every one is optional. */
function requiredObjectives(part) {
  const required = part.objs.filter((objective) => !objective.opt);
  return required.length ? required : part.objs;
}

/**
 * A part is done (and drops off the map) when all its required objectives are ticked.
 * @param {Part} part
 * @param {Record<string, true | number>} ticks
 */
export function isPartDone(part, ticks) {
  return part.objs.length > 0 && requiredObjectives(part).every((objective) => isObjectiveDone(objective, ticks));
}

/**
 * Progress of a part in whole percent: the average of each required objective's ticks / target.
 * @param {Part} part
 * @param {Record<string, true | number>} ticks
 */
export function partProgressPercent(part, ticks) {
  const required = requiredObjectives(part);
  if (!required.length) return 0;
  let sum = 0;
  for (const objective of required) {
    sum = sum + tickCount(objective, ticks) / tickTarget(objective);
  }
  return Math.round((sum / required.length) * 100);
}

/**
 * The count before a change, as setTick sees it: `true` counts as the target, a saved number
 * as it is (not clamped), anything else as 0.
 * @param {Objective} objective
 * @param {Record<string, true | number>} ticks
 */
export function savedTickCount(objective, ticks) {
  const saved = ticks[objective.id];
  if (saved === true) return tickTarget(objective);
  return typeof saved === "number" ? saved : 0;
}

/**
 * The new count when you set an objective to `value`: true = done, false = not done, or a count.
 * Kept between 0 and the target.
 * @param {Objective} objective
 * @param {boolean | number} value
 */
export function clampedTickCount(objective, value) {
  const target = tickTarget(objective);
  let wanted = value;
  if (value === true) wanted = target;
  else if (value === false) wanted = 0;
  return Math.max(0, Math.min(target, /** @type {number} */ (wanted)));
}

/**
 * Store a count: 0 removes the tick; a single objective that's done is stored as `true`.
 * @param {Record<string, true | number>} ticks
 * @param {Objective} objective
 * @param {number} count
 */
export function storeTick(ticks, objective, count) {
  const target = tickTarget(objective);
  if (count === 0) {
    delete ticks[objective.id];
  } else {
    ticks[objective.id] = count >= target && target === 1 ? true : count;
  }
}

// ---------------------------------------------------------------- your task list (saved data)

/**
 * Put a task on your list (from a scan, the game log, or by hand). A task already on the list
 * keeps where it came from and when; `extra` fields (scan progress…) are always written.
 * @param {TaskEntry} entry the task's entry (created by the caller when missing)
 * @param {string} source "scan", "log" or "manual"
 * @param {Partial<TaskEntry>} extra
 * @param {number} now
 * @returns {boolean} true when the task wasn't on the list before
 */
export function activateTaskEntry(entry, source, extra, now) {
  const wasActive = entry.active;
  Object.assign(
    entry,
    { active: true, source: wasActive ? entry.source : source, addedAt: wasActive ? entry.addedAt : now },
    extra,
  );
  return !wasActive;
}

/**
 * A task finished or failed in the game (from the log): off the list, ticks cleared, unpinned.
 * Its categories and sub-tasks are kept, in case it comes back.
 * @param {SavedState} saved
 * @param {string} taskId
 * @param {Task | undefined} task
 * @returns {boolean} false when it wasn't on the list
 */
export function finishTaskEntry(saved, taskId, task) {
  const entry = saved.tasks[taskId];
  if (!entry || !entry.active) return false;
  entry.active = false;
  entry.pinned = false;
  if (task) {
    for (const objective of task.objs) delete saved.ticks[objective.id];
  }
  return true;
}

/**
 * Drop a task as if it was never added: its entry (categories, pin, Don't split), ticks, used
 * counts and sub-tasks. Used when a scan replaces the list (owner's decision).
 * @param {SavedState} saved
 * @param {string} taskId
 * @param {Task | undefined} task
 */
export function forgetTask(saved, taskId, task) {
  delete saved.tasks[taskId];
  if (task) {
    for (const objective of task.objs) {
      delete saved.ticks[objective.id];
      if (saved.used) delete saved.used[objective.id];
    }
  }
  saved.subs = saved.subs.filter((subTask) => subTask.task !== taskId);
}

/**
 * Order of rows in a category: by task name, ignoring a leading "The ", then by part.
 * @param {PartOnMap} a
 * @param {PartOnMap} b
 */
export function compareRowsByName(a, b) {
  const nameA = a.task.name.replace(/^The /, "");
  const nameB = b.task.name.replace(/^The /, "");
  return nameA.localeCompare(nameB) || a.part.index - b.part.index;
}

/**
 * Whether a row is drawn on the map: its category is shown, it isn't done, and with "Pinned only"
 * on, it's pinned.
 * @param {PartOnMap} row
 * @param {boolean} isPinnedOnly
 */
export function isRowShownOnMap(row, isPinnedOnly) {
  return row.cat.visible && !row.done && (!isPinnedOnly || row.pinned);
}
