// AI Categorize chat box (OpenAI). Works on parts; applying writes the owner's choice per part.
import { app, save, activeTasks, partsFor, catOf, entry } from "./store.js";
import { $, esc, uid, toast, SHAPES, api } from "./util.js";
import { mapParts, renderAll, partLabel } from "./map.js";
import { renderPanel } from "./panel.js";
import { openAIModal } from "./settings.js";

const CHATS = {};
let busy = false;

function scopeParts(scope) {
  if (scope === "all") return activeTasks().flatMap((t) => partsFor(t).filter((p) => p.action !== "offmap").map((p) => ({ task: t, part: p, cat: catOf(t, p) })));
  return mapParts(app.M.key);
}

export function renderAI() {
  const M = app.M, S = app.S, AI = app.STATUS.ai, k = M.key, chat = (CHATS[k] = CHATS[k] || []), open = S.aiOpen !== false, scope = M.aiScope || "map";
  let h = `<div class="ai"><button class="aihead" data-ai-act="toggle">🤖 AI Categorize<span class="s">${AI.hasKey ? esc(AI.model) + (AI.effort ? " · " + esc(AI.effort) : "") : "not set up"} ${open ? "▾" : "▸"}</span></button>`;
  if (!open) return h + "</div>";
  h += `<div class="aibody">`;
  if (!AI.hasKey) return h + `<p style="margin:0 0 8px;font-size:14.5px">Describe how you want your tasks sorted and an OpenAI model does it, checking each task's objectives and wiki page first. You'll need an OpenAI API key (also used for Scan tasks).</p><button class="btn sm" data-ai-act="key">Add OpenAI key</button></div></div>`;
  const nMap = mapParts(k).length, nAll = scopeParts("all").length;
  h += `<div class="aiscope">Parts: <select id="aiscope"><option value="map" ${scope === "map" ? "selected" : ""}>On ${esc(M.cfg.name)} (${nMap})</option><option value="all" ${scope === "all" ? "selected" : ""}>All my active tasks (${nAll})</option></select><a href="#" data-ai-act="key" style="margin-left:auto">⚙ Key & model</a>${chat.length ? ' · <a href="#" data-ai-act="clear">Clear chat</a>' : ""}</div>`;
  if (chat.length) h += `<div class="chat" id="chat">${chat.map(msgHTML).join("")}</div>`;
  h += `<div class="aiin"><textarea id="aitext" placeholder="e.g. Anything that needs a key goes in a new “Key runs” category" ${busy ? "disabled" : ""}></textarea><button class="btn" data-ai-act="send" ${busy ? "disabled" : ""}>Send</button></div>`;
  if (!chat.length) h += `<p class="aiex">Try: <a data-ex="Make a category called Key runs for parts that need a key on this map">Key runs</a> · <a data-ex="Put everything on the upper floors of buildings into a new Upstairs category">Upstairs</a> · <a data-ex="Make a Night raid category for tasks that only count at night">Night raid</a></p>`;
  return h + `</div></div>`;
}

function msgHTML(m, i) {
  if (m.role === "user") return `<div class="msg me">${esc(m.text)}</div>`;
  if (m.working) return `<div class="msg bot"><span class="spin"></span>${esc(m.log || "Working…")}</div>`;
  if (m.error) return `<div class="msg bot err">${esc(m.error)}</div>`;
  const r = m.result, a = r.assignments || [];
  let h = `<div class="msg bot" data-mi="${i}">${esc(r.reply)}`;
  if (r.new_categories.length) h += `<div class="meta2">New categories: ${r.new_categories.map((c) => `<b style="color:${esc(c.color || "#fff")}">${esc(c.name)}</b>`).join(", ")}</div>`;
  if (a.length) {
    h += `<ul class="ch">${a.map((x, j) => `<li><input type="checkbox" data-ai="${j}" ${m.applied || m.discarded ? "disabled" : ""} checked><span>${esc(x.name)}: <span style="color:var(--muted)">${esc(x.from)}</span> → <b>${esc(x.category)}</b><span class="why">${esc(x.reason)}</span></span></li>`).join("")}</ul>`;
    if (m.applied) h += `<div class="acts2"><span class="ok">Applied ${m.applied} change${m.applied > 1 ? "s" : ""}</span>${m.undo ? '<button class="btn sm line" data-ai-act="undo">Undo</button>' : ""}</div>`;
    else if (m.discarded) h += `<div class="acts2" style="color:var(--muted)">${m.undone ? "Undone" : "Discarded"}</div>`;
    else h += `<div class="acts2"><button class="btn sm" data-ai-act="apply">Apply selected</button><button class="btn sm line" data-ai-act="discard">Discard</button></div>`;
  } else if (!r.new_categories.length) h += `<div class="meta2">No changes proposed.</div>`;
  if (r.dropped && r.dropped.length) h += `<div class="meta2">Ignored ${r.dropped.length} invalid suggestion(s).</div>`;
  h += `<div class="meta2">${esc(r.model)}${r.wiki_calls ? ` · opened ${r.wiki_calls} full wiki page${r.wiki_calls > 1 ? "s" : ""}` : ""}</div>`;
  return h + `</div>`;
}
const scrollChat = () => { const c = $("#chat"); if (c) c.scrollTop = c.scrollHeight; };

async function send(text) {
  if (busy || !text.trim()) return;
  const M = app.M, S = app.S, k = M.key, chat = (CHATS[k] = CHATS[k] || []);
  const scope = M.aiScope || "map", parts = scopeParts(scope);
  if (!parts.length) { toast("No tasks in scope"); return; }
  const history = [];
  for (const m of chat) {
    if (m.role === "user") history.push({ role: "user", content: m.text });
    else if (m.result) history.push({ role: "assistant", content: m.result.reply + (m.applied ? ` [Player applied ${m.applied} of the proposed changes.]` : m.undone ? " [Player applied, then undid these changes.]" : m.discarded ? " [Player discarded these changes.]" : "") });
  }
  const cats = S.cats.map((c) => ({ name: c.name, builtin: c.builtin, color: c.color, count: parts.filter((x) => x.cat.id === c.id).length }));
  chat.push({ role: "user", text });
  const bot = { role: "bot", working: true, log: "Starting…" };
  chat.push(bot); busy = true; renderPanel(); scrollChat();
  try {
    const r = await api("/api/ai/categorize", { method: "POST", body: { instruction: text, history, mapName: scope === "all" ? "all maps" : M.cfg.name, categories: cats, parts: parts.map((x) => ({ id: x.part.key, taskId: x.task.id, objIds: x.part.objs.map((o) => o.id), label: partLabel(x.part), category: x.cat.name })) } });
    for (;;) {
      await new Promise((z) => setTimeout(z, 1000));
      const j = await (await fetch("/api/ai/job/" + r.job)).json();
      if (j.status === "done") { bot.working = false; bot.result = j.result; break; }
      if (j.status === "error") throw new Error(j.error);
      bot.log = j.log;
      if (app.M && app.M.key === k) { const el = document.querySelector("#chat .msg:last-child"); if (el) el.innerHTML = `<span class="spin"></span>${esc(bot.log)}`; }
    }
  } catch (e) { bot.working = false; bot.error = String(e.message || e); }
  busy = false;
  if (app.M && app.M.key === k) { renderPanel(); scrollChat(); }
}

function apply(i) {
  const S = app.S, m = CHATS[app.M.key][i], r = m.result, box = document.querySelector(`.msg[data-mi="${i}"]`);
  const chosen = r.assignments.filter((x, j) => box.querySelector(`[data-ai="${j}"]`).checked);
  if (!chosen.length) { toast("Nothing selected"); return; }
  const undo = { parts: {}, cats: [] }, pal = ["#f783ac", "#ff922b", "#66d9e8", "#a9e34b", "#e599f7", "#ffe084", "#4dabf7"];
  const idFor = (name) => {
    let c = S.cats.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!c) {
      const nc = r.new_categories.find((x) => x.name === name) || {};
      c = { id: "c" + uid(), name, color: nc.color || pal[S.cats.length % pal.length], icon: nc.icon || SHAPES[S.cats.length % SHAPES.length], visible: true, builtin: null };
      const at = S.cats.findIndex((x) => x.builtin === "unsorted");
      S.cats.splice(at < 0 ? S.cats.length : at, 0, c); undo.cats.push(c.id);
    }
    return c.id;
  };
  r.new_categories.forEach((c) => idFor(c.name));
  for (const x of chosen) {
    const tid = x.part_id.split(":")[0], en = entry(tid);
    undo.parts[x.part_id] = en.partCats[x.part_id] ? { ...en.partCats[x.part_id] } : null;
    en.partCats[x.part_id] = { cat: idFor(x.category), manual: true };
  }
  m.applied = chosen.length; m.undo = undo; save(); renderAll(); scrollChat();
  toast(`Applied ${chosen.length} change${chosen.length > 1 ? "s" : ""}`);
}
function undoApply(i) {
  const S = app.S, m = CHATS[app.M.key][i], u = m.undo; if (!u) return;
  for (const [pk, v] of Object.entries(u.parts)) { const en = entry(pk.split(":")[0]); if (v) en.partCats[pk] = v; else delete en.partCats[pk]; }
  for (const cid of u.cats) if (!Object.values(S.tasks).some((en) => Object.values(en.partCats || {}).some((v) => v.cat === cid))) S.cats = S.cats.filter((c) => c.id !== cid);
  m.undo = null; m.applied = 0; m.discarded = true; m.undone = true; save(); renderAll(); toast("Undone");
}

/** Click handling for the AI box; returns true if handled. */
export function aiAction(e) {
  const ex = e.target.closest("[data-ex]");
  if (ex) { e.preventDefault(); $("#aitext").value = ex.dataset.ex; $("#aitext").focus(); return true; }
  const b = e.target.closest("[data-ai-act]");
  if (!b) return false;
  e.preventDefault();
  const S = app.S, msg = b.closest(".msg");
  switch (b.dataset.aiAct) {
    case "toggle": S.aiOpen = S.aiOpen === false; save(); renderPanel(); break;
    case "key": openAIModal(); break;
    case "clear": CHATS[app.M.key] = []; renderPanel(); break;
    case "send": send($("#aitext").value); break;
    case "apply": apply(+msg.dataset.mi); break;
    case "discard": CHATS[app.M.key][+msg.dataset.mi].discarded = true; renderPanel(); break;
    case "undo": undoApply(+msg.dataset.mi); break;
  }
  return true;
}
export function aiKeydown(e) {
  if (e.target.id === "aitext" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e.target.value); return true; }
  return false;
}
