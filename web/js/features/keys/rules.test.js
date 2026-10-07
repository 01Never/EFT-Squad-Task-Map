// Tests for the My keys rules (rules.js): saved key lists, keys that matter on a map, doors to
// draw, the placeholder key, loot behind a door, copying, friends' keys and the raid reminder.
// On the real Customs and Factory loot of the 2026-10-05 json.tarkov.dev files and real tasks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { gameData, findTask } from "../../../../tests/support/game-data.js";
import { freshState, migrateSavedData } from "../../app/saved-data.js";
import { resetAfterRaid } from "../raid/rules.js";
import {
  PLACEHOLDER_KEY_ID,
  UNKNOWN_KEY_NAME,
  LOOT_BEHIND_DOOR_RADIUS_METERS,
  MAX_KEYS_PER_MAP,
  cleanKeyring,
  keyListOf,
  keyListSetOf,
  setKeyList,
  addKeyToList,
  removeKeyFromList,
  putKeyBack,
  otherMapsWithKeys,
  copyKeyList,
  keysThatMatterOnMap,
  allKnownKeys,
  searchKeys,
  lockCountText,
  doorsToDraw,
  doorKeyName,
  locksOpenedBy,
  tasksUsingKey,
  lootNearDoor,
  isSameFloor,
  friendKeyList,
  friendsWithKey,
  keysFriendsHave,
  friendsHaveItText,
  bringKeysReminder,
} from "./rules.js";

/** The real loot of the 2026-10-05 json.tarkov.dev files, as the Go converter makes it. */
function realLoot() {
  const gzipped = readFileSync(new URL("../../../../testdata/golden/loot-real.json.gz", import.meta.url));
  return JSON.parse(gunzipSync(gzipped).toString("utf8"));
}
const allLoot = realLoot();

/** A map's /api/loot answer built from the real data (what loot.go AnswerForMap sends). */
function realMapLoot(mapKey) {
  return { map: mapKey, available: true, ...allLoot.maps[mapKey], lootTypes: allLoot.types, items: allLoot.itemNames };
}

const customs = realMapLoot("customs");
const factory = realMapLoot("factory");

// Real key ids (Customs).
const DORM_114 = "59387a4986f77401cc236e62";
const DORM_206 = "5938603e86f77435642354f4";
const DORM_314_MARKED = "5780cf7f2459777de4559322";
const USEC_STASH = "5da743f586f7744014504f72";
const MACHINERY = "5937ee6486f77408994ba448";
const GAS_STATION_OFFICE = "5780d0652459777df90dcb74";
const pharmacist = findTask("Pharmacist"); // needs the Dorm room 114 key on Customs

/** The lock a key opens on Customs (each of these opens exactly one). */
function customsLockOf(keyId) {
  const locks = customs.locks.filter((lock) => lock.key === keyId);
  assert.equal(locks.length, 1, `one lock for ${keyId}`);
  return locks[0];
}

// ---------------------------------------------------------------- the saved key lists

test("a saved file from before ticket 09 has no key lists, and loading it adds none", () => {
  const before = { version: 2, cats: [], tasks: {}, prefs: {} };
  const saved = migrateSavedData(before);
  assert.equal("keyring" in saved, false, "absent until you add a key, so the file saves back unchanged");
  assert.deepEqual(keyListOf(saved, "customs"), []);
  assert.equal("keyring" in freshState(), false);
});

test("saved key lists load as they are; a damaged one keeps only valid maps and key ids", () => {
  const damaged = JSON.parse(`{
    "customs": ["${DORM_114}", "${DORM_114}", "toString", "${DORM_206.toUpperCase()}", 7, "${DORM_206}"],
    "constructor": ["${DORM_114}"],
    "__proto__": ["${DORM_114}"],
    "Bad Map!": ["${DORM_114}"],
    "woods": [],
    "shoreline": "not a list"
  }`);
  const saved = migrateSavedData({ version: 2, cats: [], tasks: {}, prefs: {}, keyring: damaged });
  assert.deepEqual(saved.keyring, { customs: [DORM_114, DORM_206] });
  assert.equal(Object.getPrototypeOf(saved.keyring), Object.prototype, "__proto__ in the file changed nothing");
  assert.deepEqual(cleanKeyring(null), {});
  assert.deepEqual(cleanKeyring([DORM_114]), {});
});

test("a list can't grow past 200 keys", () => {
  const ids = Array.from({ length: MAX_KEYS_PER_MAP + 5 }, (_, index) => index.toString(16).padStart(24, "0"));
  assert.equal(cleanKeyring({ customs: ids }).customs.length, MAX_KEYS_PER_MAP);
});

test("adding keys creates the key list, in the order you add them, each once", () => {
  const saved = freshState();
  assert.equal(addKeyToList(saved, "customs", DORM_114), true);
  assert.equal(addKeyToList(saved, "customs", USEC_STASH), true);
  assert.equal(addKeyToList(saved, "customs", DORM_114), false, "already on the list");
  assert.equal(addKeyToList(saved, "customs", "not-a-key"), false);
  assert.deepEqual(saved.keyring, { customs: [DORM_114, USEC_STASH] });
  assert.deepEqual([...keyListSetOf(saved, "customs")], [DORM_114, USEC_STASH]);
  assert.deepEqual(keyListOf(saved, "woods"), [], "per map");
  assert.deepEqual([...keyListSetOf(saved, null)], []);
});

test("removing a key says where it was, and Undo puts it back there", () => {
  const saved = freshState();
  setKeyList(saved, "customs", [DORM_114, USEC_STASH, MACHINERY]);
  const position = removeKeyFromList(saved, "customs", USEC_STASH);
  assert.equal(position, 1);
  assert.deepEqual(keyListOf(saved, "customs"), [DORM_114, MACHINERY]);
  putKeyBack(saved, "customs", USEC_STASH, position);
  assert.deepEqual(keyListOf(saved, "customs"), [DORM_114, USEC_STASH, MACHINERY]);
  assert.equal(removeKeyFromList(saved, "customs", DORM_206), -1);
});

test("clearing a map's list removes its entry; other maps keep theirs", () => {
  const saved = freshState();
  setKeyList(saved, "customs", [DORM_114]);
  setKeyList(saved, "streets-of-tarkov", [USEC_STASH]);
  setKeyList(saved, "customs", []);
  assert.deepEqual(saved.keyring, { "streets-of-tarkov": [USEC_STASH] });
  assert.deepEqual(otherMapsWithKeys(saved, "customs"), [{ mapKey: "streets-of-tarkov", count: 1 }]);
  assert.deepEqual(otherMapsWithKeys(saved, "streets-of-tarkov"), []);
});

test("key lists are not reset at raid end (unlike bag counts)", () => {
  const saved = freshState();
  setKeyList(saved, "customs", [DORM_114, USEC_STASH]);
  saved.have = { [DORM_114]: 1 };
  resetAfterRaid(saved);
  assert.deepEqual(saved.have, {});
  assert.deepEqual(keyListOf(saved, "customs"), [DORM_114, USEC_STASH]);
});

// ---------------------------------------------------------------- keys that matter on a map

test("Customs' keys: every key with a lock there and every key a Customs task needs, with what each opens", () => {
  const keys = keysThatMatterOnMap(customs, gameData.tasks, "customs");
  const byId = new Map(keys.map((choice) => [choice.id, choice]));
  assert.equal(byId.get(USEC_STASH).lockTotal, 2);
  assert.equal(lockCountText(byId.get(USEC_STASH).lockCounts), "2 doors");
  assert.equal(lockCountText(byId.get(MACHINERY).lockCounts), "1 trunk");
  assert.ok(byId.get(DORM_114).taskNames.includes("Pharmacist"));
  assert.equal(byId.get(DORM_114).name, "Dorm room 114 key");
  const realLockKeys = new Set(customs.locks.map((lock) => lock.key).filter((key) => key !== PLACEHOLDER_KEY_ID));
  for (const keyId of realLockKeys) assert.ok(byId.get(keyId).lockTotal >= 1, keyId);
  const names = keys.map((choice) => choice.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), "sorted by name");
});

test("the placeholder key's locks off Factory never count as doors it opens", () => {
  const customsKeys = keysThatMatterOnMap(customs, [], "customs");
  assert.equal(customsKeys.some((choice) => choice.id === PLACEHOLDER_KEY_ID), false, "not in Customs' picker");
  assert.deepEqual(locksOpenedBy(customs, PLACEHOLDER_KEY_ID, "customs"), []);
  const factoryKey = keysThatMatterOnMap(factory, [], "factory").find((choice) => choice.id === PLACEHOLDER_KEY_ID);
  assert.ok(factoryKey && factoryKey.lockTotal >= 1, "on Factory it is the real key");
  assert.equal(factoryKey.name, "Factory emergency exit key");
});

test("the placeholder's doors show only under All locked doors, as an unknown key", () => {
  const myKeys = new Set([PLACEHOLDER_KEY_ID, DORM_114]);
  const mine = doorsToDraw(customs, "customs", myKeys, false);
  assert.deepEqual(mine.map((door) => door.lock.key), [DORM_114]);
  const all = doorsToDraw(customs, "customs", myKeys, true);
  const unknown = all.filter((door) => door.status === "unknown");
  assert.equal(unknown.length, 3);
  assert.equal(doorKeyName(customs, unknown[0].lock, "customs"), UNKNOWN_KEY_NAME);
  const onFactory = doorsToDraw(factory, "factory", new Set([PLACEHOLDER_KEY_ID]), false);
  assert.ok(onFactory.length >= 1 && onFactory.every((door) => door.status === "mine"));
});

test("All locked doors adds every other door, dimmed (status other); without it only yours", () => {
  const myKeys = new Set([DORM_114, USEC_STASH, MACHINERY]);
  const mine = doorsToDraw(customs, "customs", myKeys, false);
  assert.equal(mine.length, 4, "1 + 2 doors + 1 trunk");
  assert.ok(mine.every((door) => door.status === "mine"));
  const all = doorsToDraw(customs, "customs", myKeys, true);
  assert.equal(all.length, customs.locks.length);
  assert.equal(all.filter((door) => door.status === "other").length, customs.locks.length - 4 - 3);
  assert.equal(all[0].index, 0, "each door keeps its lock's index");
});

test("a door a friend's key opens is drawn even without All locked doors", () => {
  const doors = doorsToDraw(customs, "customs", new Set([DORM_114]), false, new Set([USEC_STASH]));
  assert.deepEqual(doors.map((door) => [door.lock.key, door.status]), [
    [DORM_114, "mine"],
    [USEC_STASH, "other"],
    [USEC_STASH, "other"],
  ]);
});

test("searching finds keys by every word of their name; an empty search finds nothing", () => {
  const keys = keysThatMatterOnMap(customs, gameData.tasks, "customs");
  assert.deepEqual(searchKeys(keys, "314 dorm").map((choice) => choice.name), ["Dorm room 314 marked key"]);
  assert.ok(searchKeys(keys, "DORM").length > 10);
  assert.deepEqual(searchKeys(keys, "   "), []);
});

test("all keys also finds keys that open nothing on this map, flagged by a lock count of 0", () => {
  const keysHere = keysThatMatterOnMap(customs, gameData.tasks, "customs");
  const everyKey = allKnownKeys(keysHere, gameData.tasks, [customs, realMapLoot("streets-of-tarkov")]);
  const streetsOnly = everyKey.find((choice) => choice.name === searchKeys(everyKey, "Concordia")[0]?.name);
  assert.ok(streetsOnly, "a Streets key is found");
  assert.equal(streetsOnly.lockTotal, 0);
  assert.equal(lockCountText(streetsOnly.lockCounts), "doesn't open anything here");
  assert.equal(everyKey.find((choice) => choice.id === USEC_STASH).lockTotal, 2, "Customs keys keep their counts");
});

test("lock counts read as a short list", () => {
  assert.equal(lockCountText({ door: 3, trunk: 1 }), "3 doors, 1 trunk");
  assert.equal(lockCountText({ trunk: 2, door: 1 }), "1 door, 2 trunks");
  assert.equal(lockCountText({ safe: 1 }), "1 lock");
  assert.equal(lockCountText({}), "doesn't open anything here");
});

test("the tasks that use a key: those on this map that need it, yours first", () => {
  const isActive = (task) => task.id === pharmacist.id;
  const tasks = tasksUsingKey(gameData.tasks, DORM_114, "customs", isActive);
  assert.equal(tasks[0].task.name, "Pharmacist");
  assert.equal(tasks[0].isActive, true);
  assert.deepEqual(tasksUsingKey(gameData.tasks, DORM_114, "woods", isActive), []);
});

// ---------------------------------------------------------------- copying a list

test("copying another map's list keeps only the keys that matter here, after the ones already there", () => {
  const mattersHere = new Set([DORM_114, USEC_STASH]);
  const copied = copyKeyList([USEC_STASH], [DORM_114, GAS_STATION_OFFICE, USEC_STASH], mattersHere);
  assert.deepEqual(copied.list, [USEC_STASH, DORM_114]);
  assert.deepEqual(copied.added, [DORM_114]);
  assert.equal(copied.leftOut.length, 1);
});

// ---------------------------------------------------------------- loot behind a door

test("the radius is 8 m on the ground, and the same floor is within 1.5 m of the door's height", () => {
  assert.equal(LOOT_BEHIND_DOOR_RADIUS_METERS, 8);
  assert.equal(isSameFloor({ x: 0, y: 6.85, z: 0 }, { x: 0, y: 6.14, z: 0 }), true);
  assert.equal(isSameFloor({ x: 0, y: 0.9, z: 0 }, { x: 0, y: 2.87, z: 0 }), false, "the floor above");
});

test("loot behind Dorm room 114 (ground floor): its PC, 2 safes, the medcase and 2 loose spots", () => {
  const near = lootNearDoor(customs, customsLockOf(DORM_114));
  const containers = near.filter((spot) => spot.chip !== "loose").map((spot) => spot.chip).sort();
  assert.deepEqual(containers, ["medcase", "pc-block", "safe", "safe"]);
  assert.equal(near.filter((spot) => spot.chip === "loose").length, 2);
  assert.ok(near.every((spot) => spot.distance <= 8), "within 8 m");
  assert.deepEqual(near.map((spot) => spot.distance), [...near.map((spot) => spot.distance)].sort((a, b) => a - b), "nearest first");
});

test("loot behind the marked room (Dorm 314): its shelves' loose loot, not the 2nd floor below", () => {
  const near = lootNearDoor(customs, customsLockOf(DORM_314_MARKED));
  assert.equal(near.filter((spot) => spot.chip === "loose").length, 4);
  assert.deepEqual(near.filter((spot) => spot.chip !== "loose").map((spot) => spot.chip), ["pmc-body"]);
  assert.equal(near.some((spot) => spot.chip === "safe"), false, "the 2nd floor's safe, 3.5 m below, is left out");
});

// ---------------------------------------------------------------- friends' keys

test("a friend's key list is read safely: only game ids, own map keys, nothing when not shared", () => {
  const mike = { share: { keys: JSON.parse(`{"customs": ["${DORM_114}", "<script>", 3, "${DORM_114}"], "__proto__": ["${USEC_STASH}"]}`) } };
  assert.deepEqual(friendKeyList(mike, "customs"), [DORM_114]);
  assert.deepEqual(friendKeyList(mike, "toString"), []);
  assert.deepEqual(friendKeyList(mike, "__proto__"), []);
  assert.deepEqual(friendKeyList({ share: { keys: null } }, "customs"), []);
  assert.deepEqual(friendKeyList({ share: { keys: { customs: "nope" } } }, "customs"), []);
  assert.deepEqual(friendKeyList({ share: null }, "customs"), []);
  assert.deepEqual(friendKeyList({}, "customs"), []);
});

test("who has a key: Mike has it, Mike and Sam have it", () => {
  const mike = { name: "Mike", share: { keys: { customs: [DORM_114] } } };
  const sam = { name: "Sam", share: { keys: { customs: [USEC_STASH, DORM_114] } } };
  const cara = { name: "Cara", share: { keys: null } };
  assert.deepEqual(friendsWithKey([mike, sam, cara], "customs", [USEC_STASH]), [sam]);
  assert.deepEqual(friendsWithKey([mike, sam, cara], "customs", ["0".repeat(24), DORM_114]), [mike, sam], "any of the alternatives");
  assert.deepEqual(friendsWithKey([mike, sam], "woods", [DORM_114]), [], "only that map's list");
  assert.deepEqual([...keysFriendsHave([mike, sam, cara], "customs")].sort(), [DORM_114, USEC_STASH].sort());
  assert.equal(friendsHaveItText(["Sam"]), "Sam has it");
  assert.equal(friendsHaveItText(["Mike", "Sam"]), "Mike and Sam have it");
  assert.equal(friendsHaveItText(["Mike", "Sam", "Cara"]), "Mike, Sam and Cara have it");
  assert.equal(friendsHaveItText([]), "");
});

// ---------------------------------------------------------------- the raid-start reminder

test("the raid-start reminder counts your keys for that map", () => {
  assert.equal(bringKeysReminder(5, "Customs"), "Bring your 5 keys for Customs");
  assert.equal(bringKeysReminder(1, "Customs"), "Bring your key for Customs");
  assert.equal(bringKeysReminder(0, "Customs"), "");
});
