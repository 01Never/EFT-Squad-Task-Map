// Douglas–Peucker line simplification for drawn strokes.
export function simplify(p, eps) {
  if (p.length < 3) return p;
  const d = (q, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    if (!l) return Math.hypot(q[0] - a[0], q[1] - a[1]);
    let t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
  };
  let m = 0, i0 = 0;
  for (let i = 1; i < p.length - 1; i++) { const v = d(p[i], p[0], p[p.length - 1]); if (v > m) { m = v; i0 = i; } }
  return m > eps ? simplify(p.slice(0, i0 + 1), eps).slice(0, -1).concat(simplify(p.slice(i0), eps)) : [p[0], p[p.length - 1]];
}
