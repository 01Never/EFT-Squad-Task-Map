// @ts-check
// Readiness: what each objective needs you to carry (keys, items to place, gear), whether you
// have it, what ticking an objective takes out of your bag, and the Bring list.
// Plain functions only: no DOM, no network. panel.js draws the Bring list and the tags.
import { isObjectiveDone, isObjectiveOnMap, tickCount, tickTarget } from "../tasks/rules.js";

/** @import { Objective, Part, Item, Task, SavedState } from "../../app/types.js" */

/**
 * @typedef {object} Requirement One thing an objective needs.
 * @property {"key" | "place" | "gear"} kind
 * @property {string} key the bag key: an item id, or a stable id for a set of alternatives
 * @property {Item[]} items alternatives: any one of these will do
 * @property {number} need how many
 * @property {string} label "Key (any one)", "Marker", "Wear"…
 */

/**
 * @typedef {object} BringEntry One line of the Bring list.
 * @property {string} key the bag key
 * @property {"key" | "place" | "gear" | "fir"} kind
 * @property {string} [label]
 * @property {boolean} [fir] found in raid
 * @property {string} name
 * @property {Item[]} items
 * @property {number} need
 * @property {number} have
 * @property {boolean} [onKeyList] a key line: a key on this map's key list will do (ticket 09)
 * @property {[string, number][]} by [task name, count] pairs
 */

// Ticket 09: keys on the open map's key list count as had, raid after raid. Callers that don't
// pass a key list get this empty one.
/** @type {Set<string>} */
const NO_KEY_LIST = new Set();

// "mark" objectives without their own marker item use the MS2000 marker.
const MS2000_MARKER = { id: "5991b51486f77447b112d44f", name: "MS2000 Marker" };

// "Must wear" lists of up to this many single items are all needed (e.g. armor + helmet);
// longer lists, or lists of combinations, are alternative outfits (any one will do).
// The game data doesn't say which it is; this split matched every task checked in v2.
const MAX_SINGLE_ITEMS_ALL_NEEDED = 4;

// The Bring list names a set of alternatives by its first few items.
const ALTERNATIVES_NAMED_IN_LIST = 3;

/** A short, stable hash of a text (djb2), written in base 36. */
function textHash(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/**
 * One bag key per requirement: the item id, or "any:<hash>" for a set of alternatives (the same
 * set gives the same key whatever its order).
 * @param {Item[]} items
 */
export function requirementKey(items) {
  const ids = [...new Set(items.map((item) => item.id))].sort();
  return ids.length === 1 ? ids[0] : "any:" + textHash(ids.join(","));
}

// Requirements depend only on the objective, which never changes while the data is loaded.
const requirementsCache = new WeakMap();

/**
 * What one objective needs:
 * - key: each key group is alternatives; every group is needed.
 * - place: the marker (mark), or the items to plant (alternatives) × the count.
 * - gear: a weapon (alternatives), things to wear (see MAX_SINGLE_ITEMS_ALL_NEEDED), weapon mods.
 * @param {Objective} objective
 * @returns {Requirement[]}
 */
export function requirementsOf(objective) {
  if (requirementsCache.has(objective)) return requirementsCache.get(objective);
  const requirements = [
    ...keyRequirements(objective),
    ...placeRequirements(objective),
    ...gearRequirements(objective),
  ];
  requirementsCache.set(objective, requirements);
  return requirements;
}

/** @returns {Requirement[]} */
function keyRequirements(objective) {
  const requirements = [];
  for (const keyGroup of objective.keys || []) {
    if (!keyGroup.length) continue;
    const label = keyGroup.length > 1 ? "Key (any one)" : "Key";
    requirements.push({ kind: "key", key: requirementKey(keyGroup), items: keyGroup, need: 1, label });
  }
  return requirements;
}

/** @returns {Requirement[]} */
function placeRequirements(objective) {
  const requirements = [];
  if (objective.type === "mark") {
    const marker = objective.marker || MS2000_MARKER;
    requirements.push({ kind: "place", key: marker.id, items: [marker], need: 1, label: "Marker" });
  }
  if (objective.type === "plantItem" && objective.items.length) {
    const label = objective.items.length > 1 ? "Place (any one)" : "Place";
    const key = requirementKey(objective.items);
    requirements.push({ kind: "place", key, items: objective.items, need: tickTarget(objective), label });
  }
  return requirements;
}

/** @returns {Requirement[]} */
function gearRequirements(objective) {
  const gear = objective.gear;
  if (!gear) return [];
  const requirements = [];
  if (gear.weapons.length) {
    const label = gear.weapons.length > 1 ? "Weapon (any one)" : "Weapon";
    requirements.push({ kind: "gear", key: requirementKey(gear.weapons), items: gear.weapons, need: 1, label });
  }
  requirements.push(...wearRequirements(gear.wearing || []));
  const mods = gear.mods || [];
  if (mods.length) {
    const label = mods.length > 1 ? "Weapon mods (any one set)" : "Weapon mods";
    requirements.push({ kind: "gear", key: "mods:" + textHash(setsSignature(mods)), items: setsAsItems(mods), need: 1, label });
  }
  return requirements;
}

/** Things to wear: each single item needed on its own, or one requirement for "any one outfit". */
function wearRequirements(wearing) {
  if (!wearing.length) return [];
  const isSingleItems = wearing.every((outfit) => outfit.length === 1) && wearing.length <= MAX_SINGLE_ITEMS_ALL_NEEDED;
  if (isSingleItems) {
    return wearing.map((outfit) => ({ kind: "gear", key: outfit[0].id, items: outfit, need: 1, label: "Wear" }));
  }
  const key = "outfit:" + textHash(setsSignature(wearing));
  return [{ kind: "gear", key, items: setsAsItems(wearing), need: 1, label: "Wear (any one outfit)" }];
}

/** A stable text for a list of item sets, whatever their order. */
function setsSignature(sets) {
  return sets
    .map((set) => set.map((item) => item.id).sort().join("+"))
    .sort()
    .join("|");
}

/** Each set shown as one "item": "Helmet + Vest". */
function setsAsItems(sets) {
  return sets.map((set) => ({
    id: set.map((item) => item.id).join("+"),
    name: set.map((item) => item.name).join(" + "),
  }));
}

/**
 * Whether the bag has at least one of something.
 * @param {Record<string, number>} bag
 * @param {string} key
 */
export function hasAtLeastOne(bag, key) {
  return (bag[key] || 0) >= 1;
}

/**
 * Whether a key requirement is met by your key list (ticket 09): any of its keys is on the list.
 * Keys on the open map's list count as had there, raid after raid, without touching the bag.
 * @param {{ kind: string, items: Item[] }} requirement a requirement or a Bring list line
 * @param {Set<string>} keyList
 */
export function isOnKeyList(requirement, keyList) {
  if (requirement.kind !== "key" || !keyList.size) return false;
  return requirement.items.some((item) => keyList.has(item.id));
}

/**
 * Whether you have what a requirement asks for: at least one in the bag, or (keys) on your key list.
 * @param {Requirement} requirement
 * @param {Record<string, number>} bag
 * @param {Set<string>} [keyList] the open map's key list
 */
export function hasRequirement(requirement, bag, keyList = NO_KEY_LIST) {
  return hasAtLeastOne(bag, requirement.key) || isOnKeyList(requirement, keyList);
}

/**
 * An objective is possible when you carry at least one of everything it needs (a key on the map's
 * key list counts as carried).
 * @param {Objective} objective
 * @param {Record<string, number>} bag
 * @param {Set<string>} [keyList] the open map's key list
 */
export function isObjectivePossible(objective, bag, keyList = NO_KEY_LIST) {
  return requirementsOf(objective).every((requirement) => hasRequirement(requirement, bag, keyList));
}

/**
 * A part is possible when, for every objective you haven't ticked yet, you carry at least one of
 * each thing it needs. Example: 2 markers and 5 marker spots → all 5 spots are possible.
 * @param {Part} part
 * @param {Record<string, true | number>} ticks
 * @param {Record<string, number>} bag
 * @param {Set<string>} [keyList] the open map's key list
 */
export function isPartPossible(part, ticks, bag, keyList = NO_KEY_LIST) {
  const remaining = part.objs.filter((objective) => !isObjectiveDone(objective, ticks));
  return remaining.every((objective) => isObjectivePossible(objective, bag, keyList));
}

/**
 * What ticking this objective uses up: a marker for "mark", the planted item for "plantItem".
 * @param {Objective} objective
 * @returns {Requirement | null}
 */
export function usedUpByTicking(objective) {
  if (objective.type === "mark" || objective.type === "plantItem") {
    return requirementsOf(objective).find((requirement) => requirement.kind === "place") || null;
  }
  return null;
}

/**
 * Ticking a marker or plant objective takes one out of the bag per tick (when the bag has one)
 * and remembers it in `used`, so unticking only gives back what that tick took.
 * @param {SavedState} saved changed in place: `have` and `used`
 * @param {Objective} objective
 * @param {number} tickChange new count minus old count
 */
export function updateBagForTick(saved, objective, tickChange) {
  const usedUp = usedUpByTicking(objective);
  if (!usedUp || !tickChange) return;
  saved.used = saved.used || {};
  if (tickChange > 0) {
    takeFromBag(saved, usedUp.key, objective.id, tickChange);
  } else {
    giveBackToBag(saved, usedUp.key, objective.id, -tickChange);
  }
}

/** Placed: take from the bag, if anything was counted. */
function takeFromBag(saved, bagKey, objectiveId, count) {
  const taken = Math.min(count, saved.have[bagKey] || 0);
  if (!taken) return;
  saved.have[bagKey] -= taken;
  saved.used[objectiveId] = (saved.used[objectiveId] || 0) + taken;
}

/** Unticked: give back only what this objective took. */
function giveBackToBag(saved, bagKey, objectiveId, count) {
  const givenBack = Math.min(count, saved.used[objectiveId] || 0);
  if (!givenBack) return;
  saved.have[bagKey] = (saved.have[bagKey] || 0) + givenBack;
  saved.used[objectiveId] -= givenBack;
  if (!saved.used[objectiveId]) delete saved.used[objectiveId];
}

/**
 * How many different keys a part needs for its objectives on this map (the 🔑 badge on its row).
 * @param {Task} task
 * @param {Part} part
 * @param {string} mapKey
 */
export function countKeysNeeded(task, part, mapKey) {
  const keyIds = new Set();
  for (const objective of part.objs) {
    if (!isObjectiveOnMap(objective, mapKey, task)) continue;
    for (const requirement of requirementsOf(objective)) {
      if (requirement.kind === "key") keyIds.add(requirement.key);
    }
  }
  return keyIds.size;
}

// ---------------------------------------------------------------- your bag (the "have" counts)

/**
 * − / + on a Bring list line: one less or one more, never below 0 (0 removes the count).
 * @param {Record<string, number>} bag changed in place
 * @param {string} key
 * @param {number} step
 */
export function stepBagCount(bag, key, step) {
  bag[key] = Math.max(0, (bag[key] || 0) + step);
  if (!bag[key]) delete bag[key];
}

/**
 * A count typed into a Bring list line: rounded, never below 0; anything that isn't a number is 0.
 * @param {Record<string, number>} bag changed in place
 * @param {string} key
 * @param {string} typedValue
 */
export function setBagCount(bag, key, typedValue) {
  const count = Math.max(0, Math.round(+typedValue || 0));
  if (count) bag[key] = count;
  else delete bag[key];
}

// ---------------------------------------------------------------- the Bring list

/** "Item", or "A / B / C +2 more" for alternatives. */
function itemsLabel(items) {
  if (items.length === 1) return items[0].name;
  const named = items
    .slice(0, ALTERNATIVES_NAMED_IN_LIST)
    .map((item) => item.name)
    .join(" / ");
  const more = items.length > ALTERNATIVES_NAMED_IN_LIST ? ` +${items.length - ALTERNATIVES_NAMED_IN_LIST} more` : "";
  return named + more;
}

/**
 * The Bring list for what's shown on the map, by section, each sorted by name:
 * - keys, items to place and gear for the given objectives (not done ones). Keys and gear need 1;
 *   items to place add up the remaining count of every objective.
 * - found-in-raid items for hand-ins of `firTasks` (finds, plus hand-ins with no matching find).
 * Lines with nothing left to bring are left out; `have` is the bag count. A key line whose key is
 * on the map's key list says so (`onKeyList`) and isn't missing.
 * @param {{ task: Task, o: Objective }[]} entries the shown objectives
 * @param {Record<string, true | number>} ticks
 * @param {Record<string, number>} bag
 * @param {Task[]} [firTasks]
 * @param {Set<string>} [keyList] the open map's key list
 * @returns {{ keys: BringEntry[], place: BringEntry[], gear: BringEntry[], fir: BringEntry[] }}
 */
export function bringList(entries, ticks, bag, firTasks = [], keyList = NO_KEY_LIST) {
  const sections = gearKeysAndPlaceLines(entries, ticks);
  const foundInRaid = foundInRaidLines(firTasks, ticks);
  /** @param {Map<string, any>} lines */
  const finished = (lines) =>
    [...lines.values()]
      .filter((line) => line.need > 0)
      .map((line) => ({ ...line, have: bag[line.key] || 0, by: [...line.by.entries()] }))
      .sort((first, second) => first.name.localeCompare(second.name));
  const keyLines = finished(sections.key).map((line) => ({ ...line, onKeyList: isOnKeyList(line, keyList) }));
  return {
    keys: keyLines,
    place: finished(sections.place),
    gear: finished(sections.gear),
    fir: finished(foundInRaid),
  };
}

/** Keys, items to place and gear, one line per bag key, counting which task needs how many. */
function gearKeysAndPlaceLines(entries, ticks) {
  const sections = { key: new Map(), place: new Map(), gear: new Map() };
  for (const { task, o: objective } of entries) {
    if (isObjectiveDone(objective, ticks)) continue;
    for (const requirement of requirementsOf(objective)) {
      const lines = sections[requirement.kind];
      let line = lines.get(requirement.key);
      if (!line) {
        line = newLine(requirement.key, requirement.kind, requirement.items, { label: requirement.label });
        lines.set(requirement.key, line);
      }
      const isPlace = requirement.kind === "place";
      const remaining = isPlace ? Math.max(0, tickTarget(objective) - tickCount(objective, ticks)) : 1;
      line.by.set(task.name, (line.by.get(task.name) || 0) + (isPlace ? remaining : 1));
      line.need = isPlace ? line.need + remaining : 1;
    }
  }
  return sections;
}

/**
 * Found-in-raid items for hand-ins. A task's "find" objectives count; a "hand over" counts only
 * when no find objective asks for the same items (so they aren't counted twice).
 */
function foundInRaidLines(firTasks, ticks) {
  const lines = new Map();
  for (const task of firTasks) {
    const finds = task.objs.filter((objective) => objective.type === "findItem" && objective.items.length);
    const findKeys = new Set(finds.map((objective) => requirementKey(objective.items)));
    const handOvers = task.objs.filter(
      (objective) => objective.type === "giveItem" && objective.items.length && !findKeys.has(requirementKey(objective.items)),
    );
    for (const objective of finds.concat(handOvers)) {
      if (isObjectiveDone(objective, ticks)) continue;
      const key = requirementKey(objective.items) + (objective.fir ? ":fir" : "");
      let line = lines.get(key);
      if (!line) {
        line = newLine(key, "fir", objective.items, { fir: objective.fir });
        lines.set(key, line);
      }
      const remaining = Math.max(0, tickTarget(objective) - tickCount(objective, ticks));
      line.need += remaining;
      line.by.set(task.name, (line.by.get(task.name) || 0) + remaining);
    }
  }
  return lines;
}

/**
 * How many keys, items to place and gear you have none of (found-in-raid items are for hand-ins
 * and don't count; keys on your key list are had): the number on the Bring list tab.
 * @param {{ keys: BringEntry[], place: BringEntry[], gear: BringEntry[] }} bring
 */
export function countMissing(bring) {
  return [...bring.keys, ...bring.place, ...bring.gear].filter((line) => line.have < 1 && !line.onKeyList).length;
}

/** A Bring list line before counting (field order as v2 had it: key, kind, label or fir, name…). */
function newLine(key, kind, items, extra) {
  return { key, kind, ...extra, name: itemsLabel(items), items, need: 0, by: new Map() };
}
