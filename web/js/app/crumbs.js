// @ts-check
// The breadcrumbs in the top bar (#crumbs), and the single "‹ previous step" link (#crumbback)
// narrow screens show instead. What they say is decided in addresses.js crumbsFor().
import { findElement, escapeHtml } from "./dom.js";
import { crumbsFor } from "./addresses.js";

/** @import { Address } from "./addresses.js" */

/**
 * Draw the trail for a page: every part but the last is a link.
 * @param {Address} address
 * @param {string} [mapName]
 */
export function showCrumbs(address, mapName) {
  const { parts, back } = crumbsFor(address, mapName);
  const lastIndex = parts.length - 1;
  findElement("#crumbs").innerHTML = parts
    .map((part, index) => {
      const text = escapeHtml(part.text);
      if (part.href) return `<a href="${part.href}">${text}</a>`;
      return parts.length > 1 && index === lastIndex ? `<b>${text}</b>` : text;
    })
    .join(" / ");
  const backLink = /** @type {HTMLAnchorElement} */ (findElement("#crumbback"));
  backLink.hidden = !back;
  if (back) {
    backLink.href = back.href;
    backLink.textContent = "‹ " + back.text;
  }
}
