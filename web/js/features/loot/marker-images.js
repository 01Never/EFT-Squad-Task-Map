// @ts-check
// The pictures loot markers are made of: a tile with a type's sign, a bubble with a count, and a
// floor badge, each a small SVG picture (a data: URL) made once and reused by every marker.
//
// Why pictures and not SVG text (ticket 08, measured): the map re-lays out every marker on each
// pan/zoom frame, and SVG text is the expensive part of that. With ~250 loot markers as text,
// zooming Streets spent 5-11 ms per frame on layout; drawn as pictures it's back to the 1.5-2.7 ms
// of the map without loot. A picture is drawn once at its size and then only copied.

// Colours of the tile (tarkov.dev's palette, as in web/css/base.css): neutral, so task markers in
// their category colours stay what you see first.
const TILE_FILL = "#1b1919"; // --black-light
const TILE_EDGE = "#9a8866"; // --gold-two
const SIGN_COLOR = "#c7c5b3"; // --gold-one

// Pictures can't use the page's web font, so the signs use a plain bold sans-serif.
const PICTURE_FONT = "Arial, Helvetica, sans-serif";

/** Sizes in screen pixels (markers keep their screen size at any zoom). */
export const TILE_SIZE = 14;
export const FLOOR_BADGE_SIZE = 11;

/** @type {Map<string, string>} picture by what it shows; a handful of distinct ones per map */
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

/** Text safe inside the picture's SVG. */
function escapeXml(text) {
  return String(text).replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
}

/**
 * A tile with a sign in the middle ("$", "PC"); an empty sign gives a plain tile (under an item
 * icon).
 * @param {string} sign
 * @returns {string} data: URL
 */
export function tilePicture(sign) {
  return cachedPicture("tile:" + sign, () => {
    const fontSize = sign.length > 1 ? 7.5 : 10;
    const text = sign
      ? `<text x="7" y="${sign.length > 1 ? 9.6 : 10.5}" text-anchor="middle" font-family="${PICTURE_FONT}" font-weight="700" font-size="${fontSize}" fill="${SIGN_COLOR}">${escapeXml(sign)}</text>`
      : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}" viewBox="0 0 14 14"><rect x=".7" y=".7" width="12.6" height="12.6" rx="2.5" fill="${TILE_FILL}" stroke="${TILE_EDGE}" stroke-width="1.3"/>${text}</svg>`;
  });
}

/**
 * The size of a bubble for this many spots: a little bigger for 2- and 3-digit counts.
 * @param {number} count
 */
export function bubbleSize(count) {
  if (count < 10) return 17;
  if (count < 100) return 20;
  return 23;
}

/**
 * A round bubble with a count.
 * @param {number} count
 * @returns {string} data: URL
 */
export function bubblePicture(count) {
  return cachedPicture("bubble:" + count, () => {
    const size = bubbleSize(count);
    const middle = size / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${middle}" cy="${middle}" r="${middle - 0.8}" fill="${TILE_FILL}" stroke="${TILE_EDGE}" stroke-width="1.5"/><text x="${middle}" y="${middle + 3.5}" text-anchor="middle" font-family="${PICTURE_FONT}" font-weight="700" font-size="10" fill="${SIGN_COLOR}">${count}</text></svg>`;
  });
}

/**
 * The floor ("2", "B"…) in a small black circle, as on task markers.
 * @param {string} floor
 * @returns {string} data: URL
 */
export function floorBadgePicture(floor) {
  return cachedPicture("floor:" + floor, () => {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${FLOOR_BADGE_SIZE}" height="${FLOOR_BADGE_SIZE}" viewBox="0 0 11 11"><circle cx="5.5" cy="5.5" r="4.9" fill="#000" stroke="#fff" stroke-width="1"/><text x="5.5" y="8.1" text-anchor="middle" font-family="${PICTURE_FONT}" font-weight="700" font-size="7.5" fill="#fff">${escapeXml(floor)}</text></svg>`;
  });
}
