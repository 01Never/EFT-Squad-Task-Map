// Task-list scan: capture in-game screenshots, read them with the AI, review, add (add-only), delete the shots.
import { app, save, activate, mapName } from "./store.js";
import { $, esc, toast, modal, api } from "./util.js";
import { mapsOf, isOffmapTask } from "./logic/parts.js";
import { openAIModal, openSettings } from "./settings.js";
import { rerender } from "./live.js";

export async function startScan() {
  if (!app.STATUS.ai.hasKey) { toast("Scanning reads your screenshots with OpenAI — add your key first"); openAIModal(); return; }
  if (app.capture) { renderBar(); return; }
  try { await api("/api/scan/start", { method: "POST" }); }
  catch (e) { toast(String(e.message || e)); openSettings(); return; }
  app.capture = { phase: "capture", files: [], progress: 0 };
  renderBar();
}

export function onCapture(ev) {
  if (!app.capture) return;
  if (ev.cancelled || ev.done) return;
  app.capture.files = ev.files || [];
  if (app.capture.phase === "capture") renderBar();
}

function renderBar() {
  const bar = $("#capbar"), c = app.capture;
  if (!c) { bar.hidden = true; bar.innerHTML = ""; return; }
  bar.hidden = false;
  if (c.phase === "capture") {
    bar.innerHTML = `<div class="capin"><div class="captext"><b>📷 Capturing your task list</b><span>In Tarkov, open <b>Tasks</b> and press your screenshot key on each page (scroll between shots; STORY, SIDE and OPERATIONAL tabs all work). Then come back and click Done.</span>${c.files.length ? `<span class="est">Reading costs about 1–2k input tokens per screenshot (≈${(c.files.length * 1.5).toFixed(c.files.length > 6 ? 0 : 1)}k for ${c.files.length}) on your OpenAI key.</span>` : ""}</div>
      <div class="thumbs">${c.files.map((f) => `<div class="th"><img src="/api/scan/image?name=${encodeURIComponent(f.name)}" alt="" loading="lazy"><button class="x" data-rm="${esc(f.name)}" title="Don't use this one">×</button></div>`).join("") || '<span class="none">0 captured</span>'}</div>
      <div class="capbtns"><button class="btn" id="capdone" ${c.files.length ? "" : "disabled"}>Done (${c.files.length})</button><button class="btn line" id="capcancel">Cancel</button></div></div>`;
    bar.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => api("/api/scan/remove", { method: "POST", body: { name: b.dataset.rm } }).catch(() => {})));
    $("#capdone").onclick = process;
    $("#capcancel").onclick = cancel;
  } else if (c.phase === "reading") {
    bar.innerHTML = `<div class="capin"><div class="captext"><b><span class="spin"></span>Reading ${c.files.length} screenshot${c.files.length > 1 ? "s" : ""}…</b><span>${c.progress} of ${c.files.length} done</span></div><div class="capbtns"><button class="btn line" id="capcancel">Cancel</button></div></div>`;
    $("#capcancel").onclick = cancel;
  } else bar.hidden = true;
}

async function cancel() {
  app.capture = null; renderBar();
  await api("/api/scan/cancel", { method: "POST" }).catch(() => {});
}

/** Shrink to ≤2048 px on the long edge (JPEG) before sending — keeps uploads small. */
async function toDataUrl(name) {
  const blob = await (await fetch("/api/scan/image?name=" + encodeURIComponent(name))).blob();
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close && bmp.close();
  return cv.toDataURL("image/jpeg", 0.9);
}

async function process() {
  const c = app.capture; if (!c || !c.files.length) return;
  await api("/api/scan/stop", { method: "POST" }).catch(() => {});
  c.phase = "reading"; c.progress = 0; renderBar();
  const files = c.files.slice(), results = [], errors = [];
  let i = 0;
  const worker = async () => {
    while (i < files.length) {
      const f = files[i++];
      try { const r = await api("/api/scan/read", { method: "POST", body: { image: await toDataUrl(f.name) } }); results.push(...r.rows); }
      catch (e) { errors.push(`${f.name}: ${e.message || e}`); }
      if (!app.capture) return;
      c.progress++; renderBar();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (!app.capture) return;
  review(files.map((f) => f.name), results, errors);
}

function review(names, rows, errors) {
  const S = app.S, found = new Map(), unknown = [];
  for (const r of rows) {
    const m = app.matcher.match(r.name, r.trader);
    if (!m) { if (!unknown.includes(r.name)) unknown.push(r.name); continue; }
    const prev = found.get(m.task.id);
    if (!prev || (r.progress ?? -1) > (prev.progress ?? -1)) found.set(m.task.id, { task: m.task, progress: r.progress, fixed: m.fixed ? r.name : null });
  }
  const list = [...found.values()].sort((a, b) => a.task.name.localeCompare(b.task.name));
  const fresh = list.filter((x) => !(S.tasks[x.task.id] && S.tasks[x.task.id].active));
  const already = list.filter((x) => S.tasks[x.task.id] && S.tasks[x.task.id].active);
  const perMap = {};
  for (const x of fresh) if (!isOffmapTask(x.task)) for (const m of mapsOf(x.task).map(mapName)) perMap[m] = (perMap[m] || 0) + 1;
  const onMap = fresh.filter((x) => !isOffmapTask(x.task)), offMap = fresh.filter((x) => isOffmapTask(x.task));
  const row = (x) => `<li><label><input type="checkbox" data-add="${esc(x.task.id)}" checked> ${esc(x.task.name)} <span class="tag">${esc(x.task.trader)}</span>${x.progress != null ? ` <span class="tag">${x.progress}%</span>` : ""}${x.fixed ? ` <span class="tag warnt" title="Read as “${esc(x.fixed)}”">spelling fixed</span>` : ""}</label></li>`;
  const dl = `<datalist id="fixlist">${app.DATA.tasks.map((t) => `<option value="${esc(t.name)}">`).join("")}</datalist>`;
  const { el, close } = modal(`<h3>Scan results</h3>
    <p class="mnote">Read ${rows.length} rows from ${names.length} screenshot${names.length > 1 ? "s" : ""}. New tasks are added; nothing is removed.</p>
    ${errors.length ? `<div class="err">${errors.map(esc).join("<br>")}</div>` : ""}
    <h4>New tasks (${onMap.length})</h4>${Object.keys(perMap).length ? `<p class="mnote">${Object.entries(perMap).map(([m, n]) => `${esc(m)} ${n}`).join(" · ")}</p>` : ""}
    <ul class="rlist">${onMap.map(row).join("") || '<li class="none">None</li>'}</ul>
    ${offMap.length ? `<h4>New hand-in-only tasks (${offMap.length})</h4><p class="mnote">No map objectives, so they won't show on a map. Their found-in-raid items appear in the Bring list.</p><ul class="rlist">${offMap.map(row).join("")}</ul>` : ""}
    ${already.length ? `<h4>Already on your list (${already.length})</h4><p class="mnote">${already.map((x) => esc(x.task.name)).join(", ")}</p>` : ""}
    ${unknown.length ? `<h4>Not recognised (${unknown.length})</h4><p class="mnote">Type the right name to include one, or leave it blank to skip.</p><ul class="rlist">${unknown.map((n, i) => `<li>“${esc(n)}” → <input type="search" list="fixlist" data-fix="${i}" placeholder="Task name…"></li>`).join("")}</ul>${dl}` : ""}
    <div class="row" style="margin-top:14px;justify-content:space-between"><button class="btn line" id="rvcancel">Cancel (keep screenshots)</button><button class="btn" id="rvok">Add tasks & delete ${names.length} screenshot${names.length > 1 ? "s" : ""}</button></div>`, { wide: true });
  el.querySelector("#rvcancel").onclick = () => { close(); cancel(); };
  el.querySelector("#rvok").onclick = async () => {
    let added = 0;
    for (const cb of el.querySelectorAll("[data-add]")) if (cb.checked) { const x = found.get(cb.dataset.add); if (activate(x.task.id, "scan", { gamePct: x.progress, scannedAt: Date.now() })) added++; }
    for (const inp of el.querySelectorAll("[data-fix]")) { const m = inp.value.trim() && app.matcher.match(inp.value.trim()); if (m && activate(m.task.id, "scan", { scannedAt: Date.now() })) added++; }
    for (const x of already) Object.assign(S.tasks[x.task.id], { gamePct: x.progress ?? S.tasks[x.task.id].gamePct, scannedAt: Date.now() });
    S.showScanBanner = false;
    save();
    let deleted = 0;
    try { deleted = (await api("/api/scan/confirm", { method: "POST", body: { names } })).deleted; } catch {}
    app.capture = null; renderBar(); close();
    toast(`Added ${added} task${added === 1 ? "" : "s"} · deleted ${deleted} screenshot${deleted === 1 ? "" : "s"}`);
    rerender();
  };
}
