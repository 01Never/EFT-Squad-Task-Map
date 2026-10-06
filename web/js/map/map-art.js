// @ts-check
// The map art (big SVG files from assets/, by tarkov-dev-svg-maps), loaded once per file and kept
// in memory for the picker's thumbnails and the map page.

/** @type {Record<string, string>} */
const mapArtByFile = {};

/**
 * The SVG text of a map's art (/maps/<file>), fetched the first time it's asked for.
 * @param {string} file
 * @returns {Promise<string>}
 */
export async function loadMapArt(file) {
  if (!mapArtByFile[file]) {
    const response = await fetch("/maps/" + encodeURIComponent(file));
    mapArtByFile[file] = await response.text();
  }
  return mapArtByFile[file];
}
