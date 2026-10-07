// @ts-check
// The pictures door markers are made of (ticket 09): a tile in the "your keys" colour (with a key
// sign, or plain under the key's icon), a "?" tile for a door whose key the data doesn't know, and
// the ⚡ badge for doors that need power. Each is a small SVG picture (a data: URL) made once and
// reused, like ticket 08's loot markers: pictures cost far less than SVG text on every pan/zoom
// frame (measured in ticket 08).

// "Your keys" colour: no task category, extract kind, the player or the selection ring uses it.
// The same value is --keys in web/css/base.css.
export const KEYS_COLOR = "#748ffc";
const TILE_FILL = "#1b1919"; // --black-light
const SIGN_COLOR = "#e7ebff";
const UNKNOWN_EDGE = "#8f8d80"; // --muted: a door whose key the data doesn't know
const POWER_FILL = "#ffd43b";

// Pictures can't use the page's web font, so the signs use a plain bold sans-serif.
const PICTURE_FONT = "Arial, Helvetica, sans-serif";

/** Sizes in screen pixels (markers keep their screen size at any zoom). */
export const DOOR_TILE_SIZE = 18;
export const POWER_BADGE_SIZE = 10;

/** @type {Map<string, string>} */
const pictureCache = new Map();

/**
 * A picture once per key.
 * @param {string} key
 * @param {() => string} makeSvg
 */
function cachedPicture(key, makeSvg) {
  let url = pictureCache.get(key);
  if (!url) {
    url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(makeSvg());
    pictureCache.set(key, url);
  }
  return url;
}

/**
 * A door tile: the "your keys" frame, with a small key drawn in it (`withKeySign`) or plain (the
 * key's icon goes on top).
 * @param {boolean} withKeySign
 * @returns {string} data: URL
 */
export function doorTilePicture(withKeySign) {
  return cachedPicture("door:" + withKeySign, () => {
    const keySign = withKeySign
      ? `<circle cx="6.5" cy="9" r="2.6" fill="none" stroke="${SIGN_COLOR}" stroke-width="1.6"/><path d="M9 9h5.5M12.5 9v2.6M14.5 9v2" stroke="${SIGN_COLOR}" stroke-width="1.6" fill="none"/>`
      : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${DOOR_TILE_SIZE}" height="${DOOR_TILE_SIZE}" viewBox="0 0 18 18"><rect x="1" y="1" width="16" height="16" rx="3" fill="${TILE_FILL}" stroke="${KEYS_COLOR}" stroke-width="2"/>${keySign}</svg>`;
  });
}

/**
 * A door whose key the data doesn't know: a grey tile with "?".
 * @returns {string} data: URL
 */
export function unknownDoorPicture() {
  return cachedPicture("unknown", () => {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${DOOR_TILE_SIZE}" height="${DOOR_TILE_SIZE}" viewBox="0 0 18 18"><rect x="1" y="1" width="16" height="16" rx="3" fill="${TILE_FILL}" stroke="${UNKNOWN_EDGE}" stroke-width="2"/><text x="9" y="13.2" text-anchor="middle" font-family="${PICTURE_FONT}" font-weight="700" font-size="11.5" fill="${UNKNOWN_EDGE}">?</text></svg>`;
  });
}

/**
 * The ⚡ badge: the door needs the power switched on.
 * @returns {string} data: URL
 */
export function powerBadgePicture() {
  return cachedPicture("power", () => {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${POWER_BADGE_SIZE}" height="${POWER_BADGE_SIZE}" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4.6" fill="#000" stroke="${POWER_FILL}" stroke-width="0.8"/><path d="M5.6 1.6 2.9 5.5h2l-.5 2.9 2.7-3.9h-2z" fill="${POWER_FILL}"/></svg>`;
  });
}
