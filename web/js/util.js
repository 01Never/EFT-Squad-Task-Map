export const NS = "http://www.w3.org/2000/svg";
export const $ = (s, root = document) => root.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const uid = () => Math.random().toString(36).slice(2, 10);

let toastTimer = null;
export function toast(msg, action) {
  const t = $("#toast");
  t.innerHTML = esc(msg) + (action ? ` <button class="btn sm line" id="toastAct">${esc(action.label)}</button>` : "");
  t.style.display = "block";
  if (action) $("#toastAct").onclick = () => { t.style.display = "none"; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.style.display = "none"), action ? 7000 : 3000);
}

export function mk(tag, a, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in a) if (a[k] != null) e.setAttribute(k, a[k]);
  if (parent) parent.appendChild(e);
  return e;
}

export function ago(ms) {
  if (!ms) return "never";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return Math.round(s / 86400) + " d ago";
}

export const SHAPES = ["circle", "square", "diamond", "triangle", "star", "hexagon"];
export function shapeD(icon, r) {
  const p = [];
  if (icon === "square") return `M${-r * 0.85},${-r * 0.85}h${r * 1.7}v${r * 1.7}h${-r * 1.7}z`;
  if (icon === "diamond") return `M0,${-r * 1.15}L${r * 1.15},0L0,${r * 1.15}L${-r * 1.15},0z`;
  if (icon === "triangle") return `M0,${-r * 1.2}L${r * 1.1},${r * 0.8}L${-r * 1.1},${r * 0.8}z`;
  if (icon === "hexagon") { for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i + Math.PI / 6; p.push(`${(r * 1.05 * Math.cos(a)).toFixed(2)},${(r * 1.05 * Math.sin(a)).toFixed(2)}`); } return "M" + p.join("L") + "z"; }
  if (icon === "star") { for (let i = 0; i < 10; i++) { const a = (Math.PI / 5) * i - Math.PI / 2, rr = i % 2 ? r * 0.55 : r * 1.25; p.push(`${(rr * Math.cos(a)).toFixed(2)},${(rr * Math.sin(a)).toFixed(2)}`); } return "M" + p.join("L") + "z"; }
  return `M${r},0A${r},${r} 0 1 1 ${-r},0A${r},${r} 0 1 1 ${r},0z`;
}
export const swatch = (icon, color, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="-12 -12 24 24" aria-hidden="true" style="flex:none"><path d="${shapeD(icon, 9)}" fill="${color}" stroke="#000" stroke-width="2"/></svg>`;

/** Simple modal. Returns {el, close}. */
export function modal(html, { wide = false, onClose } = {}) {
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="box${wide ? " wide" : ""}">${html}</div>`;
  document.body.appendChild(m);
  const close = () => { m.remove(); removeEventListener("keydown", key); onClose && onClose(); };
  const key = (e) => { if (e.key === "Escape") close(); };
  addEventListener("keydown", key);
  m.addEventListener("click", (e) => { if (e.target === m) close(); });
  return { el: m, close };
}

export async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body });
  let j = null;
  try { j = await r.json(); } catch {}
  if (!r.ok || (j && j.ok === false)) throw new Error((j && j.error) || `HTTP ${r.status}`);
  return j;
}

export const ICON = (id) => `https://assets.tarkov.dev/${id}-icon.webp`;
export const MODE_NAME = { regular: "PvP", pve: "PvE", "pvp-season": "PvP Season" };
