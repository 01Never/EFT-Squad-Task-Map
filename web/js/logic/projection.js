// Map projection — after tarkov.dev src/pages/map/index.jsx (MIT): getCRS/applyRotation/pos + L.svgOverlay placement.
// Game position {x, z} → SVG viewBox coordinates of the map art.

export function makeProj(cfg, vbox) {
  const [a, b, c0, d] = cfg.transform, c = -c0, rad = ((cfg.rotation || 0) * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const pix = (x, z) => { const rx = x * cos - z * sin, ry = x * sin + z * cos; return [a * rx + b, c * ry + d]; };
  const B = cfg.svgBounds || cfg.bounds, lats = [B[0][1], B[1][1]], lngs = [B[0][0], B[1][0]];
  const p1 = pix(Math.min(...lngs), Math.max(...lats)), p2 = pix(Math.max(...lngs), Math.min(...lats));
  const minx = Math.min(p1[0], p2[0]), miny = Math.min(p1[1], p2[1]), BW = Math.abs(p1[0] - p2[0]), BH = Math.abs(p1[1] - p2[1]);
  const [vx, vy, VW, VH] = vbox, s = Math.min(BW / VW, BH / VH), ox = (BW - VW * s) / 2, oy = (BH - VH * s) / 2;
  return {
    toSvg(x, z) { const [px, py] = pix(x, z); return [vx + (px - minx - ox) / s, vy + (py - miny - oy) / s]; },
    toGame(sx, sy) { const px = (sx - vx) * s + ox + minx, py = (sy - vy) * s + oy + miny, rx = (px - b) / a, ry = (py - d) / c; return [rx * cos + ry * sin, -rx * sin + ry * cos]; },
    unit: Math.abs(a) / s,
  };
}

/** Floor badge ("2", "3", "B" …) for a game position, using the map's layer height extents; null = ground. */
export function floorBadge(cfg, x, y, z) {
  if (y == null) return null;
  for (const L of cfg.layers) for (const e of L.extents) {
    const [lo, hi] = e.height;
    if (y < lo || y >= hi) continue;
    if (e.bounds && !e.bounds.some((bb) => x >= Math.min(bb[0][0], bb[1][0]) && x <= Math.max(bb[0][0], bb[1][0]) && z >= Math.min(bb[0][1], bb[1][1]) && z <= Math.max(bb[0][1], bb[1][1]))) continue;
    return badgeName(L.name);
  }
  return null;
}
export function badgeName(n) {
  const m = n.match(/(\d)/);
  if (m) return m[1];
  if (/under|bunker|tunnel|garage|basement|technical|sewer/i.test(n)) return "B";
  return n[0].toUpperCase();
}

/** Screen rotation (deg, clockwise from up) for the player arrow — same correction tarkov.dev applies. */
export function arrowRotation(cfg, yaw) {
  let add = cfg.rotation || 0;
  if (add === 90 || add === 270) add += 180;
  return (yaw || 0) + add;
}
