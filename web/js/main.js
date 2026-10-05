// Boot + routing.
import { app, flush } from "./store.js";
import { $, esc } from "./util.js";
import { migrate } from "./logic/state.js";
import { openMap } from "./map.js";
import { showPicker } from "./picker.js";
import { connectLive, indexData, renderNav, rerender } from "./live.js";
import { openSettings } from "./settings.js";

function route() {
  const m = location.hash.match(/^#\/map\/([\w-]+)/);
  if (m && app.CFG.some((c) => c.key === m[1])) openMap(m[1]);
  else showPicker();
}
addEventListener("hashchange", route);
// keep the "x min ago" GPS label honest without a timer: refresh when you come back to the tab
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && app.S) rerender(); else flush(); });

(async () => {
  try {
    const [cfg, data, status, state] = await Promise.all(["/api/config", "/api/data", "/api/status", "/api/state"].map((u) => fetch(u).then((r) => r.json())));
    app.CFG = cfg; app.DATA = data; app.STATUS = status;
    app.gps = status.gps; app.trail = status.trail || [];
    const wasV1 = state && state.version !== 2;
    app.S = migrate(state);
    indexData();
    if (wasV1) { await fetch("/api/state", { method: "PUT", body: JSON.stringify(app.S) }); }
    $("#saved").textContent = state ? "Saved ✓" : "";
    $("#settings").onclick = openSettings;
    renderNav(); connectLive(); route();
  } catch (e) {
    $("#view").innerHTML = `<div class="picker"><h1>Couldn't start</h1><p>${esc(e.message || e)}</p><p>Is the Squad Task Map program still running?</p></div>`;
  }
})();
