// Tests for the map projection (projection.js). The vectors were measured on tarkov.dev's own
// Streets map; the projection must land on them.
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { readRepoJson, mapConfigs } from "../../../tests/support/game-data.js";
import { makeProj, floorBadge, arrowRotation } from "./projection.js";

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
