// Tests for the map projection (projection.js). The vectors were measured on tarkov.dev's own
// Streets map; the projection must land on them.
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { readRepoJson, mapConfigs } from "../../../tests/support/game-data.js";
import { makeProj, floorBadge, badgeName, arrowRotation } from "./projection.js";

const vectors = readRepoJson("tests/fixtures/projection-vectors.streets.json");
const streetsConfig = mapConfigs.find((config) => config.key === "streets-of-tarkov");
const projection = makeProj(streetsConfig, vectors.viewBox);

for (const vector of vectors.vectors) {
  test(`${vector.name} projects to within 1.5 SVG units of tarkov.dev and back`, () => {
    const [svgX, svgY] = projection.toSvg(vector.game.x, vector.game.z);
    const svgDistance = Math.hypot(svgX - vector.svg_viewbox.x, svgY - vector.svg_viewbox.y);
    assert.ok(svgDistance < 1.5, `expected less than 1.5 SVG units off, got ${svgDistance}`);

    const [gameX, gameZ] = projection.toGame(svgX, svgY);
    const roundTripError = Math.abs(gameX - vector.game.x) + Math.abs(gameZ - vector.game.z);
    assert.ok(roundTripError < 0.01, `expected round trip within 0.01 m, got ${roundTripError}`);
  });
}

test("upstairs gets its floor number, ground level gets no badge, underground gets B", () => {
  // Ballet Lover apartment
  assert.equal(floorBadge(streetsConfig, 47.63, 12.66, 153.12), "2");
  assert.equal(floorBadge(streetsConfig, 0, 1, 0), null);
  assert.equal(floorBadge(streetsConfig, 0, -20, 0), "B");
});

// Ticket 31 moved the floor search into features/levels/rules.js levelOfPosition. These badges
// were taken from the code before the move (a one-off run over every task zone, extract and loot
// spot of these maps found no difference either).
const badgeCasesBeforeTicket31 = [
  ["customs", 200, 4, 150, "2"], // dorms
  ["customs", 200, 1, 150, null],
  ["customs", -210, 8, -110, "2"], // big red, upstairs
  ["factory", 0, -3, 0, "B"],
  ["factory", 0, 4, 0, "2"],
  ["factory", 0, 7, 0, "3"],
  ["ground-zero", 80, 15, 0, "B"], // garage
  ["ground-zero", 80, 22, 0, null],
  ["interchange", 0, 30, 0, "2"], // mall
  ["interchange", 0, 36, 0, "3"],
  ["interchange", 300, 30, 300, null], // high, but outside the mall
  ["reserve", -120, -2, 60, "2"], // pawns, a floor without its own picture
  ["shoreline", -180, -6, -85, "B"],
  ["shoreline", 0, 0, 0, "2"],
];
for (const [mapKey, x, y, z, badge] of badgeCasesBeforeTicket31) {
  test(`${mapKey} at (${x}, ${y}, ${z}) keeps its floor badge ${badge}`, () => {
    const config = mapConfigs.find((candidate) => candidate.key === mapKey);
    assert.equal(floorBadge(config, x, y, z), badge);
  });
}

test("The Lab's levels get badges: Second Level 2, Technical B, the 1st level none", () => {
  const labConfig = mapConfigs.find((config) => config.key === "the-lab");
  assert.equal(floorBadge(labConfig, -170, 4, -350), "2");
  assert.equal(floorBadge(labConfig, -112.3, -3.11, -344.04), "B"); // medical elevator
  assert.equal(floorBadge(labConfig, -170, 0.5, -350), null);
  assert.equal(floorBadge(labConfig, -170.49, 5.54, -218.87), null); // hangar: high, but 1st level
});

test("a level name with its number spelled out gets that number as badge", () => {
  assert.equal(badgeName("Second Level"), "2");
  assert.equal(badgeName("third floor"), "3");
  assert.equal(badgeName("2nd Floor"), "2");
  assert.equal(badgeName("Technical"), "B");
  assert.equal(badgeName("Roof"), "R");
});

test("the arrow is turned by the same correction tarkov.dev applies", () => {
  assert.equal(arrowRotation({ rotation: 180 }, 10), 190);
  assert.equal(arrowRotation({ rotation: 90 }, 0), 270);
});

// The Labyrinth's art is tarkov.dev's tile pyramid (zoom 4) stitched and cropped, so its vectors
// are where tarkov.dev's tile layer puts real game positions (see the fixture's "about").
const labyrinthVectors = readRepoJson("tests/fixtures/projection-vectors.labyrinth.json");
const labyrinthConfig = mapConfigs.find((config) => config.key === labyrinthVectors.map);
const labyrinthArt = readFileSync(new URL("../../../assets/" + labyrinthVectors.svg, import.meta.url), "utf8");
const labyrinthViewBox = labyrinthArt.match(/viewBox="([^"]+)"/)[1].split(" ").map(Number);
const labyrinthImage = labyrinthArt.match(/<image x="([^"]+)" y="([^"]+)" width="(\d+)" height="(\d+)"/);
const [imageX, imageY] = [Number(labyrinthImage[1]), Number(labyrinthImage[2])];
const labyrinthProjection = makeProj(labyrinthConfig, labyrinthViewBox);

test("the Labyrinth's art is the zoom-4 tiles, placed so one image pixel is one tile pixel", () => {
  assert.equal(labyrinthVectors.zoom, 4);
  assert.deepEqual(labyrinthConfig.transform, [2.115, 85.5, 2.115, 128.0]);
  assert.equal(labyrinthConfig.rotation, 270);
  // One SVG unit is 1/16 of a map-bounds pixel at zoom 0, i.e. one pixel at zoom 4.
  assert.ok(Math.abs(labyrinthProjection.unit - 2.115 * 16) < 1e-9);
});

for (const vector of labyrinthVectors.vectors) {
  test(`${vector.name} lands on tarkov.dev's tile pixel and back`, () => {
    const expectedX = vector.tile_pixel.x - labyrinthVectors.crop.left + imageX;
    const expectedY = vector.tile_pixel.y - labyrinthVectors.crop.top + imageY;
    const [svgX, svgY] = labyrinthProjection.toSvg(vector.game.x, vector.game.z);
    const distance = Math.hypot(svgX - expectedX, svgY - expectedY);
    assert.ok(distance < 0.05, `expected within 0.05 SVG units (a pixel of the art), got ${distance}`);

    const [gameX, gameZ] = labyrinthProjection.toGame(svgX, svgY);
    assert.ok(Math.abs(gameX - vector.game.x) + Math.abs(gameZ - vector.game.z) < 0.01);
  });
}

// The Lab's art (ticket 31) is the same kind of stitched tiles, one complete picture per level.
// Its tiles are 256-px images covering 175 Leaflet pixels each, so the pictures have 256/175
// image pixels per SVG unit and one SVG unit is one zoom-4 Leaflet pixel.
const labVectors = readRepoJson("tests/fixtures/projection-vectors.lab.json");
const labConfig = mapConfigs.find((config) => config.key === labVectors.map);
const labArt = readFileSync(new URL("../../../assets/" + labVectors.svg, import.meta.url), "utf8");
const labViewBox = labArt.match(/viewBox="([^"]+)"/)[1].split(" ").map(Number);
const labImagePattern = /<g id="([^"]+)"><image x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"[^>]*base64,([^"]+)"/g;
const labImages = [...labArt.matchAll(labImagePattern)];
const labProjection = makeProj(labConfig, labViewBox);
const imagePixelsPerLeafletPixel = labVectors.tile_image_size / labVectors.tile_size;

/** The canvas size in a WebP's VP8X header (from the file's base64 text). */
function webpSize(base64) {
  const bytes = Buffer.from(base64.slice(0, 64), "base64");
  assert.equal(bytes.toString("ascii", 12, 16), "VP8X");
  return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
}

test("The Lab's art has one picture per level, each named like its level in the config", () => {
  const groupIds = labImages.map((image) => image[1]);
  assert.deepEqual(groupIds, labConfig.svgGroups.map((group) => group[0]));
  assert.equal(groupIds[0], labConfig.baseLayer);
  assert.deepEqual(labConfig.layers.map((layer) => layer.svgLayer), groupIds.slice(1));
});

test("The Lab's art is the zoom-4 tiles: viewBox = bounds × 16, every picture placed the same way", () => {
  assert.equal(labVectors.zoom, 4);
  assert.deepEqual(labConfig.transform, [0.575, 281.2, 0.575, 193.7]);
  assert.equal(labConfig.rotation, 270);
  assert.ok(Math.abs(labProjection.unit - 0.575 * 16) < 1e-9, "one SVG unit is one zoom-4 pixel");
  const firstPlacement = labImages[0].slice(2, 6);
  for (const image of labImages) {
    const [, id, x, y, width, height, base64] = image;
    assert.deepEqual([x, y, width, height], firstPlacement, `${id} is placed like the others`);
    const pixels = webpSize(base64);
    assert.ok(Math.abs(Number(width) * imagePixelsPerLeafletPixel - pixels.width) < 0.01, `${id} width`);
    assert.ok(Math.abs(Number(height) * imagePixelsPerLeafletPixel - pixels.height) < 0.01, `${id} height`);
  }
});

for (const vector of labVectors.vectors) {
  test(`${vector.name} lands on The Lab's tile pixel and back`, () => {
    const imageX = Number(labImages[0][2]);
    const imageY = Number(labImages[0][3]);
    // The tile image pixel, minus the crop, back in SVG units, from where the pictures start.
    const imagePixelX = vector.tile_pixel.x * imagePixelsPerLeafletPixel - labVectors.crop.left;
    const imagePixelY = vector.tile_pixel.y * imagePixelsPerLeafletPixel - labVectors.crop.top;
    const expectedX = imageX + imagePixelX / imagePixelsPerLeafletPixel;
    const expectedY = imageY + imagePixelY / imagePixelsPerLeafletPixel;
    const [svgX, svgY] = labProjection.toSvg(vector.game.x, vector.game.z);
    const distance = Math.hypot(svgX - expectedX, svgY - expectedY);
    assert.ok(distance < 0.05, `expected within 0.05 SVG units (under a pixel of the art), got ${distance}`);

    const [gameX, gameZ] = labProjection.toGame(svgX, svgY);
    assert.ok(Math.abs(gameX - vector.game.x) + Math.abs(gameZ - vector.game.z) < 0.01);
  });
}
