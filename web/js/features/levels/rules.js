// @ts-check
// Levels (floors) of a map, as rules: which level a game position is on, which level the map
// shows for the picker's choice, and which groups of the map art that means. No DOM, no network.
// Everything comes from the map's entry in maps-config.json, so any map gets levels by config
// only (ticket 31): no map is named in here.

/** @import { MapConfig, MapFloorLayer, MapPrefs } from "../../app/types.js" */

// The picker's choice that lets your position decide the level (saved as prefs[map].level).
export const FOLLOW_MY_LEVEL = "follow";

// The base level (the map's baseLayer art) as a picker choice and as the level shown.
export const BASE_LEVEL = "base";

// The base level's name in the picker when the map doesn't give one (what the picker said
// before ticket 31).
export const DEFAULT_BASE_LEVEL_NAME = "Ground";

// The picker's text for FOLLOW_MY_LEVEL (owner's wording, ticket 31).
export const FOLLOW_MY_LEVEL_NAME = "All levels (follow me)";

/**
 * How a map's levels are drawn (maps-config.json "levelStyle"):
 * - "overlay" (every map before ticket 31): the base art always shows; a floor's art is drawn
 *   on top of it.
 * - "stacked" (The Lab): each level, the base included, is a complete picture of its own;
 *   the map shows exactly one.
 * @param {MapConfig} config
 * @returns {"overlay" | "stacked"}
 */
export function levelStyleOf(config) {
  if (config.levelStyle === "stacked") return "stacked";
  return "overlay";
}

/**
 * The base level's name in the picker: the map's "baseLevelName", else "Ground".
 * @param {MapConfig} config
 */
export function baseLevelNameOf(config) {
  return config.baseLevelName || DEFAULT_BASE_LEVEL_NAME;
}

/**
 * The level a game position is on: the first layer whose height range contains y (bottom
 * included, top not) and, when the range has area bounds, whose areas contain (x, z).
 * null means the base level, also when the height isn't known.
 * Example (The Lab): y -2 → Technical; y 4 inside the second level's area → Second Level;
 * y 4 outside it (the hangar) → null.
 * @param {MapConfig} config
 * @param {number} x
 * @param {number | null | undefined} y height
 * @param {number} z
 * @returns {MapFloorLayer | null}
 */
export function levelOfPosition(config, x, y, z) {
  if (y == null) return null;
  for (const layer of config.layers) {
    for (const extent of layer.extents) {
      const [bottom, top] = extent.height;
      if (y < bottom || y >= top) continue;
      if (extent.bounds && !extent.bounds.some((area) => isInsideArea(x, z, area))) continue;
      return layer;
    }
  }
  return null;
}

/** Whether (x, z) is inside a rectangle given by two corners. */
function isInsideArea(x, z, area) {
  const isInsideX = x >= Math.min(area[0][0], area[1][0]) && x <= Math.max(area[0][0], area[1][0]);
  const isInsideZ = z >= Math.min(area[0][1], area[1][1]) && z <= Math.max(area[0][1], area[1][1]);
  return isInsideX && isInsideZ;
}

/**
 * The levels that have a picture in the map art (a layer without svgLayer only gives a floor
 * badge). These are the ones the picker offers, after the base level.
 * @param {MapConfig} config
 * @returns {MapFloorLayer[]}
 */
export function levelsWithPictures(config) {
  return config.layers.filter((layer) => !!layer.svgLayer);
}

/**
 * The picker's options, in order: "All levels (follow me)", the base level by name, then each
 * level with a picture. Empty when the map has no level pictures (no picker then).
 * @param {MapConfig} config
 * @returns {{ value: string, name: string }[]}
 */
export function levelPickerOptions(config) {
  const levels = levelsWithPictures(config);
  if (!levels.length) return [];
  const options = [
    { value: FOLLOW_MY_LEVEL, name: FOLLOW_MY_LEVEL_NAME },
    { value: BASE_LEVEL, name: baseLevelNameOf(config) },
  ];
  for (const level of levels) {
    options.push({ value: level.svgLayer, name: level.name });
  }
  return options;
}

/**
 * The choice a map starts with: stacked maps follow you (each level is its own picture, so the
 * map should show where you are); overlay maps show their base level, as before ticket 31.
 * @param {MapConfig} config
 */
export function defaultLevelChoice(config) {
  if (levelStyleOf(config) === "stacked") return FOLLOW_MY_LEVEL;
  return BASE_LEVEL;
}

/**
 * The picker's choice for a map: the saved one (prefs[map].level) when it's still one of the
 * map's options, else the map's default.
 * @param {MapPrefs | undefined} prefs
 * @param {MapConfig} config
 */
export function savedLevelChoice(prefs, config) {
  const saved = prefs ? prefs.level : undefined;
  const isStillAnOption = levelPickerOptions(config).some((option) => option.value === saved);
  if (isStillAnOption) return saved;
  return defaultLevelChoice(config);
}

/**
 * The level the map shows ("base" or a layer's svgLayer id). A chosen level always wins: a new
 * position never changes it. With "follow", your last position on this map decides; a level
 * without a picture, or no position yet, shows the base level.
 * @param {string} choice the picker's choice
 * @param {{ x: number, y?: number | null, z: number } | null} lastPosition on this map
 * @param {MapConfig} config
 * @returns {string}
 */
export function levelToShow(choice, lastPosition, config) {
  if (choice !== FOLLOW_MY_LEVEL) {
    const levels = levelsWithPictures(config);
    const isLevelWithPicture = levels.some((level) => level.svgLayer === choice);
    return isLevelWithPicture ? choice : BASE_LEVEL;
  }
  if (!lastPosition) return BASE_LEVEL;
  const level = levelOfPosition(config, lastPosition.x, lastPosition.y, lastPosition.z);
  if (!level || !level.svgLayer) return BASE_LEVEL;
  return level.svgLayer;
}

/**
 * The map art's groups (ids) to show for a level. A group can belong to another one
 * (svgGroups' second value, the art's data-keep-with-group) and then shows with it.
 * - overlay: the base level's groups always, plus the level's own group.
 * - stacked: only that level's groups (the base level's groups only when it's the base).
 * @param {MapConfig} config
 * @param {string} levelShown "base" or a layer's svgLayer id
 * @returns {string[]}
 */
export function visibleGroups(config, levelShown) {
  const levelGroupId = levelShown === BASE_LEVEL ? config.baseLayer : levelShown;
  const isStacked = levelStyleOf(config) === "stacked";
  const shown = [];
  for (const [groupId, keepWithGroupId] of artGroupsOf(config)) {
    const ownerId = keepWithGroupId || groupId;
    const isBaseGroup = ownerId === config.baseLayer;
    const isLevelGroup = ownerId === levelGroupId;
    if (isLevelGroup || (isBaseGroup && !isStacked)) shown.push(groupId);
  }
  return shown;
}

/**
 * The map art's groups as [id, keep-with id or null]: svgGroups from maps-config.json, or, for
 * an entry without it, the base layer and each level's picture.
 * @param {MapConfig} config
 * @returns {(string | null)[][]}
 */
function artGroupsOf(config) {
  if (config.svgGroups) return config.svgGroups;
  const groups = [[config.baseLayer, null]];
  for (const level of levelsWithPictures(config)) {
    groups.push([level.svgLayer, null]);
  }
  return groups;
}

/**
 * The layer of the level shown, for place names (undefined = the base level).
 * @param {MapConfig} config
 * @param {string} levelShown
 * @returns {MapFloorLayer | undefined}
 */
export function layerOfLevelShown(config, levelShown) {
  if (levelShown === BASE_LEVEL) return undefined;
  return config.layers.find((layer) => layer.svgLayer === levelShown);
}

/**
 * A saved level choice as it loads: kept when it's text, dropped otherwise (a missing choice
 * means the map's default, see savedLevelChoice).
 * @param {unknown} value
 * @returns {string | undefined}
 */
export function cleanLevelChoice(value) {
  if (typeof value === "string" && value) return value;
  return undefined;
}
