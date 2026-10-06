// @ts-check
// AI Categorize in the panel: the box in the Tasks tab (scope, chat, proposed changes with Apply /
// Discard / Undo, examples) and its handlers. You describe how to sort, the server asks OpenAI
// (which reads each task's objectives and wiki page) and the answer proposes moves; nothing
// changes until you apply them. The rules are in rules.js.
import { app } from "../../app/state.js";
import { escapeHtml, findElement, showToast } from "../../app/dom.js";
import { callApi, fetchJson } from "../../app/api.js";
import { save } from "../../app/saving.js";
import { newId } from "../../app/saved-data.js";
import { renderMapPage } from "../../map/map-page.js";
import { renderPanel } from "../../panel/panel.js";
import { openAiKeyDialog } from "../settings/panel.js";
import { activeTasks, partsOf, categoryOf, partsOnMap, taskEntry } from "../tasks/task-list.js";
import {
  chatHistoryForRequest,
  categoriesForRequest,
  partsForRequest,
  applyAssignments,
  undoAssignments,
} from "./rules.js";

/** @import { ChatMessage, PartInScope } from "./rules.js" */

// While the AI works, the page asks the server how far it got this often. This only runs between
// clicking Send and the answer (seconds); nothing polls otherwise.
const JOB_CHECK_INTERVAL_MS = 1000;

// Example instructions under an empty chat (link text, instruction).
const EXAMPLES = [
  ["Key runs", "Make a category called Key runs for parts that need a key on this map"],
  ["Upstairs", "Put everything on the upper floors of buildings into a new Upstairs category"],
  ["Night raid", "Make a Night raid category for tasks that only count at night"],
];

/**
 * The chat on each map (kept while the page is open, not saved).
 * @type {Record<string, ChatMessage[]>}
 */
const chatByMap = {};

// One request at a time: Send is disabled while an answer is coming.
let isWaitingForAnswer = false;

/** @param {string} mapKey */
function chatOf(mapKey) {
  chatByMap[mapKey] = chatByMap[mapKey] || [];
  return chatByMap[mapKey];
}

/**
 * The parts the AI may move: this map's ("map"), or every on-map part of all your tasks ("all").
 * @param {string} scope
 * @returns {PartInScope[]}
 */
function partsInScope(scope) {
  if (scope !== "all") return partsOnMap(app.mapView.key);
  const parts = [];
  for (const task of activeTasks()) {
    for (const part of partsOf(task)) {
      if (part.action !== "offmap") parts.push({ task, part, cat: categoryOf(task, part) });
    }
  }
  return parts;
}

// ---------------------------------------------------------------- the box

/** The "🤖 AI Categorize" box: folded, "add a key" when there's none, or the chat. */
export function renderAiCategorizeBox() {
  const isOpen = app.saved.aiOpen !== false;
  const header = renderHeader(isOpen);
  if (!isOpen) return `<div class="ai">${header}</div>`;
  if (!app.status.ai.hasKey) return `<div class="ai">${header}<div class="aibody">${renderAddKeyPrompt()}</div></div>`;
  return `<div class="ai">${header}<div class="aibody">${renderChatArea()}</div></div>`;
}

/** The header: the model in use (or "not set up") and ▾ / ▸. */
function renderHeader(isOpen) {
  const ai = app.status.ai;
  const model = ai.hasKey ? escapeHtml(ai.model) + (ai.effort ? " · " + escapeHtml(ai.effort) : "") : "not set up";
  return `<button class="aihead" data-ai-act="toggle">🤖 AI Categorize<span class="s">${model} ${isOpen ? "▾" : "▸"}</span></button>`;
}

function renderAddKeyPrompt() {
  return `<p style="margin:0 0 8px;font-size:14.5px">Describe how you want your tasks sorted and an OpenAI model does it, checking each task's objectives and wiki page first. You'll need an OpenAI API key (also used for Scan tasks).</p><button class="btn sm" data-ai-act="key">Add OpenAI key</button>`;
}

/** Scope, the chat, the input, and examples while the chat is empty. */
function renderChatArea() {
  const chat = chatOf(app.mapView.key);
  const messages = chat.length ? `<div class="chat" id="chat">${chat.map(renderMessage).join("")}</div>` : "";
  const disabled = isWaitingForAnswer ? "disabled" : "";
  const input = `<div class="aiin"><textarea id="aitext" placeholder="e.g. Anything that needs a key goes in a new “Key runs” category" ${disabled}></textarea><button class="btn" data-ai-act="send" ${disabled}>Send</button></div>`;
  return renderScopeLine(chat) + messages + input + (chat.length ? "" : renderExamples());
}

/** "Parts: [On Customs (12) / All my active tasks (30)]  ⚙ Key & model · Clear chat". */
function renderScopeLine(chat) {
  const mapView = app.mapView;
  const scope = mapView.aiScope || "map";
  const mapCount = partsOnMap(mapView.key).length;
  const allCount = partsInScope("all").length;
  const clearChat = chat.length ? ' · <a href="#" data-ai-act="clear">Clear chat</a>' : "";
  return `<div class="aiscope">Parts: <select id="aiscope"><option value="map" ${scope === "map" ? "selected" : ""}>On ${escapeHtml(mapView.config.name)} (${mapCount})</option><option value="all" ${scope === "all" ? "selected" : ""}>All my active tasks (${allCount})</option></select><a href="#" data-ai-act="key" style="margin-left:auto">⚙ Key & model</a>${clearChat}</div>`;
}

function renderExamples() {
  const links = EXAMPLES.map(([label, instruction]) => `<a data-ex="${instruction}">${label}</a>`).join(" · ");
  return `<p class="aiex">Try: ${links}</p>`;
}

/**
 * One message: yours; the AI still working; an error; or its answer with the proposed changes.
 * @param {ChatMessage} message
 * @param {number} index
 */
function renderMessage(message, index) {
  if (message.role === "user") return `<div class="msg me">${escapeHtml(message.text)}</div>`;
  if (message.working) return `<div class="msg bot"><span class="spin"></span>${escapeHtml(message.log || "Working…")}</div>`;
  if (message.error) return `<div class="msg bot err">${escapeHtml(message.error)}</div>`;
  const result = message.result;
  const assignments = result.assignments || [];
  let html = `<div class="msg bot" data-mi="${index}">${escapeHtml(result.reply)}`;
  if (result.new_categories.length) html += renderNewCategories(result);
  if (assignments.length) {
    html += renderProposedChanges(message, assignments) + renderAnswerButtons(message);
  } else if (!result.new_categories.length) {
    html += `<div class="meta2">No changes proposed.</div>`;
  }
  if (result.dropped && result.dropped.length) html += `<div class="meta2">Ignored ${result.dropped.length} invalid suggestion(s).</div>`;
  html += `<div class="meta2">${escapeHtml(result.model)}${renderWikiCalls(result.wiki_calls)}</div>`;
  return html + `</div>`;
}

function renderNewCategories(result) {
  const names = result.new_categories.map((category) => `<b style="color:${escapeHtml(category.color || "#fff")}">${escapeHtml(category.name)}</b>`);
  return `<div class="meta2">New categories: ${names.join(", ")}</div>`;
}

/** A ticked box per move: "Task: from → to", and why. Locked once applied or discarded. */
function renderProposedChanges(message, assignments) {
  const isLocked = message.applied || message.discarded;
  const lines = assignments.map(
    (assignment, index) =>
      `<li><input type="checkbox" data-ai="${index}" ${isLocked ? "disabled" : ""} checked><span>${escapeHtml(assignment.name)}: <span style="color:var(--muted)">${escapeHtml(assignment.from)}</span> → <b>${escapeHtml(assignment.category)}</b><span class="why">${escapeHtml(assignment.reason)}</span></span></li>`,
  );
  return `<ul class="ch">${lines.join("")}</ul>`;
}

/** "Applied 3 changes [Undo]", "Undone" / "Discarded", or "Apply selected" and "Discard". */
function renderAnswerButtons(message) {
  if (message.applied) {
    const undoButton = message.undo ? '<button class="btn sm line" data-ai-act="undo">Undo</button>' : "";
    return `<div class="acts2"><span class="ok">Applied ${message.applied} change${message.applied > 1 ? "s" : ""}</span>${undoButton}</div>`;
  }
  if (message.discarded) return `<div class="acts2" style="color:var(--muted)">${message.undone ? "Undone" : "Discarded"}</div>`;
  return `<div class="acts2"><button class="btn sm" data-ai-act="apply">Apply selected</button><button class="btn sm line" data-ai-act="discard">Discard</button></div>`;
}

/** " · opened 2 full wiki pages". */
function renderWikiCalls(wikiCalls) {
  if (!wikiCalls) return "";
  return ` · opened ${wikiCalls} full wiki page${wikiCalls > 1 ? "s" : ""}`;
}

function scrollChatToEnd() {
  const chat = findElement("#chat");
  if (chat) chat.scrollTop = chat.scrollHeight;
}

// ---------------------------------------------------------------- asking

/**
 * Send an instruction with the chat so far, the categories and the parts in scope; then follow
 * the job on the server until the answer is there.
 * @param {string} text
 */
async function sendInstruction(text) {
  if (isWaitingForAnswer || !text.trim()) return;
  const mapView = app.mapView;
  const mapKey = mapView.key;
  const chat = chatOf(mapKey);
  const scope = mapView.aiScope || "map";
  const parts = partsInScope(scope);
  if (!parts.length) {
    showToast("No tasks in scope");
    return;
  }
  const request = {
    instruction: text,
    history: chatHistoryForRequest(chat),
    mapName: scope === "all" ? "all maps" : mapView.config.name,
    categories: categoriesForRequest(app.saved.cats, parts),
    parts: partsForRequest(parts),
  };
  chat.push({ role: "user", text });
  /** @type {ChatMessage} */
  const answer = { role: "bot", working: true, log: "Starting…" };
  chat.push(answer);
  isWaitingForAnswer = true;
  renderPanel();
  scrollChatToEnd();
  try {
    const job = await callApi("/api/ai/categorize", { method: "POST", body: request });
    answer.result = await waitForJob(job.job, answer, mapKey);
    answer.working = false;
  } catch (error) {
    answer.working = false;
    answer.error = String(error.message || error);
  }
  isWaitingForAnswer = false;
  if (app.mapView && app.mapView.key === mapKey) {
    renderPanel();
    scrollChatToEnd();
  }
}

/**
 * Ask the server about the job every JOB_CHECK_INTERVAL_MS until it's done (its result) or
 * failed (throws). Meanwhile the "working" message shows what the server says it's doing.
 * @param {string} jobId
 * @param {ChatMessage} answer
 * @param {string} mapKey
 */
async function waitForJob(jobId, answer, mapKey) {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, JOB_CHECK_INTERVAL_MS));
    const job = await fetchJson("/api/ai/job/" + jobId);
    if (job.status === "done") return job.result;
    if (job.status === "error") throw new Error(job.error);
    answer.log = job.log;
    if (app.mapView && app.mapView.key === mapKey) {
      const lastMessage = document.querySelector("#chat .msg:last-child");
      if (lastMessage) lastMessage.innerHTML = `<span class="spin"></span>${escapeHtml(answer.log)}`;
    }
  }
}

// ---------------------------------------------------------------- applying

/**
 * "Apply selected": the ticked moves (and any new categories), with Undo.
 * @param {number} messageIndex
 */
function applySelected(messageIndex) {
  const message = chatOf(app.mapView.key)[messageIndex];
  const result = message.result;
  const messageElement = document.querySelector(`.msg[data-mi="${messageIndex}"]`);
  const isTicked = (index) => /** @type {HTMLInputElement} */ (messageElement.querySelector(`[data-ai="${index}"]`)).checked;
  const chosen = result.assignments.filter((assignment, index) => isTicked(index));
  if (!chosen.length) {
    showToast("Nothing selected");
    return;
  }
  const undo = applyAssignments(app.saved, result, chosen, taskEntry, () => "c" + newId());
  message.applied = chosen.length;
  message.undo = undo;
  save();
  renderMapPage();
  scrollChatToEnd();
  showToast(`Applied ${chosen.length} change${chosen.length > 1 ? "s" : ""}`);
}

/**
 * "Undo" after applying.
 * @param {number} messageIndex
 */
function undoApplied(messageIndex) {
  const message = chatOf(app.mapView.key)[messageIndex];
  if (!message.undo) return;
  undoAssignments(app.saved, message.undo, taskEntry);
  message.undo = null;
  message.applied = 0;
  message.discarded = true;
  message.undone = true;
  save();
  renderMapPage();
  showToast("Undone");
}

// ---------------------------------------------------------------- handlers

/** Each button's data-ai-act and its handler. `messageIndex` is the message the button sits in. */
const AI_ACTIONS = {
  toggle: () => {
    app.saved.aiOpen = app.saved.aiOpen === false;
    save();
    renderPanel();
  },
  key: () => openAiKeyDialog(),
  clear: () => {
    chatByMap[app.mapView.key] = [];
    renderPanel();
  },
  send: () => sendInstruction(findElement("#aitext").value),
  apply: (messageIndex) => applySelected(messageIndex),
  discard: (messageIndex) => {
    chatOf(app.mapView.key)[messageIndex].discarded = true;
    renderPanel();
  },
  undo: (messageIndex) => undoApplied(messageIndex),
};

/**
 * A click in the panel: an example fills the input; an AI button does its job.
 * @param {MouseEvent} event
 * @returns {boolean} true when it was an AI click (the panel's router stops there)
 */
export function onAiCategorizeClicked(event) {
  const target = /** @type {Element} */ (event.target);
  const example = target.closest("[data-ex]");
  if (example) {
    event.preventDefault();
    findElement("#aitext").value = example.getAttribute("data-ex");
    findElement("#aitext").focus();
    return true;
  }
  const button = target.closest("[data-ai-act]");
  if (!button) return false;
  event.preventDefault();
  const message = button.closest(".msg");
  const messageIndex = message ? +message.getAttribute("data-mi") : NaN;
  const handler = AI_ACTIONS[button.getAttribute("data-ai-act")];
  if (handler) handler(messageIndex);
  return true;
}

/**
 * Enter in the instruction box sends it (Shift+Enter is a new line).
 * @param {KeyboardEvent} event
 * @returns {boolean} true when it was handled
 */
export function onAiCategorizeKeyDown(event) {
  const target = /** @type {HTMLTextAreaElement} */ (event.target);
  if (target.id === "aitext" && event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendInstruction(target.value);
    return true;
  }
  return false;
}

/**
 * The scope drop-down: this map, or all your tasks (remembered while the map is open).
 * @param {HTMLSelectElement} select
 */
export function onAiScopeChanged(select) {
  app.mapView.aiScope = select.value;
}
