// @ts-check
// One console note per kind of failure, so a friend's odd data that breaks a drawing can't flood
// the console (callers skip that friend and carry on, so the panel and markers stay up).

const warned = new Set();

/**
 * @param {string} what which part failed ("chip", "drawings", ...)
 * @param {unknown} error
 */
export function warnOnce(what, error) {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(`Squad: skipped a friend whose data broke the ${what}`, error);
}
