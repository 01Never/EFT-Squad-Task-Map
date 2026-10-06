// Tests for the map projection (projection.js). The vectors were measured on tarkov.dev's own
// Streets map; the projection must land on them.
import { test } from "node:test";
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
