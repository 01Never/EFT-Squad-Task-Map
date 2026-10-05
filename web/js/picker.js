// Map picker page.
import { app, activeTasks, partsFor, save } from "./store.js";
import { $, esc } from "./util.js";
import { getSvg, teardownMap } from "./map.js";
import { partOnMap, partDone, isOffmapTask, mapsOf } from "./logic/parts.js";
import { startScan } from "./scan.js";

export function showPicker() {
  teardownMap();
  const S = app.S;
  $("#crumbs").innerHTML = "Pick a map";
  const act = activeTasks();
  const counts = Object.fromEntries(app.CFG.map((c) => [c.key, act.filter((t) => partsFor(t).some((p) => partOnMap(p, c.key, t) && !partDone(p, S.ticks))).length]));
  const off = act.filter(isOffmapTask).sort((a, b) => a.name.localeCompare(b.name));
  const elsewhere = act.filter((t) => !isOffmapTask(t) && !mapsOf(t).some((m) => app.CFG.some((c) => c.key === m)));
  $("#view").innerHTML = `<div class="picker">
    <div class="phd"><div><h1>Maps</h1><p class="lede">${act.length} active task${act.length === 1 ? "" : "s"}. Pick a map.</p></div><button class="btn" id="pscan">📷 Scan tasks</button></div>
    ${S.showScanBanner ? `<div class="banner"><span style="flex:1;min-width:220px"><b>New in v2:</b> your tasks now come from your own screenshots and the game's logs. Click <b>Scan tasks</b>, open your task list in Tarkov and take a screenshot of each page. Tasks you accept or finish in-game update automatically after that.</span><button class="lnk" id="pbanner">Dismiss</button></div>` : ""}
    ${!act.length && !S.showScanBanner ? `<div class="banner"><span style="flex:1">No tasks yet. Click <b>Scan tasks</b> to read your task list from in-game screenshots, or add tasks by name on any map.</span></div>` : ""}
    <div class="grid">${app.CFG.map((c) => `<a class="card" href="#/map/${c.key}"><div class="thumb" data-svg="${esc(c.svg)}"></div><div class="meta"><b>${esc(c.name)}</b><span class="${counts[c.key] ? "has" : ""}">${counts[c.key] ? counts[c.key] + " task" + (counts[c.key] > 1 ? "s" : "") : "no tasks"}</span></div></a>`).join("")}</div>
    ${off.length || elsewhere.length ? `<details class="offmap"><summary>${off.length + elsewhere.length} active task${off.length + elsewhere.length > 1 ? "s" : ""} not shown on a map</summary><p class="mnote">Hand-ins, weapon builds and "any location" tasks have no map spot${elsewhere.length ? "; a few are on maps this app doesn't have (Labs, Labyrinth)" : ""}. Their found-in-raid items appear in every map's Bring list.</p><p>${off.concat(elsewhere).map((t) => `<span class="tag" style="margin:2px">${esc(t.name)}</span>`).join(" ")}</p></details>` : ""}
  </div>`;
  $("#pscan").onclick = startScan;
  const pb = $("#pbanner"); if (pb) pb.onclick = () => { S.showScanBanner = false; save(); showPicker(); };
  for (const el of document.querySelectorAll(".thumb[data-svg]")) {
    const cfg = app.CFG.find((c) => c.svg === el.dataset.svg);
    getSvg(el.dataset.svg).then((txt) => {
      const d = new DOMParser().parseFromString(txt, "image/svg+xml").documentElement;
      [...d.children].forEach((g) => { if (g.tagName === "g" && g.id && !(g.id === cfg.baseLayer || g.dataset.keepWithGroup)) g.remove(); });
      d.removeAttribute("width"); d.removeAttribute("height"); el.innerHTML = ""; el.appendChild(document.importNode(d, true));
    });
  }
}
