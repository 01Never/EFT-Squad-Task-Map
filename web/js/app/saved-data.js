// @ts-check
// The saved data's shape (version 2): defaults for a new file, missing fields filled in when
// loading, and the one-time migration from v1. Plain functions: no DOM, no network.
// Key order matters only for how the JSON file reads; it's kept as v2 wrote it.
import { DEFAULT_CATEGORIES } from "../features/tasks/categories.js";
import { DEFAULT_SHOWN_EXTRACT_KINDS } from "../features/extracts/rules.js";

/** @import { SavedState, TaskEntry, Category, MapPrefs } from "./types.js" */

export const SAVED_DATA_VERSION = 2;

/**
 * A new, empty saved data object. Adding a field? Give it a default here; fillMissingFields()
 * adds it to older files when they load (SPEC §5.3).
 * @returns {SavedState}
 */
export function freshState() {
  return {
    version: SAVED_DATA_VERSION,
    cats: DEFAULT_CATEGORIES.map((category) => ({ ...category, visible: true })),
    tasks: {},
    ticks: {},
    have: {},
    subs: [],
    draw: {},
    prefs: {},
    collapsed: {},
    pinnedOnly: false,
    panelTab: "tasks",
    panelHidden: false,
    dcolor: "#ff4d4d",
    dwidth: 4,
    aiOpen: true,
  };
}

/**
 * A task's entry before it's on your list.
 * @param {number} [addedAt] ms since 1970; now when not given
 * @returns {TaskEntry}
 */
export function blankTaskEntry(addedAt = Date.now()) {
  return {
    active: false,
    source: "manual",
    addedAt,
    gamePct: null,
    scannedAt: null,
    noSplit: false,
    pinned: false,
    partCats: {},
  };
}

/**
 * Make sure every field exists (older or hand-edited files): missing top-level fields get their
 * default, the Unsorted category is always there, every task entry and map's prefs are complete.
 * Changes and returns the same object.
 * @param {SavedState} saved
 * @returns {SavedState}
 */
export function fillMissingFields(saved) {
  const defaults = freshState();
  for (const field of Object.keys(defaults)) {
    if (saved[field] === undefined) {
      saved[field] = defaults[field];
    }
  }
  if (!saved.cats.some((category) => category.builtin === "unsorted")) {
    const unsorted = DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1];
    saved.cats.push({ ...unsorted, visible: true });
  }
  for (const taskId of Object.keys(saved.tasks)) {
    const entry = saved.tasks[taskId];
    saved.tasks[taskId] = { ...blankTaskEntry(entry.addedAt), ...entry, partCats: entry.partCats || {} };
  }
  for (const mapKey of Object.keys(saved.prefs)) {
    const mapPrefs = saved.prefs[mapKey];
    mapPrefs.ext = { ...DEFAULT_SHOWN_EXTRACT_KINDS, ...(mapPrefs.ext || {}) };
    mapPrefs.extMarked = mapPrefs.extMarked || {};
  }
  return saved;
}

/**
 * Turn whatever /api/state returned into version-2 saved data.
 * - Nothing (or not saved data at all): a fresh object.
 * - Version 2: missing fields filled in.
 * - v1: migrated once (see migrateFromV1), and the page then shows the "scan your tasks" banner.
 * @param {any} old
 * @param {number} [now] ms since 1970, for v1 entries without a date
 * @returns {SavedState}
 */
export function migrateSavedData(old, now = Date.now()) {
  if (!old || typeof old !== "object" || !old.cats) {
    return freshState();
  }
  if (old.version === SAVED_DATA_VERSION) {
    return fillMissingFields(old);
  }
  return migrateFromV1(old, now);
}

/**
 * v1 → v2.
 * - Categories: the new default set, plus any categories the owner (or the AI) created, kept with
 *   their tasks. v1's built-in categories (Go somewhere / Mark / place something / Go and
 *   retrieve / Other) are replaced; their tasks are re-sorted automatically into the new set.
 * - Tasks on the v1 manual list become active. Sub-tasks, drawings and map settings carry over.
 * @param {any} old
 * @param {number} now
 * @returns {SavedState}
 */
function migrateFromV1(old, now) {
  const saved = freshState();
  const customCategories = (old.cats || [])
    .filter((category) => !category.builtin)
    .map((category) => ({ ...category, builtin: null, visible: category.visible !== false }));
  const unsorted = saved.cats[saved.cats.length - 1];
  saved.cats = [...saved.cats.slice(0, -1), ...customCategories, unsorted];

  const customCategoryIds = new Set(customCategories.map((category) => category.id));
  for (const [taskId, oldEntry] of Object.entries(old.tasks || {})) {
    saved.tasks[taskId] = taskEntryFromV1(oldEntry, customCategoryIds, now);
  }
  saved.subs = Array.isArray(old.subs) ? old.subs : [];
  saved.draw = old.draw || {};
  saved.prefs = {};
  for (const [mapKey, oldPrefs] of Object.entries(old.prefs || {})) {
    saved.prefs[mapKey] = mapPrefsFromV1(oldPrefs);
  }
  if (old.dcolor) saved.dcolor = old.dcolor;
  if (old.dwidth) saved.dwidth = old.dwidth;
  if (old.aiOpen === false) saved.aiOpen = false;
  saved.migratedFrom = 1;
  saved.showScanBanner = true;
  return saved;
}

/**
 * A v1 task entry: on the list when v1's manual flag said so (older files only had `added`).
 * A task in a category the owner made keeps it, for every part ("*").
 * @param {any} oldEntry
 * @param {Set<string>} customCategoryIds
 * @param {number} now
 * @returns {TaskEntry}
 */
function taskEntryFromV1(oldEntry, customCategoryIds, now) {
  const isOnList = oldEntry.manual === true || (oldEntry.manual === undefined && !!oldEntry.added);
  const entry = blankTaskEntry(oldEntry.added || now);
  entry.active = isOnList;
  const hasProgress = typeof oldEntry.progress === "number" && oldEntry.progress > 0;
  entry.gamePct = hasProgress ? oldEntry.progress : null;
  if (customCategoryIds.has(oldEntry.cat)) {
    entry.partCats = { "*": { cat: oldEntry.cat, manual: true } };
  }
  return entry;
}

/**
 * A v1 map's prefs. v1 could have every extract kind off; that becomes the default set.
 * Extract marks start empty.
 * @param {any} oldPrefs
 * @returns {MapPrefs}
 */
function mapPrefsFromV1(oldPrefs) {
  const hasAnyKindShown = oldPrefs.ext && Object.values(oldPrefs.ext).some(Boolean);
  const shownKinds = hasAnyKindShown ? oldPrefs.ext : DEFAULT_SHOWN_EXTRACT_KINDS;
  return {
    ext: { ...DEFAULT_SHOWN_EXTRACT_KINDS, ...shownKinds },
    extMarked: {},
    labels: oldPrefs.labels !== false,
    drawOn: oldPrefs.drawOn !== false,
  };
}

/**
 * A short random id for a new category or sub-task: 8 base-36 characters.
 * @returns {string}
 */
export function newId() {
  return Math.random().toString(36).slice(2, 10);
}
