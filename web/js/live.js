// Live events from the program (game logs, GPS screenshots, scan captures). Uses Server-Sent Events:
// the connection sits idle until something happens.
import { app, save, activate, finish, prefs } from "./store.js";
import { $, toast, esc, MODE_NAME, api } from "./util.js";
import { onCapture } from "./scan.js";
import { renderAll, centerOn } from "./map.js";
import { renderPlayer, onNewPosition } from "./features/find-me/map-layer.js";
import { clearPartsCache } from "./logic/parts.js";
import { makeMatcher } from "./logic/match.js";
import { showPicker } from "./picker.js";

export function rerender() {
  renderNav();
  if (app.M) renderAll();
  else if (!location.hash.startsWith("#/map/")) showPicker();
}

export function indexData() {
  app.BYID = {};
  for (const t of app.DATA.tasks) app.BYID[t.id] = t;
  app.matcher = makeMatcher(app.DATA.tasks);
  clearPartsCache();
}
export async function reloadData() {
  app.DATA = await (await fetch("/api/data")).json();
  app.STATUS = await (await fetch("/api/status")).json();
  indexData(); rerender();
}

export function renderNav() {
  const st = app.STATUS;
  const raid = st.raid.active ? `<span class="raid">● In raid${st.raid.map ? `<span class="hm">: ${esc(nameOf(st.raid.map))}</span>` : ""}</span>` : "";
  const warn = app.modePrompt ? `<span class="modewarn"><span class="hm">Game says </span>${esc(MODE_NAME[app.modePrompt])} · <button class="lnk" id="modeSwitch">Switch data</button> <button class="lnk" id="modeNo">Not now</button></span>` : "";
  $("#navinfo").innerHTML = warn + raid + `<span class="dd">${esc(MODE_NAME[st.data.mode] || st.data.mode)} data${st.data.origin === "built-in" ? " (built-in)" : ""}</span>`;
  const sw = $("#modeSwitch");
  if (sw) {
    sw.onclick = async () => { const m = app.modePrompt; app.modePrompt = null; try { const r = await api("/api/settings", { method: "PUT", body: { gameMode: m } }); app.STATUS = r.status; toast(`Switched to ${MODE_NAME[m]} data`); } catch (e) { toast(String(e.message || e)); } renderNav(); };
    $("#modeNo").onclick = () => { app.modeDismissed = app.modePrompt; app.modePrompt = null; renderNav(); };
  }
}
const nameOf = (k) => (app.CFG.find((m) => m.key === k) || {}).name || k;

let ackTimer = null, ackUpTo = 0;
function ack(id) { ackUpTo = Math.max(ackUpTo, id); clearTimeout(ackTimer); ackTimer = setTimeout(() => api("/api/events/ack", { method: "POST", body: { upTo: ackUpTo } }).catch(() => {}), 300); }

function follow(map) {
  if (!app.STATUS.settings.followPosition || !map || !app.CFG.some((c) => c.key === map)) return false;
  if (!app.M || app.M.key !== map) { location.hash = "#/map/" + map; return true; }
  return false;
}

function handle(ev) {
  const S = app.S;
  switch (ev.type) {
    case "task": {
      const t = app.BYID[ev.taskId];
      if (t) {
        if (ev.status === "started") { if (activate(ev.taskId, "log")) toast(`Added from the game: ${t.name}`); }
        else finish(ev.taskId); // finished / failed: quietly
        save(); rerender();
      }
      break;
    }
    case "raidEnd": {
      S.have = {}; S.used = {};
      for (const k of Object.keys(S.prefs)) prefs(k).extMarked = {};
      app.gps = null; app.trail = [];
      app.STATUS.raid = { ...app.STATUS.raid, active: false, map: null };
      save(); rerender();
      toast(`Raid over: bag counts and extract marks reset${ev.deleted ? `, ${ev.deleted} GPS screenshot${ev.deleted > 1 ? "s" : ""} deleted` : ""}`);
      break;
    }
    case "raidStart": app.trail = []; app.STATUS.raid = { ...app.STATUS.raid, active: true, map: ev.map }; renderNav(); follow(ev.map); break;
    case "raidMap": app.STATUS.raid = { ...app.STATUS.raid, map: ev.map }; renderNav(); break;
    case "gps": {
      app.gps = ev.gps; app.trail = ev.trail || [];
      onNewPosition(); // ticket 01: a new position pulses for ~20 s
      if (follow(ev.gps.map)) break;
      if (app.M && (!ev.gps.map || ev.gps.map === app.M.key)) { renderPlayer(); if (app.STATUS.settings.followPosition) centerOn(ev.gps, true); }
      break;
    }
    case "capture": onCapture(ev); break;
    case "data": reloadData(); break;
    case "mode":
      app.STATUS.raid = { ...app.STATUS.raid, sessionMode: ev.mode };
      if (ev.mode !== app.STATUS.settings.gameMode && app.modeDismissed !== ev.mode) { app.modePrompt = ev.mode; renderNav(); }
      break;
    case "keybind": app.STATUS.keybind = { ok: ev.ok, warning: ev.warning }; if (!ev.ok) toast(ev.warning); break;
  }
  if (ev.id) ack(ev.id);
}

export function connectLive() {
  const es = new EventSource("/api/events");
  es.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch (e) { console.error(e); } };
  es.onopen = () => { $("#conn").hidden = true; };
  es.onerror = () => { $("#conn").hidden = false; };
}
