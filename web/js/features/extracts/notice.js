// @ts-check
// The one-time notice for "Read my extracts from my first raid screenshot" (ticket 06). With an
// OpenAI key the feature is on by default, but nothing is sent until the player has seen this
// notice (the server waits for it), because it sends a picture, which the app otherwise never does.
import { app } from "../../app/state.js";
import { findElement, openModal } from "../../app/dom.js";
import { callApi } from "../../app/api.js";

/** Show the notice if the server says it is due (a key exists and it was never shown). */
export function showExtractsNoticeIfDue() {
  if (!app.status.settings.extractsNotice) return;
  const { el: dialog, close } = openModal(`<h3>Read my extracts from my first raid screenshot</h3>
    <p>New: in a raid, open the extract list (double-tap <b>O</b>) and take a screenshot. Squad Task Map reads it and marks your extracts on the map for you.</p>
    <p class="mnote">To do that, <b>the first in-raid screenshot of each raid</b> (shrunk to 2048 px; up to 3 if the list wasn't on the first) is sent to OpenAI with your API key: about 1&ndash;2k tokens per raid, billed to your OpenAI account. The screenshot is still deleted when the raid ends. Nothing is sent without a key.</p>
    <p class="mnote">You can turn this off any time in Settings.</p>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn line" id="exOff">Turn it off</button><button class="btn" id="exOn">Keep it on</button></div>`);
  findElement("#exOn", dialog).onclick = () => answerNotice({ extractsNoticeSeen: true }, close);
  findElement("#exOff", dialog).onclick = () => answerNotice({ extractsNoticeSeen: true, readExtracts: false }, close);
}

/**
 * Remember the answer on the server, then close.
 * @param {{ extractsNoticeSeen: boolean, readExtracts?: boolean }} change
 * @param {() => void} close
 */
async function answerNotice(change, close) {
  try {
    const answer = await callApi("/api/settings", { method: "PUT", body: change });
    app.status = answer.status;
  } catch {
    // The notice simply shows again next time.
  }
  close();
}
