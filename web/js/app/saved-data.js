// @ts-check
// The saved data's shape (version 3): defaults for a new file, missing fields filled in when
// loading, and the one-time migrations v1 → v2 → v3. Plain functions: no DOM, no network.
// v3 (ticket 22) keeps one task list per game mode under `modes`; everything else is shared.
// Key order matters only for how the JSON file reads.
import { DEFAULT_CATEGORIES } from "../features/tasks/categories.js";
import { DEFAULT_SHOWN_EXTRACT_KINDS } from "../features/extracts/rules.js";
import { cleanLootChoices } from "../features/loot/rules.js";
import { GAME_MODES, DEFAULT_GAME_MODE, knownGameMode } from "./game-modes.js";

/** @import { SavedState, TaskList, TaskEntry, Category, MapPrefs } from "./types.js" */

export const SAVED_DATA_VERSION = 3;

/**
 * A new, empty saved data object. Adding a field? Give it a default here; fillMissingFields()
 * adds it to older files when they load (SPEC §5.3). A field that belongs to one game mode's
 * character (tasks, ticks, bag) goes in emptyTaskList() instead.
 * @returns {SavedState}
 */
export function freshState() {
  return {
    version: SAVED_DATA_VERSION,
    cats: DEFAULT_CATEGORIES.map((category) => ({ ...category, visible: true })),
    modes: emptyModeLists(),
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
 * One game mode's list before anything is on it.
 * @returns {TaskList}
 */
export function emptyTaskList() {
  return { tasks: {}, ticks: {}, used: {}, have: {}, subs: [] };
}

/**
 * An empty list for every game mode.
 * @returns {Record<string, TaskList>}
 */
function emptyModeLists() {
  /** @type {Record<string, TaskList>} */
  const modes = {};
  for (const mode of GAME_MODES) {
    modes[mode] = emptyTaskList();
  }
  return modes;
}

/**
 * A game mode's list, created empty if the file has none for it. Callers change it in place.
 * The page goes through app/current-list.js currentList(), which picks the mode shown.
 * @param {SavedState} saved
 * @param {string} mode
 * @returns {TaskList}
 */
export function taskListOf(saved, mode) {
  saved.modes = saved.modes || {};
  if (!saved.modes[mode]) {
    saved.modes[mode] = emptyTaskList();
  }
  return saved.modes[mode];
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
 * default, the Unsorted category is always there, every game mode has a complete list with
 * complete task entries, and every map's prefs are complete. Changes and returns the same object.
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
  for (const mode of GAME_MODES) {
    taskListOf(saved, mode);
  }
  for (const mode of Object.keys(saved.modes)) {
    saved.modes[mode] = completeTaskList(saved.modes[mode]);
  }
  for (const mapKey of Object.keys(saved.prefs)) {
    const mapPrefs = saved.prefs[mapKey];
    mapPrefs.ext = { ...DEFAULT_SHOWN_EXTRACT_KINDS, ...(mapPrefs.ext || {}) };
    mapPrefs.extMarked = mapPrefs.extMarked || {};
    // Loot choices (ticket 08) are absent until you change one; absent means no loot shown, so
    // older files load unchanged. A damaged value keeps only the chips that are on.
    if (mapPrefs.loot !== undefined) mapPrefs.loot = cleanLootChoices(mapPrefs.loot);
  }
  return saved;
}

/**
 * One mode's list with every field there and every task entry complete.
 * @param {any} list
 * @returns {TaskList}
 */
function completeTaskList(list) {
  const given = list && typeof list === "object" ? list : {};
  const complete = { ...emptyTaskList(), ...given };
  if (!Array.isArray(complete.subs)) {
    complete.subs = [];
  }
  for (const taskId of Object.keys(complete.tasks)) {
    const entry = complete.tasks[taskId];
    complete.tasks[taskId] = { ...blankTaskEntry(entry.addedAt), ...entry, partCats: entry.partCats || {} };
  }
  return complete;
}

/**
 * Turn whatever /api/state returned into version-3 saved data.
 * - Nothing (or not saved data at all): a fresh object.
 * - Version 3: missing fields filled in; nothing else changes.
 * - Version 2: its one list goes to the game mode in Settings (see migrateFromV2).
 * - v1: migrated to v2 (see migrateFromV1), then to v3; the page then shows the "scan your
 *   tasks" banner.
 * @param {any} old
 * @param {string} [settingsMode] the game mode in Settings when the page loads
 * @param {number} [now] ms since 1970, for v1 entries without a date
 * @returns {SavedState}
 */
export function migrateSavedData(old, settingsMode = DEFAULT_GAME_MODE, now = Date.now()) {
  if (!old || typeof old !== "object" || !old.cats) {
    return freshState();
  }
  if (old.version === SAVED_DATA_VERSION) {
    return fillMissingFields(old);
  }
  if (old.version === 2) {
    return migrateFromV2(old, settingsMode);
  }
  return migrateFromV2(migrateFromV1(old, now), settingsMode);
}

/**
 * v2 → v3 (ticket 22). v2 had one task list for every game mode: the list of the mode you were
 * playing. It goes to the mode in Settings when the page loads; the other modes start empty.
 * Categories, drawings, map settings and every other choice stay shared by all modes.
 * @param {any} old v2 saved data
 * @param {string} settingsMode
 * @returns {SavedState}
 */
function migrateFromV2(old, settingsMode) {
  const { tasks, ticks, used, have, subs, ...shared } = old;
  const modes = emptyModeLists();
  modes[knownGameMode(settingsMode)] = {
    tasks: tasks || {},
    ticks: ticks || {},
    used: used || {},
    have: have || {},
    subs: Array.isArray(subs) ? subs : [],
  };
  // Spelled out first so the file still reads version, cats, modes, then the rest.
  const saved = { version: SAVED_DATA_VERSION, cats: shared.cats, modes, ...shared };
  saved.version = SAVED_DATA_VERSION;
  return fillMissingFields(/** @type {SavedState} */ (saved));
}

/**
 * v1 → v2 (the v2 shape: one task list at the top level, for every game mode).
 * - Categories: the new default set, plus any categories the owner (or the AI) created, kept with
 *   their tasks. v1's built-in categories (Go somewhere / Mark / place something / Go and
 *   retrieve / Other) are replaced; their tasks are re-sorted automatically into the new set.
 * - Tasks on the v1 manual list become active. Sub-tasks, drawings and map settings carry over.
 * @param {any} old
 * @param {number} now
 * @returns {any} v2 saved data
 */
function migrateFromV1(old, now) {
  const saved = {
    version: 2,
    cats: freshState().cats,
    tasks: {},
    ticks: {},
    have: {},
    subs: [],
    draw: {},
    prefs: {},
  };
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
