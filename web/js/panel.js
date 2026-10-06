// The right-hand panel: Tasks tab (categories → parts) and Bring list tab.
import { app, prefs, save, entry, activate, partsFor, catOf, offmapActive, mapName } from "./store.js";
import { $, esc, uid, toast, swatch, SHAPES, ICON } from "./util.js";
import { mapParts, shownOnMap, select, renderAll, renderExtracts, renderLabels, setMode, objLine, partLabel, extractList, EXT_COLORS, tickSet, tickBy, setPanelHidden } from "./map.js";
import { mapsOf, objOnMap, partProgress, canSplit, ACTION_LABEL } from "./logic/parts.js";
import { partReady, bringList, requirementsOf } from "./logic/ready.js";
import { ensureDefaults, isManual } from "./logic/state.js";
import { renderAI, aiAction, aiKeydown } from "./ai.js";
import { startScan } from "./scan.js";

const sortName = (a, b) => a.task.name.replace(/^The /, "").localeCompare(b.task.name.replace(/^The /, "")) || a.part.index - b.part.index;

// ---------------------------------------------------------------- rows
function keyCount(t, p) {
  const k = app.M.key, ids = new Set();
  for (const o of p.objs) if (objOnMap(o, k, t)) for (const r of requirementsOf(o)) if (r.kind === "key") ids.add(r.key);
  return ids.size;
}
function partRow(x) {
  const M = app.M, S = app.S, { task: t, part: p, cat } = x;
  const open = M.expanded === p.key, sel = M.sel === p.key, e = S.tasks[t.id] || {};
  const also = mapsOf(t).filter((m) => m !== M.key).map(mapName);
  const keys = keyCount(t, p), ready = x.done || partReady(p, S.ticks, S.have);
  let h = `<div class="task${sel ? " sel" : ""}${x.done ? " isdone" : ""}" data-part="${esc(p.key)}" data-task="${esc(t.id)}">
    <div class="trow-wrap"><button class="trow" data-act="open">${swatch(cat.icon, cat.color, 15)}<span class="nm">${esc(t.name)}${p.split ? ` <span class="partof" title="This task is split; this row is one part of it">◫ part ${p.index + 1}/${p.total}</span>` : ""}<span class="tr">${esc(t.trader)}${p.split ? " · " + esc(ACTION_LABEL[p.action]) : ""}${also.length ? " · also " + esc(also.join(", ")) : ""}</span></span>${!ready ? '<span class="bang" title="You don\'t have everything this needs">!</span>' : ""}${keys ? `<span class="kb" title="Keys needed">🔑 ${keys}</span>` : ""}<span class="pct">${x.done ? "✓" : partProgress(p, S.ticks) + "%"}</span></button><button class="ib pinb${e.pinned ? " on" : ""}" data-act="pin" title="${e.pinned ? "Unpin" : "Pin"}">📌</button></div>`;
  if (open) h += partBody(x);
  return h + "</div>";
}

function partBody(x) {
  const M = app.M, S = app.S, { task: t, part: p, cat } = x, e = S.tasks[t.id] || {};
  const here = p.objs.filter((o) => objOnMap(o, M.key, t)), away = p.objs.filter((o) => !objOnMap(o, M.key, t));
  const others = p.split ? partsFor(t).filter((q) => q.key !== p.key) : [];
  const also = mapsOf(t).filter((m) => m !== M.key).map(mapName);
  const subs = S.subs.filter((s) => s.task === t.id);
  return `<div class="tbody">
    <div class="tb-top">${t.wiki ? `<a class="wiki" href="${esc(t.wiki)}" target="_blank" rel="noopener">📖 Wiki: ${esc(t.name)} ↗</a>` : ""}${e.gamePct != null ? `<span class="meta">in-game ${e.gamePct}%</span>` : ""}</div>
    ${p.split ? `<div class="meta">This task is split by kind of work. This row is <b>${esc(partLabel(p))}</b>. Other parts: ${others.map((q) => { const c = catOf(t, q); return `<button class="pchip" data-goto="${esc(q.key)}" style="--pc:${c.color}">${esc(ACTION_LABEL[q.action])} → ${esc(c.name)}</button>`; }).join(" ")}</div>` : ""}
    ${also.length ? `<div class="meta">Also on ${esc(also.join(", "))}; objectives elsewhere are greyed out.</div>` : ""}
    <ul class="objs">${here.map((o) => objLine(t, o)).join("")}${away.map((o) => objLine(t, o, { here: false })).join("")}</ul>
    <div class="subs"><h5>Sub-tasks</h5>${subs.map(subRow).join("")}
      <div class="addsub"><input type="text" placeholder="Add a sub-task…" data-addsub="${esc(t.id)}" maxlength="140"><button class="btn sm" data-act="addsub">Add</button></div></div>
    <div class="acts">Move ${p.split ? "this part" : ""} to <select data-move="${esc(p.key)}">${S.cats.map((c) => `<option value="${esc(c.id)}" ${c.id === cat.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
      ${isManual(S, t, p) ? `<button class="lnk" data-act="unmove" title="Put it back in its default category">reset</button>` : ""}
      ${canSplit(t) ? `<label class="chk"><input type="checkbox" data-nosplit="${esc(t.id)}" ${e.noSplit ? "checked" : ""}> Don't split</label>` : ""}
      <button class="btn sm danger" data-act="remove" style="margin-left:auto" title="Take this task off your list">Remove task</button></div>
  </div>`;
}

function subRow(s) {
  const M = app.M, onThis = s.map === M.key && s.x != null, elsewhere = s.x != null && s.map !== M.key;
  return `<div class="sub${s.done ? " done" : ""}" data-sub="${s.id}"><input type="checkbox" ${s.done ? "checked" : ""} data-act="subdone" title="Done"><span class="t">${esc(s.text)}${elsewhere ? ` <span class="tag">pinned on ${esc(mapName(s.map))}</span>` : ""}</span>
  <select data-subfloor title="Floor badge for this marker">${["", "2", "3", "4", "5", "B"].map((f) => `<option value="${f}" ${(s.f || "") === f ? "selected" : ""}>${f || "G"}</option>`).join("")}</select>
  <button class="btn sm line" data-act="place">${onThis ? "Move pin" : "Pin"}</button>${onThis ? '<button class="ib" data-act="unpinsub" title="Remove marker">⌫</button>' : ""}<button class="ib" data-act="delsub" title="Delete sub-task">✕</button></div>`;
}

function catBlock(c, rows) {
  const S = app.S, M = app.M, col = S.collapsed[c.id], i = S.cats.indexOf(c);
  const live = rows.filter((x) => !x.done && (!S.pinnedOnly || x.pinned)).sort(sortName);
  const fin = rows.filter((x) => x.done).sort(sortName);
  const partial = live.filter((x) => x.part.split).length;
  let h = `<div class="cat${c.visible ? "" : " hidden"}" data-cat="${esc(c.id)}"><div class="cathead" style="--cc:${c.color}"><button class="tog" data-act="togcat" title="Show / hide these markers">${swatch(c.icon, c.color, 18)}<span class="name">${esc(c.name)}</span><span class="cnt">${live.length}${partial ? ` (${partial} partial)` : ""}</span><span class="eye">${c.visible ? "on map" : "hidden"}</span></button>
    <button class="ib" data-act="collapse" title="Collapse list">${col ? "▸" : "▾"}</button><button class="ib" data-act="menu" title="Edit category">⋯</button></div>`;
  if (M.menu === c.id) h += `<div class="catmenu"><label>Name <input type="text" data-catname value="${esc(c.name)}" maxlength="40" style="flex:1"></label>
    <label>Colour <input type="color" data-catcolor value="${c.color}"></label>
    <label>Marker <span class="shapes">${SHAPES.map((sh) => `<button data-shape="${sh}" aria-pressed="${sh === c.icon}" title="${sh}">${swatch(sh, c.color, 18)}</button>`).join("")}</span></label>
    <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm line" data-act="up" ${i === 0 ? "disabled" : ""}>Move up</button><button class="btn sm line" data-act="down" ${i === S.cats.length - 1 ? "disabled" : ""}>Move down</button>${c.builtin === "unsorted" ? "" : '<button class="btn sm danger" data-act="delcat">Delete</button>'}<button class="btn sm" data-act="menu" style="margin-left:auto">Done</button></div></div>`;
  if (!col) {
    h += `<div class="tasks">${live.map(partRow).join("") || '<div class="empty">Nothing here</div>'}`;
    if (fin.length) h += `<details class="donelist"${M.openDone === c.id ? " open" : ""} data-done="${esc(c.id)}"><summary>Done (${fin.length})</summary>${fin.map(partRow).join("")}</details>`;
    h += "</div>";
  }
  return h + "</div>";
}

// ---------------------------------------------------------------- bring list
function bringData() {
  const M = app.M, S = app.S, k = M.key;
  const vis = mapParts(k).filter(shownOnMap);
  const entries = [];
  for (const x of vis) for (const o of x.part.objs) if (objOnMap(o, k, x.task)) entries.push({ task: x.task, o });
  const firTasks = [...new Map([...vis.map((x) => [x.task.id, x.task]), ...offmapActive().map((t) => [t.id, t])]).values()];
  return bringList(entries, S.ticks, S.have, firTasks);
}
function bringLine(e, withHave = true) {
  const img = e.items.length === 1 && /^[0-9a-f]{24}$/.test(e.items[0].id) ? `<img src="${ICON(e.items[0].id)}" alt="" loading="lazy" onerror="this.remove()">` : `<span class="noimg">${e.kind === "key" ? "🔑" : e.kind === "gear" ? "🎽" : e.kind === "fir" ? "🔍" : "🎒"}</span>`;
  const short = e.have < 1 && withHave;
  return `<div class="bl${short ? " short" : ""}" data-key="${esc(e.key)}">${img}<div class="bn"><b>${esc(e.name)}</b><span class="bt">${e.label ? esc(e.label) + " · " : ""}${e.fir ? "found in raid · " : ""}${e.by.map(([n, c]) => `${esc(n)}${c > 1 || e.kind === "place" || e.kind === "fir" ? " " + c : ""}`).join(", ")}</span></div>
    <span class="need">need ${e.need}</span>${withHave ? `<span class="have"><button class="ib sm" data-have="-1">−</button><input type="number" min="0" max="999" value="${e.have}" data-haveset><button class="ib sm" data-have="1">+</button></span>` : ""}</div>`;
}
function bringTab() {
  const b = bringData(), S = app.S;
  const sec = (title, list, note, withHave = true) => list.length ? `<div class="bsec"><h4>${title} <small>${list.length}</small></h4>${note ? `<p class="bnote">${note}</p>` : ""}${list.map((e) => bringLine(e, withHave)).join("")}</div>` : "";
  const missing = [...b.keys, ...b.place, ...b.gear].filter((e) => e.have < 1).length;
  const any = b.keys.length + b.place.length + b.gear.length + b.fir.length;
  return `<div class="bring">
    <div class="bhead"><span>${missing ? `<b class="warnc">${missing} missing</b> for what's shown on the map` : any ? "You have everything for what's shown on the map." : "Nothing needed for what's shown."}</span><button class="btn sm line" data-act="resethave">Reset counts</button></div>
    <p class="bnote">Set how many of each you're carrying. A task shows <b>!</b> and fades on the map when you have none of something it needs. Counts reset after each raid; placing a marker or item (ticking it) takes one off.</p>
    ${sec("Keys", b.keys)}${sec("Items to place", b.place)}${sec("Gear to wear / use", b.gear)}${sec("Find in raid", b.fir, "For hand-ins — includes your tasks that aren't tied to a map.", false)}
    ${S.pinnedOnly ? '<p class="bnote">Showing pinned tasks only.</p>' : ""}</div>`;
}

// ---------------------------------------------------------------- panel
export function renderPanel() {
  const panel = $("#panel"); if (!panel || !app.M) return;
  const M = app.M, S = app.S, k = M.key, p = prefs(k);
  const rows = mapParts(k);
  const nTasks = new Set(rows.filter((x) => !x.done).map((x) => x.task.id)).size;
  const pins = Object.values(S.tasks).filter((e) => e.active && e.pinned).length;
  const st = panel.scrollTop;
  const tab = S.panelTab === "bring" ? "bring" : "tasks";
  const b = tab === "tasks" ? null : null;
  const bringMissing = (() => { try { const d = bringData(); return [...d.keys, ...d.place, ...d.gear].filter((e) => e.have < 1).length; } catch { return 0; } })();
  let h = `<div class="phead"><h2>${esc(M.cfg.name)} <span class="hr"><small>${nTasks} task${nTasks === 1 ? "" : "s"}</small><button class="btn sm line hidep" data-act="hidepanel" title="Hide the task list to give the map the whole window">Hide ▸</button></span></h2>
    <div class="row"><button class="btn" data-act="scan" title="Read your task list from in-game screenshots">📷 Scan tasks</button><input type="search" id="addtask" list="alltasks" placeholder="Add a task by name…" autocomplete="off"><datalist id="alltasks">${app.DATA.tasks.filter((t) => !(S.tasks[t.id] && S.tasks[t.id].active)).map((t) => `<option value="${esc(t.name)}">`).join("")}</datalist></div>
    ${S.showScanBanner ? `<div class="banner sm">Your saved tasks were carried over from the old version. <b>Scan your task list</b> to load exactly what you have now. <button class="lnk" data-act="hidebanner">Dismiss</button></div>` : ""}
    <div class="tabs"><button data-tab="tasks" aria-pressed="${tab === "tasks"}">Tasks</button><button data-tab="bring" aria-pressed="${tab === "bring"}">Bring list${bringMissing ? ` <span class="bang">${bringMissing}</span>` : ""}</button></div></div>`;
  void b;
  if (tab === "bring") h += bringTab();
  else {
    h += `<div class="sec tools"><button class="chip" data-act="pinnedonly" aria-pressed="${!!S.pinnedOnly}">📌 Pinned only${pins ? ` <span class="n">${pins}</span>` : ""}</button>
      ${pins ? '<button class="lnk" data-act="clearpins">Clear pins</button>' : ""}
      <details class="menu"><summary class="chip">⇅ Auto-sort</summary><div class="menubox"><button class="lnk" data-act="autosort">Auto-sort<br><small>Put parts you haven't moved into the default categories (re-creates any you deleted)</small></button><button class="lnk" data-act="resortall">Re-sort everything…<br><small>Also undoes your manual moves and AI choices</small></button></div></details></div>`;
    h += renderAI();
    const counts = { pmc: 0, scav: 0, shared: 0, transit: 0 };
    for (const e of extractList()) counts[e.k]++;
    const nMarked = Object.keys(p.extMarked || {}).length;
    h += `<div class="sec"><h4>Extracts & labels</h4><div class="chips">${[["pmc", "PMC"], ["scav", "Scav"], ["shared", "Shared"], ["transit", "Transits"]].map(([f, n]) => `<button class="chip" data-ext="${f}" aria-pressed="${p.ext[f]}"><span class="dia" style="background:${EXT_COLORS[f]}"></span>${n}<span class="n">${counts[f]}</span></button>`).join("")}<button class="chip" data-act="labels" aria-pressed="${p.labels}">Place names</button></div>
      <p class="bnote">Click an extract on the map to mark it as one you have (solid). After each GPS screenshot the closest marked one is highlighted; with none marked, the closest shown one (transits count only when marked). Marks clear after each raid.${nMarked ? ` <button class="lnk" data-act="clearext">Clear ${nMarked} marked</button>` : ""}</p></div>`;
    const byCat = new Map(S.cats.map((c) => [c.id, []]));
    for (const x of rows) (byCat.get(x.cat.id) || byCat.get("unsorted") || []).push(x);
    for (const c of S.cats) h += catBlock(c, byCat.get(c.id) || []);
    h += `<div class="newcat"><input type="text" id="newcat" placeholder="New category name…" maxlength="40"><button class="btn" data-act="newcat">+ Category</button></div>`;
  }
  h += `<footer class="pf">Saved to <code>${esc(app.STATUS.statePath)}</code><br>Map art: Shebuka et al., <a href="https://github.com/the-hideout/tarkov-dev-svg-maps" target="_blank" rel="noopener">tarkov-dev-svg-maps</a> (CC BY-NC-SA 4.0). Task data, projection and styling after <a href="https://tarkov.dev" target="_blank" rel="noopener">tarkov.dev</a>. Not affiliated with Battlestate Games.</footer>`;
  panel.innerHTML = h;
  panel.scrollTop = st;
}

// ---------------------------------------------------------------- events
function snapshotCats() { return JSON.stringify({ cats: app.S.cats, pc: Object.fromEntries(Object.entries(app.S.tasks).map(([id, e]) => [id, e.partCats])) }); }
function restoreCats(snap) { const o = JSON.parse(snap); app.S.cats = o.cats; for (const [id, pc] of Object.entries(o.pc)) if (app.S.tasks[id]) app.S.tasks[id].partCats = pc; save(); renderAll(); }

export function bindPanel() {
  const panel = $("#panel"), S = app.S;
  panel.addEventListener("click", (e) => {
    if (aiAction(e)) return;
    const b = e.target.closest("[data-act],[data-ext],[data-shape],[data-tab],[data-goto],[data-have],[data-tick]");
    if (!b) return;
    const M = app.M, cat = b.closest(".cat"), task = b.closest(".task"), sub = b.closest("[data-sub]");
    const c = cat && S.cats.find((x) => x.id === cat.dataset.cat), act = b.dataset.act;
    if (b.dataset.tab) { S.panelTab = b.dataset.tab; save(); renderPanel(); return; }
    if (b.dataset.ext) { const p = prefs(M.key); p.ext[b.dataset.ext] = !p.ext[b.dataset.ext]; save(); renderPanel(); renderExtracts(); return; }
    if (b.dataset.shape) { c.icon = b.dataset.shape; save(); renderAll(); return; }
    if (b.dataset.goto) { const x = mapParts(M.key).find((v) => v.part.key === b.dataset.goto); if (x) select(b.dataset.goto, true); else toast("That part isn't on this map"); return; }
    if (b.dataset.tick) { tickBy(b.dataset.obj, +b.dataset.tick); return; }
    if (b.dataset.have) { const row = b.closest("[data-key]"); const k = row.dataset.key; S.have[k] = Math.max(0, (S.have[k] || 0) + +b.dataset.have); if (!S.have[k]) delete S.have[k]; save(); renderAll(); return; }
    switch (act) {
      case "scan": startScan(); break;
      case "hidepanel": setPanelHidden(true); break;
      case "hidebanner": S.showScanBanner = false; save(); renderPanel(); break;
      case "pinnedonly": S.pinnedOnly = !S.pinnedOnly; save(); renderAll(); break;
      case "clearpins": for (const en of Object.values(S.tasks)) en.pinned = false; save(); renderAll(); break;
      case "pin": { const en = entry(task.dataset.task); en.pinned = !en.pinned; save(); renderAll(); break; }
      case "autosort": {
        b.closest("details").open = false;
        const snap = snapshotCats(), before = mapParts(M.key).map((x) => x.cat.id).join();
        const added = ensureDefaults(S);
        const after = mapParts(M.key).map((x) => x.cat.id).join();
        save(); renderAll();
        if (!added && before === after) toast("Everything you haven't moved is already in its default category");
        else toast(added ? `Re-created ${added} default categor${added > 1 ? "ies" : "y"}` : "Sorted", { label: "Undo", run: () => restoreCats(snap) });
        break;
      }
      case "resortall": {
        b.closest("details").open = false;
        if (!confirm("Put every part back into its default category? This also undoes your manual moves and AI choices (you can undo right after).")) break;
        const snap = snapshotCats();
        ensureDefaults(S);
        for (const en of Object.values(S.tasks)) en.partCats = {};
        save(); renderAll(); toast("Re-sorted everything", { label: "Undo", run: () => restoreCats(snap) });
        break;
      }
      case "resethave": S.have = {}; S.used = {}; save(); renderAll(); break;
      case "clearext": prefs(M.key).extMarked = {}; save(); renderAll(); break;
      case "labels": prefs(M.key).labels = !prefs(M.key).labels; save(); renderPanel(); renderLabels(); break;
      case "togcat": c.visible = !c.visible; save(); renderAll(); break;
      case "collapse": S.collapsed[c.id] = !S.collapsed[c.id]; save(); renderPanel(); break;
      case "menu": M.menu = M.menu === c.id ? null : c.id; renderPanel(); break;
      case "up": case "down": { const i = S.cats.indexOf(c), j = act === "up" ? i - 1 : i + 1; [S.cats[i], S.cats[j]] = [S.cats[j], S.cats[i]]; save(); renderPanel(); break; }
      case "delcat": {
        if (!confirm(`Delete “${c.name}”? Its tasks go back to their default categories (or Unsorted).`)) break;
        for (const en of Object.values(S.tasks)) for (const [k, v] of Object.entries(en.partCats || {})) if (v.cat === c.id) delete en.partCats[k];
        S.cats = S.cats.filter((x) => x !== c); M.menu = null; save(); renderAll(); break;
      }
      case "newcat": {
        const inp = $("#newcat"), n = inp.value.trim(); if (!n) break;
        const pal = ["#f783ac", "#ff922b", "#66d9e8", "#a9e34b", "#e599f7", "#ffe084", "#4dabf7"];
        const at = S.cats.findIndex((x) => x.builtin === "unsorted");
        S.cats.splice(at < 0 ? S.cats.length : at, 0, { id: "c" + uid(), name: n, color: pal[S.cats.length % pal.length], icon: SHAPES[S.cats.length % SHAPES.length], visible: true, builtin: null });
        save(); renderPanel(); toast(`Added “${n}” — move parts into it with “Move to”`); break;
      }
      case "open": { const k = task.dataset.part; if (M.expanded === k) { M.expanded = null; M.sel = null; M.pop = null; renderAll(); } else select(k, true); break; }
      case "unmove": { const en = entry(task.dataset.task); delete en.partCats[task.dataset.part]; delete en.partCats["*"]; save(); renderAll(); break; }
      case "remove": {
        const id = task.dataset.task, t = app.BYID[id];
        if (!confirm(`Take “${t.name}” off your list? (A scan or accepting it in-game brings it back.)`)) break;
        S.tasks[id].active = false; S.tasks[id].pinned = false; M.sel = M.expanded = null; M.pop = null; save(); renderAll(); break;
      }
      case "addsub": { const inp = task.querySelector("[data-addsub]"), txt = inp.value.trim(); if (!txt) break; S.subs.push({ id: uid(), task: task.dataset.task, text: txt, done: false, map: null, x: null, z: null, f: "" }); save(); renderPanel(); panel.querySelector(`[data-addsub="${CSS.escape(task.dataset.task)}"]`)?.focus(); break; }
      case "subdone": { const s = S.subs.find((q) => q.id === sub.dataset.sub); s.done = b.checked; save(); renderAll(); break; }
      case "delsub": S.subs = S.subs.filter((q) => q.id !== sub.dataset.sub); save(); renderAll(); break;
      case "unpinsub": { const s = S.subs.find((q) => q.id === sub.dataset.sub); s.x = s.z = null; s.map = null; save(); renderAll(); break; }
      case "place": M.placing = sub.dataset.sub; setMode("place"); if (matchMedia("(max-width:860px)").matches) scrollTo({ top: 0, behavior: "smooth" }); break;
    }
  });
  panel.addEventListener("toggle", (e) => { const d = e.target.closest && e.target.closest("[data-done]"); if (d) app.M.openDone = d.open ? d.dataset.done : null; }, true);
  panel.addEventListener("change", (e) => {
    const t = e.target, M = app.M;
    if (t.dataset.tickbox) { tickSet(t.dataset.tickbox, t.checked); return; }
    if (t.dataset.move) {
      const [tid] = t.dataset.move.split(":");
      const en = entry(tid); en.partCats = en.partCats || {};
      const part = partsFor(app.BYID[tid]).find((q) => q.key === t.dataset.move);
      if (part && !part.split) delete en.partCats["*"];
      en.partCats[t.dataset.move] = { cat: t.value, manual: true };
      save(); renderAll(); return;
    }
    if (t.dataset.nosplit) { const en = entry(t.dataset.nosplit); en.noSplit = t.checked; M.expanded = M.sel = null; M.pop = null; save(); renderAll(); return; }
    if (t.hasAttribute("data-haveset")) { const k = t.closest("[data-key]").dataset.key; const v = Math.max(0, Math.round(+t.value || 0)); if (v) S.have[k] = v; else delete S.have[k]; save(); renderAll(); return; }
    if (t.hasAttribute("data-subfloor")) { const s = S.subs.find((q) => q.id === t.closest("[data-sub]").dataset.sub); s.f = t.value; save(); renderAll(); return; }
    if (t.hasAttribute("data-catcolor")) { S.cats.find((x) => x.id === t.closest(".cat").dataset.cat).color = t.value; save(); renderAll(); return; }
    if (t.id === "addtask") addByName(t.value);
    if (t.id === "aiscope") { M.aiScope = t.value; }
  });
  panel.addEventListener("input", (e) => {
    if (e.target.hasAttribute("data-catname")) { const c = S.cats.find((x) => x.id === e.target.closest(".cat").dataset.cat); c.name = e.target.value || "Untitled"; save(); e.target.closest(".cat").querySelector(".tog .name").textContent = c.name; }
  });
  panel.addEventListener("keydown", (e) => {
    if (aiKeydown(e)) return;
    if (e.key !== "Enter") return;
    const t = e.target;
    if (t.dataset.addsub !== undefined) t.closest(".task").querySelector('[data-act="addsub"]').click();
    if (t.id === "newcat") panel.querySelector('[data-act="newcat"]').click();
    if (t.id === "addtask") addByName(t.value);
  });
}

function addByName(v) {
  const name = String(v || "").trim(); if (!name) return;
  const m = app.matcher.match(name);
  if (!m) { toast(`No task called “${name}”`); return; }
  const t = m.task;
  if (app.S.tasks[t.id] && app.S.tasks[t.id].active) { toast(`“${t.name}” is already on your list`); return; }
  activate(t.id, "manual"); save();
  const onHere = mapParts(app.M.key).some((x) => x.task.id === t.id);
  renderAll();
  toast(onHere ? `Added “${t.name}”` : `Added “${t.name}” — it's on ${mapsOf(t).map(mapName).join(", ") || "no map (hand-in / build)"}`);
  const inp = $("#addtask"); if (inp) inp.value = "";
}
