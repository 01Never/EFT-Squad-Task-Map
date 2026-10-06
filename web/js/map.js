// The map page: SVG map art, pan/zoom/pinch, drawing, markers, zones, extracts, GPS arrow, popup.
import { app, prefs, save, partsFor, catOf, tasksOn, setTick, mapName } from "./store.js";
import { $, esc, mk, toast, shapeD, uid } from "./util.js";
import { makeProj, floorBadge } from "./logic/projection.js";
import { simplify } from "./logic/simplify.js";
import { objOnMap, partOnMap, partDone, objDone, partProgress, isCounter, tickValue, tickTarget, ACTION_LABEL } from "./logic/parts.js";
import { objReady, missingFor, requirementsOf } from "./logic/ready.js";
import { renderPanel, bindPanel } from "./panel.js";
import { renderPlayer, placeFindMeOverlays, bindFindMe } from "./features/find-me/map-layer.js";

const svgCache = {};
export async function getSvg(file) {
  if (!svgCache[file]) svgCache[file] = await (await fetch("/maps/" + encodeURIComponent(file))).text();
  return svgCache[file];
}

// ---------------------------------------------------------------- which parts are on this map / visible
export function mapParts(k) {
  const S = app.S, out = [];
  for (const t of tasksOn(k)) {
    const e = S.tasks[t.id];
    for (const p of partsFor(t)) {
      if (!partOnMap(p, k, t)) continue;
      out.push({ task: t, part: p, cat: catOf(t, p), done: partDone(p, S.ticks), pinned: !!(e && e.pinned) });
    }
  }
  return out;
}
export const shownOnMap = (x) => x.cat.visible && !x.done && (!app.S.pinnedOnly || x.pinned);

// ---------------------------------------------------------------- open / close
export function teardownMap() {
  const M = app.M;
  if (M) { removeEventListener("keydown", M.onKey); if (M.ro) M.ro.disconnect(); }
  app.M = null;
}

export async function openMap(key) {
  teardownMap();
  const cfg = app.CFG.find((c) => c.key === key);
  $("#crumbs").innerHTML = `<a href="#/">Maps</a> / <b>${esc(cfg.name)}</b>`;
  $("#view").innerHTML = `<div class="app${app.S.panelHidden ? " nopanel" : ""}"><div class="stage" id="stage"><div class="fx" id="fx"></div>
    <div class="findme-fx" id="findme-fx"><div class="findme-pulse" id="findme-pulse"></div></div><button class="findme-chip" id="findme-chip" hidden title="Centre on you"><span class="findme-chip-arrow">➜</span><span class="findme-chip-text"></span></button><div class="mapui">
    <div class="grp"><button id="zin" title="Zoom in">+</button><button id="zout" title="Zoom out">−</button><button id="zfit" title="Reset view">⤢</button><button id="bfindme" disabled>📍<span class="lbl"> Find me</span></button><button id="bfollow" aria-pressed="false" title="Center the map on me at each screenshot (keeps your zoom)">⌖<span class="lbl"> Follow</span></button><button id="bdraw" aria-pressed="false" title="Draw on the map">✎<span class="lbl"> Draw</span></button><button id="bpin" title="Show only pinned tasks">📌<span class="lbl"> Pinned only</span></button><span id="floors" style="display:flex;align-items:center"></span></div>
    <div class="grp" id="drawbar" hidden></div></div><div class="hint" id="hint"></div><div class="gpsbar" id="gpsbar" hidden></div><div class="pop" id="pop"></div><button class="showpanel" id="showpanel" title="Show the task list">◂ Tasks</button></div><aside id="panel"></aside></div>`;
  const txt = await getSvg(cfg.svg);
  if (location.hash !== "#/map/" + key) return; // navigated away while loading
  const doc = new DOMParser().parseFromString(txt, "image/svg+xml").documentElement;
  const svg = document.importNode(doc, true);
  svg.removeAttribute("width"); svg.removeAttribute("height"); svg.setAttribute("class", "map");
  [...svg.children].forEach((g) => { if (g.tagName === "g" && g.id) { const base = g.id === cfg.baseLayer || g.dataset.keepWithGroup === cfg.baseLayer; g.classList.add("lyr", base ? "base" : "off"); } });
  $("#stage").prepend(svg);
  const vbx = svg.viewBox.baseVal, home = { x: vbx.x, y: vbx.y, w: vbx.width, h: vbx.height };
  const M = (app.M = { key, cfg, svg, home, vb: { ...home }, proj: makeProj(cfg, [vbx.x, vbx.y, vbx.width, vbx.height]), floor: "ground", mode: "pan", placing: null, sel: null, pop: null, expanded: null, menu: null, redo: [] });
  M.gZones = mk("g", {}, svg); M.gLabels = mk("g", {}, svg); M.gDraw = mk("g", {}, svg); M.gExt = mk("g", {}, svg); M.gMk = mk("g", {}, svg); M.gGps = mk("g", {}, svg);
  M.mapData = app.DATA.maps.find((m) => m.key === key) || { extracts: [], transits: [] };
  bindMap(); bindPanel(); bindFindMe(); renderFloors(); renderAll(); fitTo(home, 0);
  // Opened because of a new position (Follow my position): centre on it at the map's default zoom.
  if (app.gps && app.gps.map === key) { const [x, y] = M.proj.toSvg(app.gps.x, app.gps.z); panTo(x, y); }
}

// ---------------------------------------------------------------- view
const K = () => app.M.vb.w / app.M.svg.getBoundingClientRect().width;
let rafPending = false;
function applySoon() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; if (app.M) apply(); }); }
export function apply() {
  const { svg, vb } = app.M;
  svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const k = K();
  svg.querySelectorAll(".sc").forEach((g) => g.setAttribute("transform", `translate(${+g.dataset.x + (+g.dataset.ox || 0) * k},${+g.dataset.y + (+g.dataset.oy || 0) * k}) scale(${k * (+g.dataset.s || 1)})${g.dataset.r ? ` rotate(${g.dataset.r})` : ""}`));
  if (isFinite(k) && k > 0) app.M.k = k;
  placeFx();
  placeFindMeOverlays();
}
/** Move the view so (x, y) in map coordinates is in the middle, keeping the zoom. */
export function panTo(x, y) {
  const M = app.M; if (!M) return;
  M.vb = { ...M.vb, x: x - M.vb.w / 2, y: y - M.vb.h / 2 }; apply();
}
/** When the map area changes size (window resized, task list hidden/shown), keep the same centre and zoom. */
function keepView() {
  const M = app.M; if (!M || !M.k) return;
  const r = M.svg.getBoundingClientRect(); if (r.width < 10 || r.height < 10) return;
  const cx = M.vb.x + M.vb.w / 2, cy = M.vb.y + M.vb.h / 2, w = r.width * M.k, h = r.height * M.k;
  M.vb = { x: cx - w / 2, y: cy - h / 2, w, h }; apply();
}
export function setPanelHidden(hidden) {
  const M = app.M; app.S.panelHidden = hidden; save();
  const a = document.querySelector(".app"); if (a) a.classList.toggle("nopanel", hidden);
  if (!hidden && M) { renderPanel(); const el = M.sel && document.querySelector(`.task[data-part="${CSS.escape(M.sel)}"] .trow-wrap`); if (el) el.scrollIntoView({ block: "center" }); }
}

// ---------------------------------------------------------------- selected-task highlight
// The rings around the selected task's markers are HTML elements over the map, animated with CSS
// transform/opacity only. The browser runs that on the compositor without repainting the map art,
// so it can keep flashing for as long as the task is selected at almost no cost.
const FX_MAX = 40;
function renderFx(pts) {
  const M = app.M, box = $("#fx"); if (!box) return;
  pts = pts.slice(0, FX_MAX);
  const sig = (M.sel || "") + ":" + pts.length;
  if (box.dataset.sig !== sig) { box.dataset.sig = sig; box.innerHTML = pts.map(() => '<div class="ping"><i class="halo"></i><i class="wave"></i></div>').join(""); }
  M.fxPts = pts;
  placeFx();
}
function placeFx() {
  const M = app.M, box = M && $("#fx"); if (!box || !M.fxPts || !M.fxPts.length) return;
  const m = M.svg.getScreenCTM(); if (!m) return;
  const b = box.getBoundingClientRect(), els = box.children;
  M.fxPts.forEach((p, i) => {
    const x = m.a * p.x + m.c * p.y + m.e - b.left + (p.ox || 0), y = m.b * p.x + m.d * p.y + m.f - b.top + (p.oy || 0);
    if (els[i]) els[i].style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
  });
}
export function fitTo(b, pad) {
  const M = app.M, r = M.svg.getBoundingClientRect(), ar = r.width / Math.max(r.height, 1);
  let { x, y, w, h } = b; const MIN = M.home.w / 3.5;
  if (w < MIN) { x -= (MIN - w) / 2; w = MIN; } if (h < MIN) { y -= (MIN - h) / 2; h = MIN; }
  w += pad * 2; h += pad * 2; x -= pad; y -= pad;
  if (w / h > ar) { const nh = w / ar; y -= (nh - h) / 2; h = nh; } else { const nw = h * ar; x -= (nw - w) / 2; w = nw; }
  M.vb = { x, y, w, h }; apply();
}
function zoomAt(f, cx, cy) {
  const M = app.M, r = M.svg.getBoundingClientRect(), { vb, home } = M;
  const px = vb.x + ((cx - r.left) / r.width) * vb.w, py = vb.y + ((cy - r.top) / r.height) * vb.h;
  const nw = Math.min(Math.max(vb.w * f, home.w / 40), home.w * 1.8), nf = nw / vb.w;
  M.vb = { x: px - (px - vb.x) * nf, y: py - (py - vb.y) * nf, w: nw, h: vb.h * nf }; applySoon();
}
function toSvgPt(cx, cy) { const M = app.M, r = M.svg.getBoundingClientRect(); return [M.vb.x + ((cx - r.left) / r.width) * M.vb.w, M.vb.y + ((cy - r.top) / r.height) * M.vb.h]; }
/**
 * Run `fn` once the user isn't dragging or pinching the map: now if no finger or button is down,
 * otherwise when the last one lets go. Only the latest request is kept. (Ticket 02: a new position
 * must not yank the map out from under a drag.)
 */
export function afterUserLetsGo(fn) {
  const M = app.M; if (!M) return;
  if (M.pointersDown) M.afterGesture = fn; else fn();
}

// ---------------------------------------------------------------- input
function bindMap() {
  const M = app.M, svg = M.svg, pts = new Map(), S = app.S;
  let moved = 0, pinch = null, live = null;
  const released = (id) => {
    pts.delete(id); M.pointersDown = pts.size;
    if (!pts.size && M.afterGesture) { const fn = M.afterGesture; M.afterGesture = null; fn(); }
  };
  svg.addEventListener("pointerdown", (e) => {
    svg.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; M.pointersDown = pts.size;
    if (pts.size === 2) { pinch = null; if (live) { live.el.remove(); live = null; } }
    if (M.mode === "draw" && pts.size === 1) {
      const [sx, sy] = toSvgPt(e.clientX, e.clientY); const w = +(S.dwidth * K()).toFixed(3);
      live = { pts: [[sx, sy]], w, c: S.dcolor, el: mk("polyline", { fill: "none", stroke: S.dcolor, "stroke-width": w, "stroke-linecap": "round", "stroke-linejoin": "round" }, M.gDraw) };
    }
  });
  svg.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId), cur = { x: e.clientX, y: e.clientY }; pts.set(e.pointerId, cur);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (pinch) { zoomAt(pinch.d / d, mx, my); const k = K(); M.vb.x -= (mx - pinch.mx) * k; M.vb.y -= (my - pinch.my) * k; applySoon(); }
      pinch = { d, mx, my }; moved += 99; return;
    }
    moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
    if (M.mode === "draw" && live) { live.pts.push(toSvgPt(cur.x, cur.y)); live.el.setAttribute("points", live.pts.map((p) => p.join(",")).join(" ")); return; }
    const k = K(); M.vb.x -= (cur.x - prev.x) * k; M.vb.y -= (cur.y - prev.y) * k; applySoon();
  });
  const up = (e) => {
    const tap = pts.size === 1 && moved < 7;
    if (M.mode === "draw" && live && pts.size === 1) {
      let p = live.pts; if (p.length === 1) p.push([p[0][0] + 0.05, p[0][1]]); p = simplify(p, live.w * 0.25);
      const P = M.proj;
      (S.draw[M.key] = S.draw[M.key] || []).push({ c: live.c, w: +(live.w / P.unit).toFixed(3), pts: p.map((q) => P.toGame(q[0], q[1]).map((v) => +v.toFixed(2))) });
      M.redo = []; live = null; save(); renderDraw(); renderDrawbar();
    } else if (tap && M.mode === "place" && M.placing) {
      const [sx, sy] = toSvgPt(e.clientX, e.clientY), [gx, gz] = M.proj.toGame(sx, sy); const s = S.subs.find((q) => q.id === M.placing);
      if (s) { s.map = M.key; s.x = +gx.toFixed(2); s.z = +gz.toFixed(2); save(); }
      setMode("pan"); M.placing = null; renderAll(); toast("Marker placed");
    } else if (tap && M.mode === "pan") {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const g = hit && hit.closest(".mk"), ex = hit && hit.closest(".ex");
      if (g) { const it = M.idx[g.dataset.k]; select(it.part.key, false, it); }
      else if (ex) toggleExtract(ex.dataset.name);
      else if (M.sel) { M.sel = null; M.pop = null; renderAll(); }
    }
    if (pts.size <= 2) pinch = null;
    released(e.pointerId);
  };
  svg.addEventListener("pointerup", up);
  svg.addEventListener("pointercancel", (e) => { pinch = null; if (live) { live.el.remove(); live = null; } released(e.pointerId); });
  svg.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
  const ctr = () => { const r = svg.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  $("#zin").onclick = () => zoomAt(1 / 1.4, ...ctr());
  $("#zout").onclick = () => zoomAt(1.4, ...ctr());
  $("#zfit").onclick = () => fitTo(M.home, 0);
  $("#bdraw").onclick = () => setMode(M.mode === "draw" ? "pan" : "draw");
  $("#bpin").onclick = () => { S.pinnedOnly = !S.pinnedOnly; save(); renderAll(); };
  $("#floors").addEventListener("change", (e) => { M.floor = e.target.value; renderFloors(); renderLabels(); });
  $("#drawbar").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.c) S.dcolor = b.dataset.c;
    else if (b.id === "dundo") undo();
    else if (b.id === "dredo") redo();
    else if (b.id === "dclear") { const l = S.draw[M.key] || []; if (l.length && confirm("Clear all your drawings on this map?")) { M.redo = []; S.draw[M.key] = []; } }
    else if (b.id === "dshow") prefs(M.key).drawOn = !prefs(M.key).drawOn;
    save(); renderDrawbar(); renderDraw();
  });
  $("#drawbar").addEventListener("input", (e) => { if (e.target.id === "dcol") S.dcolor = e.target.value; if (e.target.id === "dw") S.dwidth = +e.target.value; save(); });
  $("#pop").addEventListener("click", popClick);
  $("#pop").addEventListener("change", popChange);
  M.onKey = (e) => {
    if (e.target.matches("input,select,textarea")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if (e.key === "Escape") {
      if (M.mode !== "pan" || M.placing) { setMode("pan"); M.placing = null; }
      else if (M.sel) { M.sel = null; M.pop = null; renderAll(); }
    }
  };
  M.ro = new ResizeObserver(() => keepView()); M.ro.observe($("#stage"));
  $("#showpanel").onclick = () => setPanelHidden(false);
  addEventListener("keydown", M.onKey);
}
function undo() { const M = app.M, l = app.S.draw[M.key] || []; if (l.length) { M.redo.push(l.pop()); save(); renderDraw(); renderDrawbar(); } }
function redo() { const M = app.M; if (M.redo.length) { (app.S.draw[M.key] = app.S.draw[M.key] || []).push(M.redo.pop()); save(); renderDraw(); renderDrawbar(); } }
export function setMode(m) {
  const M = app.M; M.mode = m;
  const st = $("#stage"); st.classList.toggle("draw", m === "draw"); st.classList.toggle("place", m === "place");
  const h = $("#hint"); h.style.display = m === "place" ? "block" : "none"; h.textContent = "Click the map to place the sub-task marker · Esc to cancel";
  $("#bdraw").setAttribute("aria-pressed", m === "draw"); $("#drawbar").hidden = m !== "draw"; renderDrawbar();
}
const COLORS = ["#ff4d4d", "#ffe084", "#2fbf3a", "#0292c0", "#f783ac", "#ffffff", "#ff922b", "#000000"];
function renderDrawbar() {
  const d = $("#drawbar"), M = app.M, S = app.S; if (!d || d.hidden) return; const l = S.draw[M.key] || [];
  d.innerHTML = COLORS.map((c) => `<button class="sw" data-c="${c}" style="background:${c}" aria-pressed="${S.dcolor === c}" title="${c}"></button>`).join("") +
    `<input type="color" id="dcol" value="${S.dcolor}" title="Custom colour"><input type="range" id="dw" min="2" max="16" value="${S.dwidth}" title="Line width"><button id="dundo" ${l.length ? "" : "disabled"}>↶ Undo</button><button id="dredo" ${M.redo.length ? "" : "disabled"}>↷ Redo</button><button id="dclear">Clear</button><button id="dshow" aria-pressed="${prefs(M.key).drawOn}">Show</button>`;
}

// ---------------------------------------------------------------- layers
export function renderAll() {
  if (!app.M) return;
  renderPanel(); renderLabels(); renderExtracts(); renderDraw(); renderMarkers(); renderPlayer(); renderPop();
  $("#bpin").setAttribute("aria-pressed", !!app.S.pinnedOnly);
}
function renderFloors() {
  const M = app.M, layers = M.cfg.layers.filter((l) => l.svgLayer), f = $("#floors");
  f.innerHTML = layers.length ? `<select title="Show a floor's layout">${[`<option value="ground">Ground</option>`, ...layers.map((l) => `<option value="${esc(l.svgLayer)}" ${M.floor === l.svgLayer ? "selected" : ""}>${esc(l.name)}</option>`)].join("")}</select>` : "";
  M.svg.querySelectorAll(".lyr:not(.base)").forEach((g) => g.classList.toggle("off", g.id !== M.floor));
}
export function renderLabels() {
  const M = app.M, g = M.gLabels; g.innerHTML = ""; if (!prefs(M.key).labels) return;
  const top = M.cfg.heightRange ? M.cfg.heightRange[1] : 10, L = M.cfg.layers.find((l) => l.svgLayer === M.floor);
  M.cfg.labels.forEach((l) => {
    let show;
    if (l.bottom == null && l.top == null) show = true;
    else if (!L) show = (l.bottom ?? -1e9) < Math.min(top, 10);
    else show = L.extents.some((e) => (l.bottom ?? -1e9) < e.height[1] && (l.top ?? 1e9) > e.height[0]);
    if (!show) return;
    const [x, y] = M.proj.toSvg(l.x, l.z);
    const lg = mk("g", { class: "sc", "data-x": x, "data-y": y, "pointer-events": "none" }, g);
    const t = mk("text", { "text-anchor": "middle", "font-size": 13, "font-family": "bender, Arial, sans-serif", "font-weight": 700, fill: "#e0dfd6", stroke: "#000", "stroke-width": 3, "paint-order": "stroke", transform: l.r ? `rotate(${l.r})` : null }, lg);
    t.textContent = l.t;
  });
  apply();
}
export const EXT_COLORS = { pmc: "#00a700", scav: "#0292c0", shared: "#ca8a00", transit: "#8c6edf" };
export const extKind = (e) => (e.fa === "scav" ? "scav" : e.fa === "pmc" ? "pmc" : "shared");
export function extractList() {
  const md = app.M.mapData;
  return md.extracts.map((e) => ({ ...e, k: extKind(e) })).concat(md.transits.map((t) => ({ ...t, k: "transit" })));
}
export function renderExtracts() {
  const M = app.M, g = M.gExt; g.innerHTML = "";
  const p = prefs(M.key), marked = p.extMarked || {};
  for (const e of extractList()) {
    if (!p.ext[e.k]) continue;
    const on = !!marked[e.n], col = EXT_COLORS[e.k];
    if (e.ol) mk("polygon", { points: e.ol.map((q) => M.proj.toSvg(q[0], q[1]).map((v) => v.toFixed(2)).join(",")).join(" "), fill: col, "fill-opacity": on ? 0.18 : 0.06, stroke: col, "stroke-width": on ? 2.2 : 1.4, "stroke-dasharray": on ? null : "5 4", "vector-effect": "non-scaling-stroke", opacity: on ? 1 : 0.6, "pointer-events": "none" }, g);
    const [x, y] = M.proj.toSvg(e.x, e.z);
    const eg = mk("g", { class: "sc ex" + (on ? " on" : ""), "data-x": x, "data-y": y, "data-name": e.n, style: "cursor:pointer", opacity: on ? 1 : 0.45 }, g);
    if (on) mk("rect", { x: -9, y: -9, width: 18, height: 18, transform: "rotate(45)", fill: "none", stroke: "#fff", "stroke-width": 2 }, eg);
    mk("rect", { x: -6, y: -6, width: 12, height: 12, transform: "rotate(45)", fill: col, stroke: "#000", "stroke-width": 1.8 }, eg);
    const t = mk("text", { x: on ? 13 : 11, y: 4.5, "font-size": on ? 14.5 : 13, "font-family": "bender, Arial, sans-serif", "font-weight": 700, fill: "#fff", stroke: "#000", "stroke-width": 3, "paint-order": "stroke" }, eg);
    t.textContent = e.n;
    mk("circle", { r: 14, fill: "transparent" }, eg);
  }
  apply();
}
function toggleExtract(name) {
  const p = prefs(app.M.key); p.extMarked = p.extMarked || {};
  if (p.extMarked[name]) delete p.extMarked[name]; else p.extMarked[name] = true;
  save(); renderExtracts(); renderPanel();
}
export function renderDraw() {
  const M = app.M, g = M.gDraw; g.innerHTML = ""; if (!prefs(M.key).drawOn) return; const P = M.proj;
  (app.S.draw[M.key] || []).forEach((s) => mk("polyline", { points: s.pts.map((q) => P.toSvg(q[0], q[1]).map((v) => v.toFixed(2)).join(",")).join(" "), fill: "none", stroke: s.c, "stroke-width": s.w * P.unit, "stroke-linecap": "round", "stroke-linejoin": "round" }, g));
}

/** Map spots for one objective on the current map. */
function spotsFor(t, o) {
  const M = app.M, k = M.key, P = M.proj, out = [];
  for (const z of o.zones) if (z.m === k) { const [x, y] = P.toSvg(z.x, z.z); out.push({ x, y, kind: "exact", f: floorBadge(M.cfg, z.x, z.y, z.z), ol: z.ol }); }
  for (const pl of o.poss) if (pl.m === k) for (const q of pl.p) { const [x, y] = P.toSvg(q[0], q[2]); out.push({ x, y, kind: "possible", f: floorBadge(M.cfg, q[0], q[1], q[2]) }); }
  if (!out.length && o.type === "extract" && objOnMap(o, k, t)) {
    const d = o.d.toLowerCase();
    for (const e of M.mapData.extracts) if (d.includes(e.n.toLowerCase())) { const [x, y] = P.toSvg(e.x, e.z); out.push({ x, y, kind: "exact", f: null }); }
    const m = o.d.match(/transit from .+? to (.+?)(?: \(|$)/i);
    if (m) for (const tr of M.mapData.transits) if (tr.n.toLowerCase() === "transit to " + m[1].toLowerCase().trim()) { const [x, y] = P.toSvg(tr.x, tr.z); out.push({ x, y, kind: "exact", f: null }); }
  }
  return out;
}
export function spotsForPart(t, p) {
  const ticks = app.S.ticks, out = [];
  for (const o of p.objs) if (!objDone(o, ticks) && objOnMap(o, app.M.key, t)) for (const s of spotsFor(t, o)) out.push({ ...s, o });
  return out;
}

function markerG(parent, it, key) {
  const g = mk("g", { class: "sc mk", "data-x": it.x, "data-y": it.y, "data-k": key, style: "cursor:pointer", opacity: it.ready === false ? 0.5 : 1 }, parent);
  const r = it.kind === "sub" ? 6.5 : 8.5;
  if (it.kind === "possible") {
    mk("path", { d: shapeD(it.icon, r), fill: "#fff", stroke: it.color, "stroke-width": 3.2 }, g);
    mk("text", { y: 3.8, "text-anchor": "middle", "font-size": 10.5, "font-weight": 700, "font-family": "bender, Arial, sans-serif", fill: "#000" }, g).textContent = "?";
  } else {
    mk("path", { d: shapeD(it.icon, r), fill: it.color, stroke: "#000", "stroke-width": 2 }, g);
    if (it.kind === "sub") mk("circle", { r: 2.3, fill: "#fff", stroke: "#000", "stroke-width": 1 }, g);
    if (it.done) mk("path", { d: "M-3.5,.5L-1,3L4,-3", fill: "none", stroke: "#fff", "stroke-width": 2.4, "stroke-linecap": "round" }, g);
  }
  if (it.f) { // floor — top right
    mk("circle", { cx: 8.5, cy: -8.5, r: 5.8, fill: "#000", stroke: "#fff", "stroke-width": 1.2 }, g);
    mk("text", { x: 8.5, y: -5.3, "text-anchor": "middle", "font-size": 9, "font-weight": 700, "font-family": "bender, Arial, sans-serif", fill: "#fff" }, g).textContent = it.f;
  }
  if (it.ready === false) { // missing something — top left
    mk("circle", { cx: -8.5, cy: -8.5, r: 5.8, fill: "#ffd43b", stroke: "#000", "stroke-width": 1.2 }, g);
    mk("text", { x: -8.5, y: -5.2, "text-anchor": "middle", "font-size": 10, "font-weight": 700, "font-family": "bender, Arial, sans-serif", fill: "#000" }, g).textContent = "!";
  }
  if (it.split) { // part of a split task — bottom right
    mk("rect", { x: 3.5, y: 3.5, width: 10, height: 10, rx: 2, fill: "#000", stroke: "#fff", "stroke-width": 1 }, g);
    mk("path", { d: "M8.5,5.5V11.5M5.8,8.5H11.2", stroke: "#fff", "stroke-width": 1.4, "stroke-dasharray": "1.6 1" }, g);
  }
  mk("circle", { r: 15, fill: "transparent" }, g);
  return g;
}

export function renderMarkers() {
  const M = app.M, S = app.S, { gMk, gZones } = M;
  gMk.innerHTML = ""; gZones.innerHTML = ""; M.idx = {};
  const items = [], subTask = new Map();
  for (const x of mapParts(M.key)) {
    if (!shownOnMap(x)) continue;
    const { task: t, part: p, cat } = x;
    if (!subTask.has(t.id)) subTask.set(t.id, x);
    for (const s of spotsForPart(t, p)) {
      const ready = objReady(s.o, S.have);
      if (s.ol) mk("polygon", { points: s.ol.map((q) => M.proj.toSvg(q[0], q[1]).map((v) => v.toFixed(2)).join(",")).join(" "), fill: cat.color, "fill-opacity": 0.13, stroke: cat.color, "stroke-width": 1.8, "stroke-dasharray": ready ? null : "4 3", "vector-effect": "non-scaling-stroke", opacity: ready ? 1 : 0.55, "pointer-events": "none" }, gZones);
      items.push({ ...s, task: t, part: p, icon: cat.icon, color: cat.color, ready, split: p.split });
    }
  }
  for (const s of S.subs) {
    if (s.map !== M.key || s.x == null) continue;
    const x = subTask.get(s.task); if (!x) continue;
    const [sx, sy] = M.proj.toSvg(s.x, s.z);
    items.push({ x: sx, y: sy, kind: "sub", f: s.f || null, task: x.task, part: x.part, sub: s, icon: x.cat.icon, color: x.cat.color, done: s.done });
  }
  const groups = {};
  for (const it of items) { const k = Math.round(it.x * 3) + "," + Math.round(it.y * 3); (groups[k] = groups[k] || []).push(it); }
  for (const g of Object.values(groups)) if (g.length > 1) g.forEach((it, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / g.length; it.ox = Math.cos(a) * 11; it.oy = Math.sin(a) * 11; });
  const isSel = (it) => M.sel === it.part.key;
  items.sort((a, b) => isSel(a) - isSel(b));
  const fx = [];
  items.forEach((it, i) => {
    const key = "m" + i; M.idx[key] = it;
    const g = markerG(gMk, it, key);
    if (it.ox) { g.dataset.ox = it.ox; g.dataset.oy = it.oy; }
    if (isSel(it)) { g.dataset.s = 1.5; fx.push({ x: it.x, y: it.y, ox: it.ox, oy: it.oy }); }
  });
  apply();
  renderFx(fx);
}

// ---------------------------------------------------------------- selection / popup
export function select(partKey, fly = true, it = null) {
  const M = app.M; if (!M) return;
  const x = mapParts(M.key).find((v) => v.part.key === partKey);
  if (!x) return;
  M.sel = partKey; M.expanded = partKey; M.pop = it || { task: x.task, part: x.part };
  renderAll();
  if (fly) {
    const spots = spotsForPart(x.task, x.part).concat(app.S.subs.filter((s) => s.task === x.task.id && s.map === M.key && s.x != null).map((s) => { const [sx, sy] = M.proj.toSvg(s.x, s.z); return { x: sx, y: sy }; }));
    if (spots.length) { const xs = spots.map((p) => p.x), ys = spots.map((p) => p.y); fitTo({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, M.home.w / 25); }
  } else {
    const el = document.querySelector(`.task[data-part="${CSS.escape(partKey)}"] .trow-wrap`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

export function reqTags(o) {
  const have = app.S.have;
  return requirementsOf(o).map((r) => {
    const ok = (have[r.key] || 0) >= 1;
    const cls = r.kind === "key" ? "key" : r.kind === "gear" ? "gear" : "place";
    const name = r.items.length === 1 ? r.items[0].name : r.items.length <= 3 ? r.items.map((i) => i.name).join(" or ") : `${r.items[0].name} or ${r.items.length - 1} others`;
    return ` <span class="tag ${cls}${ok ? "" : " miss"}" title="${esc(r.label)}${ok ? "" : " — not in your bag"}">${r.kind === "key" ? "🔑 " : r.kind === "gear" ? "🎽 " : "🎒 "}${esc(name)}${r.kind === "place" && r.need > 1 ? " ×" + r.need : ""}</span>`;
  }).join("");
}

/** One objective line with its tick control. */
export function objLine(t, o, { here = true } = {}) {
  const ticks = app.S.ticks, d = objDone(o, ticks), M = app.M;
  const k = M ? M.key : null;
  const poss = k ? o.poss.filter((p) => p.m === k).reduce((n, p) => n + p.p.length, 0) : 0;
  const ctl = isCounter(o)
    ? `<span class="ctr"><button class="ib sm" data-tick="-1" data-obj="${esc(o.id)}" title="Less">−</button><b>${tickValue(o, ticks)}/${tickTarget(o)}</b><button class="ib sm" data-tick="1" data-obj="${esc(o.id)}" title="More">+</button></span>`
    : `<input type="checkbox" data-tickbox="${esc(o.id)}" ${d ? "checked" : ""} title="Done">`;
  const miss = !d && !objReady(o, app.S.have);
  return `<li class="ob${d ? " done" : ""}${here ? "" : " away"}">${ctl}<span class="od">${esc(o.d)}</span>${o.opt ? ' <span class="tag">optional</span>' : ""}${o.fir ? ' <span class="tag fir">FIR</span>' : ""}${reqTags(o)}${o.qi && o.type !== "giveQuestItem" ? ` <span class="tag">${esc(o.qi)}</span>` : ""}${o.time ? ` <span class="tag">🕑 ${o.time[0]}:00–${o.time[1]}:00</span>` : ""}${poss ? ` <span class="tag">${poss} possible spots</span>` : ""}${o.gear && o.gear.notWearing ? ' <span class="tag">no armor/gear restriction</span>' : ""}${miss ? ' <span class="tag miss">! missing items</span>' : ""}</li>`;
}

export function partLabel(p) { return p.split ? `part ${p.index + 1} of ${p.total}: ${ACTION_LABEL[p.action]}` : ""; }

export function renderPop() {
  const M = app.M, p = $("#pop"); if (!p) return;
  const sel = M.pop && M.sel && mapParts(M.key).find((v) => v.part.key === M.sel);
  if (!sel) { p.style.display = "none"; return; }
  const { task: t, part: pt, cat } = sel, e = app.S.tasks[t.id] || {};
  p.style.setProperty("--c", cat.color); p.style.display = "block";
  const objs = pt.objs.filter((o) => objOnMap(o, M.key, t));
  p.innerHTML = `<button class="x" title="Close">×</button><h3>${esc(t.name)}</h3><div class="m">${esc(t.trader)} · ${esc(cat.name)}${pt.split ? " · " + esc(partLabel(pt)) : ""} · ${partProgress(pt, app.S.ticks)}%</div>
    <div class="popacts">${t.wiki ? `<a class="wiki" href="${esc(t.wiki)}" target="_blank" rel="noopener">📖 Wiki ↗</a>` : ""}<button class="btn sm line" data-pin="${esc(t.id)}">${e.pinned ? "📌 Unpin" : "📌 Pin"}</button></div>
    ${M.pop.sub ? `<div style="margin-bottom:6px;color:#fff">Sub-task: ${esc(M.pop.sub.text)}</div>` : ""}
    <ul class="objs">${objs.map((o) => objLine(t, o)).join("")}</ul>`;
}
function popClick(e) {
  const M = app.M;
  if (e.target.closest(".x")) { M.sel = null; M.pop = null; renderAll(); return; }
  const pin = e.target.closest("[data-pin]");
  if (pin) { const en = app.S.tasks[pin.dataset.pin]; if (en) { en.pinned = !en.pinned; save(); renderAll(); } return; }
  const tb = e.target.closest("[data-tick]");
  if (tb) tickBy(tb.dataset.obj, +tb.dataset.tick);
}
function popChange(e) { const c = e.target.closest("[data-tickbox]"); if (c) tickSet(c.dataset.tickbox, c.checked); }

const findObj = (id) => { for (const t of Object.values(app.BYID)) { const o = t.objs.find((x) => x.id === id); if (o) return o; } return null; };
let objIndex = null;
export function objById(id) {
  if (!objIndex || objIndex.data !== app.DATA) { objIndex = { data: app.DATA, map: new Map() }; for (const t of app.DATA.tasks) for (const o of t.objs) objIndex.map.set(o.id, o); }
  return objIndex.map.get(id) || findObj(id);
}
export function tickSet(id, on) { const o = objById(id); if (!o) return; setTick(o, !!on); save(); renderAll(); }
export function tickBy(id, d) { const o = objById(id); if (!o) return; setTick(o, tickValue(o, app.S.ticks) + d); save(); renderAll(); }
export { uid, mapName };
