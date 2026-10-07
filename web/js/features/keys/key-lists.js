// @ts-check
// Your key lists and your friends' as the rest of the page reads them (ticket 09): the open map's
// list (readiness counts those keys as had there), the keys that matter on the open map, and which
// friends have a key. Reads app.saved, app.gameData, app.squad and the loaded loot; changes
// nothing. The decisions are in rules.js.
import { app } from "../../app/state.js";
import { lootOfMap } from "../loot/loot-data.js";
import { allFriends } from "../squad/friends.js";
import { friendDisplayName } from "../squad/rules.js";
import { keyListSetOf, keysThatMatterOnMap, friendsWithKey, keysFriendsHave, friendsHaveItText } from "./rules.js";

/** @import { KeyChoice } from "./rules.js" */
/** @import { SquadFriend } from "../../app/types.js" */

/**
 * The open map's key list (empty with no map open). Readiness and the Bring list count these keys
 * as had on this map only.
 * @returns {Set<string>}
 */
export function openMapKeyList() {
  return keyListSetOf(app.saved, app.mapView ? app.mapView.key : null);
}

/**
 * The keys that matter on the open map (locks here, tasks here), once its loot is loaded; until
 * then the task keys alone. `onLoaded` runs when the loot arrives.
 * @param {() => void} onLoaded
 * @returns {KeyChoice[]}
 */
export function keysThatMatterOnOpenMap(onLoaded) {
  const mapKey = app.mapView.key;
  const loot = lootOfMap(mapKey, onLoaded);
  const isLootUsable = !!loot && loot.available;
  return keysThatMatterOnMap(isLootUsable ? loot : null, app.gameData.tasks, mapKey);
}

/**
 * The friends whose shares carry key lists (they switched "Share my keys" on).
 * @returns {SquadFriend[]}
 */
export function friendsSharingKeys() {
  return allFriends().filter((friend) => !!friend.share && !!friend.share.keys);
}

/**
 * Every key a friend has on the open map.
 * @returns {Set<string>}
 */
export function keysFriendsHaveOnOpenMap() {
  if (!app.mapView) return new Set();
  return keysFriendsHave(friendsSharingKeys(), app.mapView.key);
}

/**
 * The friends who have one of these keys on the open map's list.
 * @param {string[]} keyIds alternatives
 * @returns {SquadFriend[]}
 */
export function friendsWithKeyOnOpenMap(keyIds) {
  if (!app.mapView) return [];
  return friendsWithKey(friendsSharingKeys(), app.mapView.key, keyIds);
}

/**
 * "Sam has it" for a task's key requirement, or "" (plain text: escape it where it goes into HTML).
 * @param {string[]} keyIds alternatives
 */
export function friendsHaveKeyText(keyIds) {
  const names = friendsWithKeyOnOpenMap(keyIds).map((friend) => friendDisplayName(friend.name));
  return friendsHaveItText(names);
}
