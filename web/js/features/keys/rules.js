// @ts-check
// My keys (ticket 09): your saved key list per map, which keys matter on a map, which doors your
// keys open, the loot likely behind a door, copying a list to another map, and friends' keys.
// Plain functions: no DOM, no network. Drawing is map-layer.js; the panel section is panel.js.
import { isObjectiveOnMap } from "../tasks/rules.js";

/** @import { SavedState, Task, Item } from "../../app/types.js" */
/** @import { MapLoot } from "../loot/rules.js" */

/**
 * @typedef {object} Lock A locked door or trunk from /api/loot/<map> (ticket 08's `locks`).
 * @property {string} key the key's item id
 * @property {string} type "door" or "trunk"
 * @property {boolean} power the lock needs the power switched on
 * @property {number} x game position (y = height)
 * @property {number} y
 * @property {number} z
 * @property {number[][]} [ol] the door's footprint as [x, z] points (10 of 283 locks have one)
 * @property {number} [top]
 * @property {number} [bottom]
 */

/**
 * @typedef {object} KeyChoice A key you can pick for a map.
 * @property {string} id item id
 * @property {string} name
 * @property {Record<string, number>} lockCounts by lock type, locks it opens on this map
 * @property {number} lockTotal
 * @property {string[]} taskNames tasks on this map that need it, by name
 */

/**
 * @typedef {"mine" | "other" | "unknown"} DoorStatus
 * mine = a key on your list opens it; other = a key you don't have; unknown = the data names a
 * placeholder key (see PLACEHOLDER_KEY_ID).
 */

/**
 * @typedef {object} DoorToDraw
 * @property {Lock} lock
 * @property {DoorStatus} status
 * @property {number} index the lock's position in the map's `locks` (its id on the page)
 */

// ---------------------------------------------------------------- the numbers

// Loot within this distance of a locked door, on the same floor, is shown as "likely behind it".
// The data has door positions, not room walls, so this is an estimate (owner's default for the
// ticket 09 open question; tune after the owner checks in-game).
export const LOOT_BEHIND_DOOR_RADIUS_METERS = 8;

// "On the same floor" means within this height of the door. A lock's height is the middle of the
// door (about a metre above its floor) and a storey is about 3 m, so ±1.5 m keeps the door's own
// floor and leaves out the ones above and below. Floor badges aren't used: in the real data they
// split rooms at floor boundaries (Customs dorm 314's door reads "3rd floor", the loot on its
// shelves "2nd floor"), while the heights put both on one floor (checked on dorms 114, 206, 314).
export const SAME_FLOOR_MAX_HEIGHT_DIFFERENCE_METERS = 1.5;

// tarkov.dev's data names the "Factory emergency exit key" for 3 locks on Factory, where it is
// right, but also for locks on Customs (3), Interchange (13), Streets (6) and Ground Zero (2),
// where it looks like a placeholder for a key nobody has filled in yet (QA of ticket 08,
// 2026-10-07). On other maps those locks show as "Unknown key (data incomplete)", only under
// "All locked doors", and never count as doors the key opens. Revisit when the data is fixed.
export const PLACEHOLDER_KEY_ID = "5448ba0b4bdc2d02308b456c";
const PLACEHOLDER_KEY_HOME_MAP = "factory";
export const UNKNOWN_KEY_NAME = "Unknown key (data incomplete)";

// What the saved data and a friend's share may hold (the squad server checks the same numbers:
// internal/features/squad/rules.go).
export const MAX_KEY_LIST_MAPS = 64;
export const MAX_KEYS_PER_MAP = 200;
const KEY_ID_PATTERN = /^[0-9a-f]{24}$/;
// Map keys are short lower-case words ("streets-of-tarkov"). "constructor" and "prototype" are
// the only such words that mean something to a JavaScript object, so they're refused by name.
const MAP_KEY_PATTERN = /^[a-z0-9-]{1,64}$/;
const RESERVED_MAP_KEYS = new Set(["constructor", "prototype"]);

// How lock types read in the panel ("3 doors, 1 trunk"). Other types use "lock".
const LOCK_TYPE_WORDS = { door: ["door", "doors"], trunk: ["trunk", "trunks"] };
const OTHER_LOCK_WORDS = ["lock", "locks"];

// The order lock types are listed in.
const LOCK_TYPE_ORDER = ["door", "trunk"];

/** @type {Set<string>} */
const NO_KEYS = new Set();

// ---------------------------------------------------------------- checking ids

/**
 * Whether this is a game item id (24 lower-case hex characters).
 * @param {unknown} id
 * @returns {id is string}
 */
export function isKeyId(id) {
  return typeof id === "string" && KEY_ID_PATTERN.test(id);
}

/**
 * Whether this can be a map key in a key list.
 * @param {unknown} mapKey
 * @returns {mapKey is string}
 */
export function isKeyListMapKey(mapKey) {
  return typeof mapKey === "string" && MAP_KEY_PATTERN.test(mapKey) && !RESERVED_MAP_KEYS.has(mapKey);
}

/**
 * Own-property read: saved data and friends' shares can hold any key, and names like
 * "constructor" must never find something on Object.prototype.
 * @param {unknown} object
 * @param {string} key
 * @returns {any}
 */
function ownValue(object, key) {
  if (!object || typeof object !== "object") return undefined;
  return Object.hasOwn(object, key) ? /** @type {any} */ (object)[key] : undefined;
}

/**
 * The key ids of a list, cleaned: only game ids, each once, at most MAX_KEYS_PER_MAP.
 * @param {unknown} list
 * @returns {string[]}
 */
function cleanKeyIds(list) {
  if (!Array.isArray(list)) return [];
  const ids = [];
  for (const id of list) {
    if (isKeyId(id) && !ids.includes(id)) ids.push(id);
    if (ids.length >= MAX_KEYS_PER_MAP) break;
  }
  return ids;
}

// ---------------------------------------------------------------- the saved key lists

/**
 * Saved key lists with anything odd dropped (a hand-edited or damaged file): map keys that aren't
 * plain lower-case words, ids that aren't game ids, repeats, empty lists, and anything over the
 * limits. Returns a new object.
 * @param {unknown} saved
 * @returns {Record<string, string[]>}
 */
export function cleanKeyring(saved) {
  /** @type {Record<string, string[]>} */
  const keyring = {};
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return keyring;
  for (const mapKey of Object.keys(saved)) {
    if (Object.keys(keyring).length >= MAX_KEY_LIST_MAPS) break;
    if (!isKeyListMapKey(mapKey)) continue;
    const ids = cleanKeyIds(ownValue(saved, mapKey));
    if (ids.length) keyring[mapKey] = ids;
  }
  return keyring;
}

/**
 * Your key list for a map: the key ids in the order you added them. Empty when the saved data
 * has no `keyring` (every file from before ticket 09) or nothing for this map.
 * @param {SavedState} saved
 * @param {string} mapKey
 * @returns {string[]}
 */
export function keyListOf(saved, mapKey) {
  if (!isKeyListMapKey(mapKey)) return [];
  return cleanKeyIds(ownValue(saved.keyring, mapKey));
}

/**
 * The same, as a set (what readiness and the door layer look keys up in).
 * @param {SavedState} saved
 * @param {string | null | undefined} mapKey
 * @returns {Set<string>}
 */
export function keyListSetOf(saved, mapKey) {
  if (!mapKey) return NO_KEYS;
  return new Set(keyListOf(saved, mapKey));
}

/**
 * Replace a map's key list, creating `keyring` the first time (it stays absent until you add a
 * key, so older files load and save back unchanged). An empty list removes the map's entry.
 * @param {SavedState} saved changed in place
 * @param {string} mapKey
 * @param {string[]} keyIds
 */
export function setKeyList(saved, mapKey, keyIds) {
  if (!isKeyListMapKey(mapKey)) return;
  const keyring = (saved.keyring = cleanKeyring(saved.keyring));
  const ids = cleanKeyIds(keyIds);
  if (ids.length) keyring[mapKey] = ids;
  else delete keyring[mapKey];
}

/**
 * Add a key at the end of a map's list (nothing changes if it's already there or the list is full).
 * @param {SavedState} saved
 * @param {string} mapKey
 * @param {string} keyId
 * @returns {boolean} whether it was added
 */
export function addKeyToList(saved, mapKey, keyId) {
  const list = keyListOf(saved, mapKey);
  if (!isKeyId(keyId) || list.includes(keyId) || list.length >= MAX_KEYS_PER_MAP) return false;
  setKeyList(saved, mapKey, [...list, keyId]);
  return true;
}

/**
 * Take a key off a map's list.
 * @param {SavedState} saved
 * @param {string} mapKey
 * @param {string} keyId
 * @returns {number} where it was (for Undo), or -1 when it wasn't on the list
 */
export function removeKeyFromList(saved, mapKey, keyId) {
  const list = keyListOf(saved, mapKey);
  const position = list.indexOf(keyId);
  if (position < 0) return -1;
  list.splice(position, 1);
  setKeyList(saved, mapKey, list);
  return position;
}

/**
 * Undo of a removal: the key goes back where it was.
 * @param {SavedState} saved
 * @param {string} mapKey
 * @param {string} keyId
 * @param {number} position
 */
export function putKeyBack(saved, mapKey, keyId, position) {
  const list = keyListOf(saved, mapKey).filter((id) => id !== keyId);
  list.splice(Math.max(0, Math.min(position, list.length)), 0, keyId);
  setKeyList(saved, mapKey, list);
}

/**
 * The maps that have a key list, other than this one, with how many keys (for "Copy from").
 * @param {SavedState} saved
 * @param {string} mapKey the open map
 * @returns {{ mapKey: string, count: number }[]}
 */
export function otherMapsWithKeys(saved, mapKey) {
  const keyring = cleanKeyring(saved.keyring);
  return Object.keys(keyring)
    .filter((otherMap) => otherMap !== mapKey)
    .map((otherMap) => ({ mapKey: otherMap, count: keyring[otherMap].length }));
}

/**
 * Copying another map's list here keeps only the keys that matter on this map (they open a lock
 * here or a task here needs them), adds them after the keys already on this map's list, and says
 * which were left out.
 * @param {string[]} currentList this map's list
 * @param {string[]} sourceList the other map's list
 * @param {Set<string>} keysThatMatterHere
 * @returns {{ list: string[], added: string[], leftOut: string[] }}
 */
export function copyKeyList(currentList, sourceList, keysThatMatterHere) {
  const list = [...currentList];
  const added = [];
  const leftOut = [];
  for (const keyId of sourceList) {
    if (list.includes(keyId)) continue;
    if (!keysThatMatterHere.has(keyId)) {
      leftOut.push(keyId);
      continue;
    }
    if (list.length >= MAX_KEYS_PER_MAP) break;
    list.push(keyId);
    added.push(keyId);
  }
  return { list, added, leftOut };
}

// ---------------------------------------------------------------- keys that matter on a map

/**
 * Whether a lock's key is the placeholder (see PLACEHOLDER_KEY_ID) on this map.
 * @param {Lock} lock
 * @param {string} mapKey
 */
export function isPlaceholderLock(lock, mapKey) {
  return lock.key === PLACEHOLDER_KEY_ID && mapKey !== PLACEHOLDER_KEY_HOME_MAP;
}

/**
 * Every key that matters on a map, for the "Add key" search: each key with a lock here (the
 * placeholder's locks left out), plus each key a task here needs (`objs[].keys`), with how many
 * locks it opens and which tasks need it. Sorted by name.
 * @param {MapLoot | null} loot this map's loot (null while it loads: tasks only)
 * @param {Task[]} tasks every task in the game data
 * @param {string} mapKey
 * @returns {KeyChoice[]}
 */
export function keysThatMatterOnMap(loot, tasks, mapKey) {
  /** @type {Map<string, KeyChoice>} */
  const choiceById = new Map();
  const choiceFor = (/** @type {string} */ id, /** @type {string} */ name) => {
    let choice = choiceById.get(id);
    if (!choice) {
      choice = { id, name, lockCounts: {}, lockTotal: 0, taskNames: [] };
      choiceById.set(id, choice);
    }
    return choice;
  };
  for (const lock of locksOf(loot)) {
    if (!isKeyId(lock.key) || isPlaceholderLock(lock, mapKey)) continue;
    const choice = choiceFor(lock.key, keyNameIn(loot, lock.key));
    choice.lockCounts[lock.type] = (choice.lockCounts[lock.type] || 0) + 1;
    choice.lockTotal++;
  }
  for (const { task, key } of keysTasksNeedOnMap(tasks, mapKey)) {
    const choice = choiceFor(key.id, choiceById.get(key.id)?.name || key.name);
    if (!choice.taskNames.includes(task.name)) choice.taskNames.push(task.name);
  }
  return [...choiceById.values()].sort((first, second) => first.name.localeCompare(second.name));
}

/**
 * Each key a task on this map needs, once per task and key.
 * @param {Task[]} tasks
 * @param {string} mapKey
 * @returns {{ task: Task, key: Item }[]}
 */
function keysTasksNeedOnMap(tasks, mapKey) {
  const found = [];
  for (const task of tasks) {
    for (const objective of task.objs) {
      if (!objective.keys || !objective.keys.length) continue;
      if (!isObjectiveOnMap(objective, mapKey, task)) continue;
      for (const keyGroup of objective.keys) {
        for (const key of keyGroup) {
          if (isKeyId(key.id)) found.push({ task, key });
        }
      }
    }
  }
  return found;
}

/**
 * Every key the game data and the loaded maps name, for the "all keys" search: keys on any
 * loaded map's locks and keys any task needs. A key that doesn't matter on this map has
 * lockTotal 0 and no tasks ("doesn't open anything here").
 * @param {KeyChoice[]} keysHere keysThatMatterOnMap for this map
 * @param {Task[]} tasks
 * @param {MapLoot[]} loadedLoots every map's loot loaded so far
 * @returns {KeyChoice[]}
 */
export function allKnownKeys(keysHere, tasks, loadedLoots) {
  /** @type {Map<string, KeyChoice>} */
  const choiceById = new Map(keysHere.map((choice) => [choice.id, choice]));
  const addElsewhere = (/** @type {string} */ id, /** @type {string} */ name) => {
    if (!isKeyId(id) || choiceById.has(id)) return;
    choiceById.set(id, { id, name, lockCounts: {}, lockTotal: 0, taskNames: [] });
  };
  for (const loot of loadedLoots) {
    for (const lock of locksOf(loot)) addElsewhere(lock.key, keyNameIn(loot, lock.key));
  }
  for (const task of tasks) {
    for (const objective of task.objs) {
      for (const keyGroup of objective.keys || []) {
        for (const key of keyGroup) addElsewhere(key.id, key.name);
      }
    }
  }
  return [...choiceById.values()].sort((first, second) => first.name.localeCompare(second.name));
}

/**
 * A map's locks, or none (loot not loaded, or a map without locks).
 * @param {MapLoot | null} loot
 * @returns {Lock[]}
 */
function locksOf(loot) {
  return loot && Array.isArray(loot.locks) ? /** @type {Lock[]} */ (loot.locks) : [];
}

/**
 * A key's name from the map's loot names; its id when the data doesn't name it.
 * @param {MapLoot | null} loot
 * @param {string} keyId
 */
function keyNameIn(loot, keyId) {
  return ownValue(loot && loot.items, keyId) || keyId;
}

/**
 * Keys whose name has every word of the search ("dorm 3" finds "Dorm room 314 marked key").
 * An empty search finds nothing.
 * @param {KeyChoice[]} choices
 * @param {string} search
 * @returns {KeyChoice[]}
 */
export function searchKeys(choices, search) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return choices.filter((choice) => {
    const name = choice.name.toLowerCase();
    return words.every((word) => name.includes(word));
  });
}

/**
 * "3 doors, 1 trunk"; "doesn't open anything here" for none.
 * @param {Record<string, number>} lockCounts
 */
export function lockCountText(lockCounts) {
  const types = Object.keys(lockCounts).sort((first, second) => lockTypeRank(first) - lockTypeRank(second));
  const parts = [];
  for (const type of types) {
    const count = lockCounts[type];
    if (!count) continue;
    const [singular, plural] = ownValue(LOCK_TYPE_WORDS, type) || OTHER_LOCK_WORDS;
    parts.push(`${count} ${count === 1 ? singular : plural}`);
  }
  return parts.length ? parts.join(", ") : "doesn't open anything here";
}

/** @param {string} type */
function lockTypeRank(type) {
  const rank = LOCK_TYPE_ORDER.indexOf(type);
  return rank < 0 ? LOCK_TYPE_ORDER.length : rank;
}

// ---------------------------------------------------------------- the doors on the map

/**
 * The doors (and trunks) to draw: every lock a key on your list opens; with "All locked doors"
 * also the rest, dimmed, including the placeholder's locks as "unknown"; and locks a friend's key
 * opens (`friendKeys`), so their dot can show.
 * @param {MapLoot} loot
 * @param {string} mapKey
 * @param {Set<string>} myKeys
 * @param {boolean} showsAllDoors
 * @param {Set<string>} [friendKeys] keys any friend has on this map
 * @returns {DoorToDraw[]}
 */
export function doorsToDraw(loot, mapKey, myKeys, showsAllDoors, friendKeys = NO_KEYS) {
  /** @type {DoorToDraw[]} */
  const doors = [];
  locksOf(loot).forEach((lock, index) => {
    const status = doorStatus(lock, mapKey, myKeys);
    const isFriendsDoor = status === "other" && friendKeys.has(lock.key);
    if (status === "mine" || showsAllDoors || isFriendsDoor) doors.push({ lock, status, index });
  });
  return doors;
}

/**
 * @param {Lock} lock
 * @param {string} mapKey
 * @param {Set<string>} myKeys
 * @returns {DoorStatus}
 */
export function doorStatus(lock, mapKey, myKeys) {
  if (isPlaceholderLock(lock, mapKey)) return "unknown";
  return myKeys.has(lock.key) ? "mine" : "other";
}

/**
 * The name a door's key shows in its popup: "Unknown key (data incomplete)" for the placeholder.
 * @param {MapLoot} loot
 * @param {Lock} lock
 * @param {string} mapKey
 */
export function doorKeyName(loot, lock, mapKey) {
  if (isPlaceholderLock(lock, mapKey)) return UNKNOWN_KEY_NAME;
  return keyNameIn(loot, lock.key);
}

/**
 * The locks a key opens on this map (none for the placeholder off Factory).
 * @param {MapLoot | null} loot
 * @param {string} keyId
 * @param {string} mapKey
 * @returns {Lock[]}
 */
export function locksOpenedBy(loot, keyId, mapKey) {
  return locksOf(loot).filter((lock) => lock.key === keyId && !isPlaceholderLock(lock, mapKey));
}

/**
 * The tasks on this map that need this key: your active ones first, then the rest, each by name.
 * @param {Task[]} tasks
 * @param {string} keyId
 * @param {string} mapKey
 * @param {(task: Task) => boolean} isActive
 * @returns {{ task: Task, isActive: boolean }[]}
 */
export function tasksUsingKey(tasks, keyId, mapKey, isActive) {
  const found = [];
  const seen = new Set();
  for (const { task, key } of keysTasksNeedOnMap(tasks, mapKey)) {
    if (key.id !== keyId || seen.has(task.id)) continue;
    seen.add(task.id);
    found.push({ task, isActive: isActive(task) });
  }
  return found.sort((first, second) => Number(second.isActive) - Number(first.isActive) || first.task.name.localeCompare(second.task.name));
}

// ---------------------------------------------------------------- loot behind a door

/**
 * @typedef {{ x: number, y: number, z: number }} GamePosition
 */

/**
 * Whether a spot is on the same floor as a door: heights within
 * SAME_FLOOR_MAX_HEIGHT_DIFFERENCE_METERS.
 * @param {GamePosition} door
 * @param {GamePosition} spot
 */
export function isSameFloor(door, spot) {
  return Math.abs(door.y - spot.y) <= SAME_FLOOR_MAX_HEIGHT_DIFFERENCE_METERS;
}

/**
 * Distance on the ground (x and z, metres), ignoring height.
 * @param {GamePosition} first
 * @param {GamePosition} second
 */
export function groundDistanceMeters(first, second) {
  return Math.hypot(first.x - second.x, first.z - second.z);
}

/**
 * Loot likely behind a door: ticket 08's containers and loose spots within
 * LOOT_BEHIND_DOOR_RADIUS_METERS of the door on the ground, on the same floor. Approximate: the
 * data has the door, not the room's walls. Nearest first.
 * @param {MapLoot} loot
 * @param {Lock} lock
 * @returns {{ chip: string, x: number, y: number, z: number, items?: string[], distance: number }[]}
 */
export function lootNearDoor(loot, lock) {
  const near = [];
  const consider = (/** @type {GamePosition} */ spot) => {
    const distance = groundDistanceMeters(lock, spot);
    if (distance > LOOT_BEHIND_DOOR_RADIUS_METERS) return null;
    if (!isSameFloor(lock, spot)) return null;
    return distance;
  };
  for (const container of loot.containers || []) {
    const distance = consider(container);
    if (distance !== null) near.push({ chip: container.t, x: container.x, y: container.y, z: container.z, distance });
  }
  for (const spot of loot.loose || []) {
    const distance = consider(spot);
    if (distance !== null) near.push({ chip: "loose", x: spot.x, y: spot.y, z: spot.z, items: spot.i, distance });
  }
  return near.sort((first, second) => first.distance - second.distance);
}

// ---------------------------------------------------------------- friends' keys (ticket 05 + 09)

/**
 * A friend's key list for a map, from their share (untrusted): only game ids, each once, at most
 * MAX_KEYS_PER_MAP; nothing when they don't share keys.
 * @param {{ share?: { keys?: unknown } | null }} friend
 * @param {string} mapKey
 * @returns {string[]}
 */
export function friendKeyList(friend, mapKey) {
  if (!isKeyListMapKey(mapKey)) return [];
  const keys = friend && friend.share ? ownValue(friend.share, "keys") : undefined;
  return cleanKeyIds(ownValue(keys, mapKey));
}

/**
 * The friends who have any of these keys on their list for this map.
 * @template {{ share?: { keys?: unknown } | null }} F
 * @param {F[]} friends
 * @param {string} mapKey
 * @param {string[]} keyIds alternatives: any one will do
 * @returns {F[]}
 */
export function friendsWithKey(friends, mapKey, keyIds) {
  return friends.filter((friend) => {
    const list = friendKeyList(friend, mapKey);
    return keyIds.some((keyId) => list.includes(keyId));
  });
}

/**
 * Every key any of these friends has on this map.
 * @param {{ share?: { keys?: unknown } | null }[]} friends
 * @param {string} mapKey
 * @returns {Set<string>}
 */
export function keysFriendsHave(friends, mapKey) {
  const keys = new Set();
  for (const friend of friends) {
    for (const keyId of friendKeyList(friend, mapKey)) keys.add(keyId);
  }
  return keys;
}

/**
 * "Mike has it", "Mike and Sam have it", "Mike, Sam and Cara have it" (names already cleaned).
 * @param {string[]} names
 */
export function friendsHaveItText(names) {
  if (!names.length) return "";
  if (names.length === 1) return `${names[0]} has it`;
  const allButLast = names.slice(0, -1).join(", ");
  return `${allButLast} and ${names[names.length - 1]} have it`;
}

/**
 * Your key lists as the squad share carries them (only when "Share my keys" is on; the server
 * drops them otherwise too).
 * @param {SavedState} saved
 * @returns {Record<string, string[]>}
 */
export function shareableKeyring(saved) {
  return cleanKeyring(saved.keyring);
}

// ---------------------------------------------------------------- the raid-start reminder

/**
 * The toast when a raid starts on a map you have keys for: "Bring your 5 keys for Customs".
 * Empty when the list is empty.
 * @param {number} keyCount
 * @param {string} mapName
 */
export function bringKeysReminder(keyCount, mapName) {
  if (keyCount < 1) return "";
  const keys = keyCount === 1 ? "key" : "keys";
  const yourKeys = keyCount === 1 ? "your key" : `your ${keyCount} ${keys}`;
  return `Bring ${yourKeys} for ${mapName}`;
}
