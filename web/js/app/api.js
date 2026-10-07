// @ts-check
// Calls to the Squad Task Map program's HTTP API (internal/httpapi). Only 127.0.0.1; no retries
// here. Saving the page's data has its own module (app/saving.js).

/**
 * Call an API route and return its JSON answer. A body that isn't text is sent as JSON, with
 * `Content-Type: application/json` (the server refuses a body sent any other way: ticket 04d).
 * Throws an Error with the server's message when the answer isn't OK or says `ok: false`.
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<any>}
 */
export async function callApi(path, options = {}) {
  const isJsonBody = options.body && typeof options.body !== "string";
  const body = isJsonBody ? JSON.stringify(options.body) : options.body;
  const headers = isJsonBody ? { "Content-Type": "application/json" } : undefined;
  const response = await fetch(path, { ...options, headers, body: /** @type {BodyInit} */ (body) });
  let answer = null;
  try {
    answer = await response.json();
  } catch {
    // An answer without a JSON body: judged by its status alone.
  }
  if (!response.ok || (answer && answer.ok === false)) {
    throw new Error((answer && answer.error) || `HTTP ${response.status}`);
  }
  return answer;
}

/**
 * GET a route and read its JSON, without checking the status (start-up and polling use this).
 * @param {string} path
 * @returns {Promise<any>}
 */
export async function fetchJson(path) {
  const response = await fetch(path);
  return response.json();
}
