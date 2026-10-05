// Matching task names read from screenshots (or typed) to the game data.
export const norm = (s) => String(s || "").toLowerCase().replace(/[‐-―]/g, "-").replace(/[^a-z0-9]/g, "");

export function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let p = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const c = [i];
    for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    p = c;
  }
  return p[n];
}
export const ratio = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);

export function makeMatcher(tasks) {
  const byNorm = new Map();
  for (const t of tasks) { const k = norm(t.name); if (!byNorm.has(k)) byNorm.set(k, []); byNorm.get(k).push(t); }
  const keys = [...byNorm.keys()];
  /** Returns {task, fixed} or null. `trader` (optional) breaks ties between same-name tasks. */
  function match(name, trader) {
    const q = norm(name);
    if (!q) return null;
    let list = byNorm.get(q), fixed = false;
    if (!list) {
      let best = null, bs = 0;
      for (const k of keys) { if (Math.abs(k.length - q.length) > 8) continue; const r = ratio(q, k); if (r > bs) { bs = r; best = k; } }
      if (bs >= 0.82) { list = byNorm.get(best); fixed = true; }
    }
    if (!list) return null;
    let t = list[0];
    if (list.length > 1 && trader) { const tn = norm(trader); t = list.find((x) => norm(x.trader) === tn) || t; }
    return { task: t, fixed, all: list };
  }
  return { match, byNorm };
}
