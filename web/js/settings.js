// Settings modal (game mode, folders, follow position, data) and the OpenAI key modal.
import { app } from "./store.js";
import { esc, toast, modal, api, ago, MODE_NAME } from "./util.js";
import { rerender, reloadData } from "./live.js";

export function openSettings() {
  const st = app.STATUS, s = st.settings, d = st.data;
  const okb = (o) => (o.ok ? '<span class="ok">✓ ' : '<span class="bad">✗ ') + esc(o.ok ? o.dir || "" : o.message) + "</span>";
  const { el, close } = modal(`<h3>Settings</h3>
    <label class="frow"><span>Game mode</span><select id="sMode">${Object.entries(MODE_NAME).map(([k, n]) => `<option value="${k}" ${s.gameMode === k ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <p class="mnote">Which task data to use, and which game sessions' log events count. ${st.raid.sessionMode && st.raid.sessionMode !== s.gameMode ? `<b class="warnc">The game says you're playing ${esc(MODE_NAME[st.raid.sessionMode])}.</b>` : ""}</p>
    <label class="frow"><span>Game logs folder</span><input type="text" id="sLogs" value="${esc(s.logsPath)}" placeholder="Found automatically — or paste e.g. C:\\Battlestate Games\\EFT\\Logs"></label>
    <p class="mnote">${okb(st.logs)}</p>
    <label class="frow"><span>Screenshots folder</span><input type="text" id="sShots" value="${esc(s.screenshotsPath)}" placeholder="Found automatically — Documents\\Escape From Tarkov\\Screenshots"></label>
    <p class="mnote">${okb(st.screenshots)}${st.keybind && !st.keybind.ok ? `<br><b class="warnc">${esc(st.keybind.warning)}</b>` : ""}</p>
    <label class="chk frow"><input type="checkbox" id="sFollow" ${s.followPosition ? "checked" : ""}> Follow my position (switch to the raid's map when a GPS screenshot comes in)</label>
    <label class="chk frow"><input type="checkbox" id="sCenter" ${s.autoCenter ? "checked" : ""}> Center the map on me when I take a screenshot (keeps your zoom; same as ◎ Follow on the map)</label>
    <h4>Game data</h4>
    <p class="mnote">${esc(MODE_NAME[d.mode] || d.mode)} · ${d.tasks} tasks · ${d.origin === "live" ? "downloaded " + ago(d.fetchedAt) : d.origin === "cache" ? "saved copy from " + ago(d.fetchedAt) : "built-in copy" + (d.generated ? " (" + esc(String(d.generated).slice(0, 10)) + ")" : "")}${d.error ? `<br><span class="bad">Last update failed: ${esc(d.error)}</span>` : ""}</p>
    <button class="btn sm line" id="sRefresh">${d.refreshing ? "Updating…" : "Update game data now"}</button>
    <h4>OpenAI</h4><p class="mnote">${st.ai.hasKey ? `Key ${esc(st.ai.key)} · ${esc(st.ai.model)}${st.ai.effort ? " · " + esc(st.ai.effort) : ""}` : "No key yet — needed for Scan tasks and AI Categorize."} <button class="lnk" id="sAI">Change</button></p>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn line" id="sClose">Close</button><button class="btn" id="sSave">Save</button></div>`);
  el.querySelector("#sClose").onclick = close;
  el.querySelector("#sAI").onclick = () => { close(); openAIModal(); };
  el.querySelector("#sRefresh").onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = "Updating…";
    try { const r = await api("/api/data/refresh", { method: "POST" }); toast(`Game data updated: ${r.tasks} tasks`); await reloadData(); close(); }
    catch (err) { toast("Update failed — " + String(err.message || err).slice(0, 120)); e.target.disabled = false; e.target.textContent = "Update game data now"; }
  };
  el.querySelector("#sSave").onclick = async () => {
    try {
      const r = await api("/api/settings", { method: "PUT", body: { gameMode: el.querySelector("#sMode").value, logsPath: el.querySelector("#sLogs").value, screenshotsPath: el.querySelector("#sShots").value, followPosition: el.querySelector("#sFollow").checked, autoCenter: el.querySelector("#sCenter").checked } });
      app.STATUS = r.status; close(); toast("Settings saved"); rerender();
    } catch (e) { toast(String(e.message || e)); }
  };
}

export function openAIModal() {
  const AI = app.STATUS.ai;
  const { el, close } = modal(`<h3>OpenAI</h3>
    <p class="mnote">Used for <b>Scan tasks</b> (reading your task-list screenshots) and <b>AI Categorize</b>.</p>
    <ol><li>Create a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a> (the account needs API credit).</li><li>Paste it here. The default model is fine; change it if your account uses a different one.</li></ol>
    <div class="row" style="margin-bottom:8px"><input type="password" id="aikey" placeholder="${AI.hasKey ? esc(AI.key) + " (saved — leave blank to keep)" : "sk-…"}" autocomplete="off"></div>
    <div class="row" style="margin-bottom:8px"><label style="font-size:14px;color:var(--muted);width:80px">Model</label><input type="text" id="aimodel" value="${esc(AI.model || "gpt-5.4-mini")}"></div>
    <div class="row"><label style="font-size:14px;color:var(--muted);width:80px">Reasoning</label><select id="aieffort" style="flex:1">${[["", "Default"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]].map(([v, n]) => `<option value="${v}" ${(AI.effort || "") === v ? "selected" : ""}>${n}</option>`).join("")}</select><button class="btn" id="aisave">Save & test</button></div>
    <div class="err" id="aierr"></div>
    <p class="mnote" style="margin-top:12px">Scanning sends each screenshot (shrunk to 2048 px) to OpenAI; AI Categorize sends task data plus wiki excerpts. Both are billed to this key's account. The key is stored in plain text in <code>squad-task-map-settings.json</code> next to the program and only sent to api.openai.com.</p>
    <div class="row" style="margin-top:14px;justify-content:space-between">${AI.hasKey ? '<button class="btn danger" id="aidel">Remove key</button>' : "<span></span>"}<button class="btn line" id="aiclose">Close</button></div>`);
  el.querySelector("#aiclose").onclick = close;
  el.querySelector("#aisave").onclick = async () => {
    const er = el.querySelector("#aierr"); er.textContent = "Testing key…";
    try {
      const r = await api("/api/ai/key", { method: "PUT", body: { key: el.querySelector("#aikey").value.trim(), model: el.querySelector("#aimodel").value.trim(), effort: el.querySelector("#aieffort").value } });
      app.STATUS.ai = { hasKey: r.hasKey, key: r.key, model: r.model, effort: r.effort };
      close(); toast("OpenAI key saved"); rerender();
    } catch (e) { er.textContent = String(e.message || e); }
  };
  const d = el.querySelector("#aidel");
  if (d) d.onclick = async () => { await api("/api/ai/key", { method: "DELETE" }); app.STATUS.ai = { ...app.STATUS.ai, hasKey: false, key: null }; close(); rerender(); };
  setTimeout(() => el.querySelector("#aikey").focus(), 50);
}
