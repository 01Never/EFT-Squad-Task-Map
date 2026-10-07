// @ts-check
// Item icons: which objectives get the item's icon on their map marker, and where the picture is
// loaded from. Plain functions only: no DOM, no network. The drawing is map/markers.js; the
// server side (download once, serve from disk) is internal/features/icons.

/** @import { Objective, Item, SavedState } from "../../app/types.js" */

/**
 * @typedef {object} MarkerIconItem The item whose icon a marker shows.
 * @property {string} id
 * @property {string} name
 * @property {boolean} hasAlternatives more items would do (drawn with a small "+")
 */

const ITEM_ID = /^[0-9a-f]{24}$/;

/**
 * Item ids are 24 lower-case hex digits; the server serves nothing else.
 * @param {unknown} text
 * @returns {boolean}
 */
export function isItemId(text) {
  return typeof text === "string" && ITEM_ID.test(text);
}

/**
 * Where an item's picture comes from: this app, which downloads it once and keeps it.
 * @param {string} itemId
 * @returns {string}
 */
export function itemIconUrl(itemId) {
  return `/icons/${itemId}.webp`;
}

/**
 * The item to show on an objective's marker, or null to keep the category shape:
 * - "mark": the marker item (MS2000 unless the data names another);
 * - "plantItem": the first item, with "+" when there are alternatives;
 * - "plantQuestItem": the quest item (when the data has its id).
 * Everything else (visits, kills, hand-ins, gear…) keeps its shape.
 * @param {Objective} objective
 * @returns {MarkerIconItem | null}
 */
export function markerIconItem(objective) {
  if (objective.type === "mark" && objective.marker && isItemId(objective.marker.id)) {
    return { id: objective.marker.id, name: objective.marker.name, hasAlternatives: false };
  }
  if (objective.type === "plantItem") {
    const first = (objective.items || []).find((item) => isItemId(item.id));
    if (first) return { id: first.id, name: first.name, hasAlternatives: objective.items.length > 1 };
  }
  if (objective.type === "plantQuestItem" && isItemId(objective.qiId)) {
    return { id: /** @type {string} */ (objective.qiId), name: objective.qi || "Quest item", hasAlternatives: false };
  }
  return null;
}

/**
 * Whether markers show item icons (Settings → Task markers). On unless you chose shapes, also in
 * files saved before the setting existed.
 * @param {Pick<SavedState, "taskIcons">} saved
 * @returns {boolean}
 */
export function showsItemIcons(saved) {
  return saved.taskIcons !== false;
}
