// @ts-check
// Small DOM helpers every part of the page uses: find an element, escape text for HTML, create an
// SVG element, the toast at the top and the modal dialog. No feature logic here.

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

// How long a toast stays up. One with an Undo button stays longer, so there's time to click it.
const TOAST_VISIBLE_MS = 3000;
const TOAST_WITH_ACTION_VISIBLE_MS = 7000;

/**
 * The first element matching a CSS selector, or null.
 * The result is typed loosely (`any`): callers know which element they asked for.
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {any}
 */
export function findElement(selector, root = document) {
  return root.querySelector(selector);
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * Text made safe to put inside HTML (and inside a quoted attribute). null/undefined become "".
 * @param {unknown} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

/**
 * Create an SVG element with these attributes (in this order; null/undefined ones are skipped)
 * and add it to `parent`.
 * @param {string} tag
 * @param {Record<string, unknown>} attributes
 * @param {Element} [parent]
 * @returns {any} the new element
 */
export function createSvgElement(tag, attributes, parent) {
  const element = document.createElementNS(SVG_NAMESPACE, tag);
  for (const name in attributes) {
    if (attributes[name] != null) {
      element.setAttribute(name, /** @type {string} */ (attributes[name]));
    }
  }
  if (parent) {
    parent.appendChild(element);
  }
  return element;
}

let toastTimer = null;

/**
 * Show a short message at the top of the page, optionally with a button (e.g. Undo).
 * A new toast replaces the one showing.
 * @param {string} message
 * @param {{ label: string, run: () => void }} [action]
 */
export function showToast(message, action) {
  const toast = findElement("#toast");
  const buttonHtml = action
    ? ` <button class="btn sm line" id="toastAct">${escapeHtml(action.label)}</button>`
    : "";
  toast.innerHTML = escapeHtml(message) + buttonHtml;
  toast.style.display = "block";
  if (action) {
    findElement("#toastAct").onclick = () => {
      toast.style.display = "none";
      action.run();
    };
  }
  clearTimeout(toastTimer);
  const visibleMs = action ? TOAST_WITH_ACTION_VISIBLE_MS : TOAST_VISIBLE_MS;
  toastTimer = setTimeout(() => (toast.style.display = "none"), visibleMs);
}

/**
 * Open a modal dialog with this HTML inside. Esc or a click outside the box closes it.
 * @param {string} html
 * @param {{ wide?: boolean }} [options] wide: the larger box (scan results)
 * @returns {{ el: HTMLDivElement, close: () => void }} the dialog element and a function that closes it
 */
export function openModal(html, { wide = false } = {}) {
  const dialog = document.createElement("div");
  dialog.className = "modal";
  dialog.innerHTML = `<div class="box${wide ? " wide" : ""}">${html}</div>`;
  document.body.appendChild(dialog);

  const close = () => {
    dialog.remove();
    removeEventListener("keydown", onKeyDown);
  };
  /** @param {KeyboardEvent} event */
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      close();
    }
  };
  addEventListener("keydown", onKeyDown);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      close();
    }
  });
  return { el: dialog, close };
}
