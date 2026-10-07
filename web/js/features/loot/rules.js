// @ts-check
// Loot spots (ticket 08): which chips a map gets, the "High value" preset, which spots the chips
// show, and grouping nearby spots into one bubble so the map never draws thousands of markers.
// Plain functions: no DOM, no network. Drawing is map-layer.js; the chips are panel.js.

/**
 * @typedef {object} LootContainerSpot A container from /api/loot/<map>.
 * @property {string} t type: the container's normalizedName ("safe")
 * @property {number} x game position (y = height)
 * @property {number} y
 * @property {number} z
 */

/**
 * @typedef {object} LooseLootSpot A loose-loot spot from /api/loot/<map>.
 * @property {string[]} i the item ids that can spawn here
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * @typedef {object} MapLoot /api/loot/<map> (internal/gamedata/loot.go MapLootAnswer).
 * @property {string} map
 * @property {boolean} available false while the game data has no loot (the built-in snapshot)
 * @property {LootContainerSpot[]} containers
 * @property {LooseLootSpot[]} loose
 * @property {import("../keys/rules.js").Lock[]} locks locked doors and trunks; shown by ticket 09 (features/keys), not here
 * @property {Record<string, string>} lootTypes container type → display name
 * @property {Record<string, string>} items item id → name
 */

/**
 * @typedef {object} LootChip One chip in the Loot section.
 * @property {string} id a container type, or LOOSE_CHIP
 * @property {string} label
 * @property {number} count spots on this map
 */

/**
 * @typedef {object} LootSpot A spot a chip shows, ready to draw (svg position and floor added by
 * map-layer.js).
 * @property {string} chip the chip that shows it
 * @property {number} x game position
 * @property {number} y
 * @property {number} z
 * @property {string[]} [items] loose loot: the item ids that can spawn here
 */

/**
 * @typedef {object} PlacedSpot A spot at its map (SVG) position.
 * @property {number} svgX
 * @property {number} svgY
 */

// The chip id for loose loot. Container chips use the container type ("safe"), which is never
// "loose". (json.tarkov.dev's loose loot is already a curated list of notable items: keys,
// valuables, intel, electronics, stims. Splitting it into groups needs item categories, which the
// files the app downloads don't have; see the README.)
export const LOOSE_CHIP = "loose";
export const LOOSE_CHIP_LABEL = "Loose loot";

// Owner's default for "High value" (ticket 08 open question): safes, weapon boxes, PC blocks,
// tech supply crates, medcases, jackets and filing cabinets ("drawer" in tarkov.dev's data),
// plus loose documents, valuables, electronics and keys (all in the one loose-loot chip).
// Listed in the order the chips are shown.
export const HIGH_VALUE_CHIPS = [
  "safe",
  "bank-safe",
  "weapon-box",
  "pc-block",
  "technical-supply-crate",
  "medcase",
  "jacket",
  "drawer",
  LOOSE_CHIP,
];

// A short sign drawn on each marker, so types tell apart without reading: "$" a safe, "PC" a PC
// block. Types not listed use their first letter.
const LOOT_TYPE_GLYPHS = {
  safe: "$",
  "bank-safe": "$",
  "cash-register": "₽",
  "bank-cash-register": "₽",
  "weapon-box": "W",
  "pc-block": "PC",
  "technical-supply-crate": "T",
  medcase: "+",
  medbag: "+",
  "medical-supply-crate": "+",
  jacket: "J",
  drawer: "D",
  toolbox: "Tb",
  "dead-scav": "✝",
  "pmc-body": "✝",
  "scav-body": "✝",
  "civilian-body": "✝",
  "lab-technician-body": "✝",
  [LOOSE_CHIP]: "L",
};

// ---------------------------------------------------------------- saved choices

/**
 * Which chips are on for a map (prefs[map].loot). Absent (every file from before ticket 08, and
 * every map you never changed) means none: loot is off until you turn it on.
 * @param {{ loot?: unknown } | undefined} mapPrefs
 * @returns {Record<string, true>}
 */
export function lootChoicesOf(mapPrefs) {
  return cleanLootChoices(mapPrefs && mapPrefs.loot);
}

/**
 * Saved loot choices with anything that isn't "chip id → true" dropped (a hand-edited or damaged
 * file). Returns a new object.
 * @param {unknown} saved
 * @returns {Record<string, true>}
 */
export function cleanLootChoices(saved) {
  /** @type {Record<string, true>} */
  const choices = {};
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return choices;
  for (const [chipId, isOn] of Object.entries(saved)) {
    if (isOn === true) choices[chipId] = true;
  }
  return choices;
}

/**
 * The choices with one chip switched.
 * @param {Record<string, true>} choices
 * @param {string} chipId
 * @returns {Record<string, true>}
 */
export function toggleLootChip(choices, chipId) {
  const next = { ...choices };
  if (next[chipId]) delete next[chipId];
  else next[chipId] = true;
  return next;
}

// ---------------------------------------------------------------- chips

/**
 * The map's chips with their counts: the high-value types first (in HIGH_VALUE_CHIPS order),
 * then the other container types by name, then loose loot. Only types this map has.
 * @param {MapLoot} loot
 * @returns {LootChip[]}
 */
export function lootChipsForMap(loot) {
  /** @type {Record<string, number>} */
  const countByType = {};
  for (const container of loot.containers) {
    countByType[container.t] = (countByType[container.t] || 0) + 1;
  }
  const highValueTypes = HIGH_VALUE_CHIPS.filter((type) => countByType[type]);
  const otherTypes = Object.keys(countByType)
    .filter((type) => !HIGH_VALUE_CHIPS.includes(type))
    .sort((a, b) => lootTypeName(loot, a).localeCompare(lootTypeName(loot, b)));
  const chips = [...highValueTypes, ...otherTypes].map((type) => ({
    id: type,
    label: lootTypeName(loot, type),
    count: countByType[type],
  }));
  if (loot.loose.length) chips.push({ id: LOOSE_CHIP, label: LOOSE_CHIP_LABEL, count: loot.loose.length });
  return chips;
}

/**
 * A container type's display name ("PC block"); the type itself when the data has no name.
 * @param {MapLoot} loot
 * @param {string} type
 */
export function lootTypeName(loot, type) {
  if (type === LOOSE_CHIP) return LOOSE_CHIP_LABEL;
  return (loot.lootTypes && loot.lootTypes[type]) || type;
}

/**
 * The sign on a marker of this chip.
 * @param {string} chipId
 */
export function lootGlyph(chipId) {
  return LOOT_TYPE_GLYPHS[chipId] || chipId.charAt(0).toUpperCase();
}

/**
 * The "High value" choices for a map: exactly the preset's chips this map has.
 * @param {LootChip[]} chips
 * @returns {Record<string, true>}
 */
export function highValueChoices(chips) {
  /** @type {Record<string, true>} */
  const choices = {};
  for (const chip of chips) {
    if (HIGH_VALUE_CHIPS.includes(chip.id)) choices[chip.id] = true;
  }
  return choices;
}

/**
 * Whether the choices are exactly "High value" for this map (the preset button shows pressed).
 * @param {Record<string, true>} choices
 * @param {LootChip[]} chips
 */
export function isHighValueOn(choices, chips) {
  const preset = Object.keys(highValueChoices(chips)).sort();
  const shown = chips.filter((chip) => choices[chip.id]).map((chip) => chip.id).sort();
  return preset.length > 0 && preset.join() === shown.join();
}

// ---------------------------------------------------------------- spots

/**
 * Every spot the chips show.
 * @param {MapLoot} loot
 * @param {Record<string, true>} choices
 * @returns {LootSpot[]}
 */
export function lootSpotsShown(loot, choices) {
  /** @type {LootSpot[]} */
  const spots = [];
  for (const container of loot.containers) {
    if (choices[container.t]) spots.push({ chip: container.t, x: container.x, y: container.y, z: container.z });
  }
  if (choices[LOOSE_CHIP]) {
    for (const spot of loot.loose) spots.push({ chip: LOOSE_CHIP, x: spot.x, y: spot.y, z: spot.z, items: spot.i });
  }
  return spots;
}

/**
 * What a spot is called in its popup: the container's name, or the loose item(s).
 * @param {MapLoot} loot
 * @param {LootSpot} spot
 */
export function lootSpotName(loot, spot) {
  if (spot.chip !== LOOSE_CHIP) return lootTypeName(loot, spot.chip);
  if (spot.items && spot.items.length === 1) return itemName(loot, spot.items[0]);
  return LOOSE_CHIP_LABEL;
}

/**
 * An item's name; its id when the data doesn't name it.
 * @param {MapLoot} loot
 * @param {string} itemId
 */
export function itemName(loot, itemId) {
  return (loot.items && loot.items[itemId]) || itemId;
}

/**
 * "3 × Safe, 2 × Jacket": what a bubble of spots holds, the most common first.
 * @param {MapLoot} loot
 * @param {LootSpot[]} spots
 * @returns {{ name: string, count: number }[]}
 */
export function summarizeSpots(loot, spots) {
  /** @type {Map<string, number>} */
  const countByName = new Map();
  for (const spot of spots) {
    const name = lootSpotName(loot, spot);
    countByName.set(name, (countByName.get(name) || 0) + 1);
  }
  const lines = [...countByName].map(([name, count]) => ({ name, count }));
  lines.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return lines;
}

// ---------------------------------------------------------------- what gets drawn

// Performance (ticket 08): only spots in or near the view are drawn, so panning a little never
// needs a redraw. The margin is this fraction of the view's width (and height) on each side.
export const VIEW_MARGIN_FRACTION = 0.25;

/**
 * The spots inside the view, widened by VIEW_MARGIN_FRACTION on every side.
 * @template {PlacedSpot} T
 * @param {T[]} spots
 * @param {{ x: number, y: number, w: number, h: number }} viewBox SVG units
 * @returns {T[]}
 */
export function spotsNearView(spots, viewBox) {
  const marginX = viewBox.w * VIEW_MARGIN_FRACTION;
  const marginY = viewBox.h * VIEW_MARGIN_FRACTION;
  const left = viewBox.x - marginX;
  const right = viewBox.x + viewBox.w + marginX;
  const top = viewBox.y - marginY;
  const bottom = viewBox.y + viewBox.h + marginY;
  return spots.filter((spot) => spot.svgX >= left && spot.svgX <= right && spot.svgY >= top && spot.svgY <= bottom);
}

/**
 * @template T
 * @typedef {object} SpotGroup Spots close together on screen, drawn as one marker.
 * @property {number} svgX where it's drawn: the middle of its spots
 * @property {number} svgY
 * @property {T[]} spots one spot = a normal marker; more = a bubble with the count
 */

/**
 * Groups spots that fall in the same square of a grid laid over the map. The squares are
 * `cellSize` SVG units wide (map-layer.js makes that a fixed number of screen pixels), and the
 * grid is fixed to the map, so panning doesn't regroup anything; zooming in splits groups.
 * @template {PlacedSpot} T
 * @param {T[]} spots
 * @param {number} cellSize SVG units
 * @returns {SpotGroup<T>[]}
 */
export function groupNearbySpots(spots, cellSize) {
  /** @type {Map<string, T[]>} */
  const spotsByCell = new Map();
  for (const spot of spots) {
    const cell = Math.floor(spot.svgX / cellSize) + ":" + Math.floor(spot.svgY / cellSize);
    const cellSpots = spotsByCell.get(cell);
    if (cellSpots) cellSpots.push(spot);
    else spotsByCell.set(cell, [spot]);
  }
  /** @type {SpotGroup<T>[]} */
  const groups = [];
  for (const cellSpots of spotsByCell.values()) {
    let sumX = 0;
    let sumY = 0;
    for (const spot of cellSpots) {
      sumX += spot.svgX;
      sumY += spot.svgY;
    }
    groups.push({ svgX: sumX / cellSpots.length, svgY: sumY / cellSpots.length, spots: cellSpots });
  }
  return groups;
}
