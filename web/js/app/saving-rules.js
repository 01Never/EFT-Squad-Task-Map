// @ts-check
// Rules for saving the page's data (DOM-free, tested in saving-rules.test.js).

// Browsers refuse a keepalive request whose body is over 64 KiB, so such a save always fails.
export const KEEPALIVE_LIMIT_BYTES = 64 * 1024;

// After a failed save, try again this much later (the program was not reachable).
export const RETRY_AFTER_NETWORK_ERROR_MS = 1500;
// The program answered with an error: trying again at once will not help, so wait longer.
export const RETRY_AFTER_REFUSED_MS = 15000;

/**
 * Only the last-chance save while the page is closing uses keepalive (so the request can finish
 * after the page is gone), and only when the body fits the browser's limit.
 * @param {string} body
 * @param {boolean} isPageClosing
 */
export function shouldUseKeepalive(body, isPageClosing) {
  return isPageClosing && new TextEncoder().encode(body).length <= KEEPALIVE_LIMIT_BYTES;
}

/** @param {boolean} programAnswered true when a response came back (with an error status) */
export function retryDelayMs(programAnswered) {
  return programAnswered ? RETRY_AFTER_REFUSED_MS : RETRY_AFTER_NETWORK_ERROR_MS;
}
