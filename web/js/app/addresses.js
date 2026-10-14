// @ts-check
// The page's addresses, as plain functions (no DOM): which page an address asks for, how to build
// one, and what the breadcrumbs say on each page.
//
//   #/                      the mode select page (the start page)
//   #/<mode>/maps           that mode's map picker
//   #/<mode>/map/<key>      a map, with that mode's task list
//   #/map/<key>             the v2.8 address of a map: redirects to the Settings mode's map
//
// <mode> is one of GAME_MODES: regular, pve or pvp-season.
import { GAME_MODES, GAME_MODE_NAMES } from "./game-modes.js";

/**
 * @typedef {{ page: "select" }
 *   | { page: "picker", mode: string }
 *   | { page: "map", mode: string, mapKey: string }
 *   | { page: "redirect", hash: string }} Address
 * `redirect` means: replace the address with `hash` (no history entry) and parse again.
 */

/** The mode select page's address. */
export const MODE_SELECT_ADDRESS = "#/";

/**
 * A mode's map picker address. Example: ("pve") → "#/pve/maps".
 * @param {string} mode
 */
export function pickerAddress(mode) {
  return `#/${mode}/maps`;
}

/**
 * A map's address in a mode. Example: ("pve", "customs") → "#/pve/map/customs".
 * @param {string} mode
 * @param {string} mapKey
 */
export function mapAddress(mode, mapKey) {
  return `#/${mode}/map/${mapKey}`;
}

/**
 * What an address asks for. Never throws: anything odd falls back to a page that exists.
 * Unknown mode → mode select; known mode with an unknown map → that mode's picker; the old
 * "#/map/<key>" → the same map in the Settings mode.
 * @param {string} hash location.hash
 * @param {string[]} mapKeys the maps this app has art for
 * @param {string} settingsMode the game mode in Settings
 * @returns {Address}
 */
export function parseAddress(hash, mapKeys, settingsMode) {
  if (hash === "" || hash === "#" || hash === "#/") return { page: "select" };

  const oldMap = hash.match(/^#\/map\/([\w-]+)\/?$/);
  if (oldMap) return { page: "redirect", hash: mapAddress(settingsMode, oldMap[1]) };

  const picker = hash.match(/^#\/([\w-]+)\/maps\/?$/);
  if (picker) {
    if (!GAME_MODES.includes(picker[1])) return { page: "redirect", hash: MODE_SELECT_ADDRESS };
    return { page: "picker", mode: picker[1] };
  }

  const map = hash.match(/^#\/([\w-]+)\/map\/([\w-]+)\/?$/);
  if (map) {
    const [, mode, mapKey] = map;
    if (!GAME_MODES.includes(mode)) return { page: "redirect", hash: MODE_SELECT_ADDRESS };
    if (!mapKeys.includes(mapKey)) return { page: "redirect", hash: pickerAddress(mode) };
    return { page: "map", mode, mapKey };
  }

  return { page: "redirect", hash: MODE_SELECT_ADDRESS };
}

/**
 * The map key in a map address, or null when the address isn't a map's.
 * @param {string} hash
 * @returns {string | null}
 */
export function mapKeyOfAddress(hash) {
  const map = hash.match(/^#\/[\w-]+\/map\/([\w-]+)\/?$/);
  return map ? map[1] : null;
}

/**
 * The same page in another mode: the picker stays the picker, a map stays that map. The mode
 * select page has no mode (null: nowhere to go).
 * @param {string} hash the current address
 * @param {string} newMode
 * @returns {string | null}
 */
export function samePageInMode(hash, newMode) {
  const match = hash.match(/^#\/[\w-]+\/(maps|map\/[\w-]+)\/?$/);
  return match ? `#/${newMode}/${match[1]}` : null;
}

/**
 * @typedef {object} Crumbs
 * @property {{ text: string, href: string | null }[]} parts the trail; every part but the last is a link
 * @property {{ text: string, href: string } | null} back the single "‹ previous step" link narrow screens show
 */

/**
 * The breadcrumbs for a page. Example: map page → "PvE / Maps / Customs"; the picker →
 * "PvE / Maps"; mode select → "Pick a game mode" (plain text).
 * @param {Address} address
 * @param {string} [mapName] the map's display name (map page)
 * @returns {Crumbs}
 */
export function crumbsFor(address, mapName = "") {
  if (address.page === "picker") {
    const modeName = GAME_MODE_NAMES[address.mode];
    return {
      parts: [{ text: modeName, href: MODE_SELECT_ADDRESS }, { text: "Maps", href: null }],
      back: { text: modeName, href: MODE_SELECT_ADDRESS },
    };
  }
  if (address.page === "map") {
    const modeName = GAME_MODE_NAMES[address.mode];
    return {
      parts: [
        { text: modeName, href: MODE_SELECT_ADDRESS },
        { text: "Maps", href: pickerAddress(address.mode) },
        { text: mapName, href: null },
      ],
      back: { text: "Maps", href: pickerAddress(address.mode) },
    };
  }
  return { parts: [{ text: "Pick a game mode", href: null }], back: null };
}
