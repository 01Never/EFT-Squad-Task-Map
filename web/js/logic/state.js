// Saved data (v2): defaults, migration from v1, and which category a part is in. Pure; no DOM.

export const DEFAULT_CATS = [
  { id: "b-boss", name: "Boss hunts", color: "#ff4d4d", icon: "star", builtin: "boss" },
  { id: "b-pmc", name: "PMC kills", color: "#ff922b", icon: "triangle", builtin: "pmc" },
  { id: "b-scav", name: "Scav / any kills", color: "#c0eb75", icon: "triangle", builtin: "scav" },
  { id: "b-mark", name: "Mark", color: "#ffd43b", icon: "diamond", builtin: "mark" },
  { id: "b-plant", name: "Plant / stash", color: "#3bc9db", icon: "square", builtin: "plant" },
  { id: "b-retrieve", name: "Retrieve", color: "#f783ac", icon: "circle", builtin: "retrieve" },
  { id: "b-go", name: "Scout & extract", color: "#51cf66", icon: "circle", builtin: "go" },
  { id: "unsorted", name: "Unsorted", color: "#c7c5b3", icon: "hexagon", builtin: "unsorted" },
];
export const DEFAULT_EXT = { pmc: true, scav: false, shared: true, transit: true };

export function freshState() {
  return {
    version: 2,
    cats: DEFAULT_CATS.map((c) => ({ ...c, visible: true })),
    tasks: {}, ticks: {}, have: {}, subs: [], draw: {}, prefs: {}, collapsed: {},
    pinnedOnly: false, panelTab: "tasks", panelHidden: false, dcolor: "#ff4d4d", dwidth: 4, aiOpen: true,
  };
}

export function blankEntry(now = Date.now()) {
  return { active: false, source: "manual", addedAt: now, gamePct: null, scannedAt: null, noSplit: false, pinned: false, partCats: {} };
}

/** Make sure every field exists (older or hand-edited files). */
export function fill(s) {
  const f = freshState();
  for (const k of Object.keys(f)) if (s[k] === undefined) s[k] = f[k];
  if (!s.cats.some((c) => c.builtin === "unsorted")) s.cats.push({ ...DEFAULT_CATS[DEFAULT_CATS.length - 1], visible: true });
  for (const id of Object.keys(s.tasks)) s.tasks[id] = { ...blankEntry(s.tasks[id].addedAt), ...s.tasks[id], partCats: s.tasks[id].partCats || {} };
  for (const k of Object.keys(s.prefs)) { const p = s.prefs[k]; p.ext = { ...DEFAULT_EXT, ...(p.ext || {}) }; p.extMarked = p.extMarked || {}; }
  return s;
}

/**
 * v1 → v2.
 * - Categories: the new default set, plus any categories the owner (or the AI) created, kept with their tasks.
 *   v1's built-in categories (Go somewhere / Mark / place something / Go and retrieve / Other) are replaced;
 *   their tasks are re-sorted automatically into the new set.
 * - Tasks on the v1 manual list become active. Sub-tasks, drawings and map settings carry over.
 */
export function migrate(old, now = Date.now()) {
  if (!old || typeof old !== "object" || !old.cats) return freshState();
  if (old.version === 2) return fill(old);
  const s = freshState();
  const custom = (old.cats || []).filter((c) => !c.builtin).map((c) => ({ ...c, builtin: null, visible: c.visible !== false }));
  s.cats = [...s.cats.slice(0, -1), ...custom, s.cats[s.cats.length - 1]];
  const customIds = new Set(custom.map((c) => c.id));
  for (const [id, v] of Object.entries(old.tasks || {})) {
    const onList = v.manual === true || (v.manual === undefined && !!v.added);
    const e = blankEntry(v.added || now);
    e.active = onList;
    e.gamePct = typeof v.progress === "number" && v.progress > 0 ? v.progress : null;
    if (customIds.has(v.cat)) e.partCats = { "*": { cat: v.cat, manual: true } };
    s.tasks[id] = e;
  }
  s.subs = Array.isArray(old.subs) ? old.subs : [];
  s.draw = old.draw || {};
  s.prefs = {};
  for (const [k, p] of Object.entries(old.prefs || {})) {
    const ext = p.ext && Object.values(p.ext).some(Boolean) ? p.ext : DEFAULT_EXT;
    s.prefs[k] = { ext: { ...DEFAULT_EXT, ...ext }, extMarked: {}, labels: p.labels !== false, drawOn: p.drawOn !== false };
  }
  if (old.dcolor) s.dcolor = old.dcolor;
  if (old.dwidth) s.dwidth = old.dwidth;
  if (old.aiOpen === false) s.aiOpen = false;
  s.migratedFrom = 1;
  s.showScanBanner = true;
  return s;
}

/** Category of a part: the owner's choice, else the default for its kind of work, else Unsorted. */
export function catForPart(S, task, part) {
  const e = S.tasks[task.id];
  const pick = e && e.partCats && (e.partCats[part.key] || e.partCats["*"]);
  if (pick && pick.cat) { const c = S.cats.find((x) => x.id === pick.cat); if (c) return c; }
  const b = S.cats.find((x) => x.builtin === part.action);
  return b || S.cats.find((x) => x.builtin === "unsorted") || S.cats[0];
}
export const isManual = (S, task, part) => { const e = S.tasks[task.id]; return !!(e && e.partCats && (e.partCats[part.key] || e.partCats["*"])?.manual); };

/** Re-create any missing default categories. Returns how many were added. */
export function ensureDefaults(S) {
  let n = 0;
  const unsortedIdx = () => S.cats.findIndex((c) => c.builtin === "unsorted");
  for (const d of DEFAULT_CATS) {
    if (S.cats.some((c) => c.builtin === d.builtin)) continue;
    const c = { ...d, visible: true, id: S.cats.some((x) => x.id === d.id) ? d.id + "-" + Date.now().toString(36) : d.id };
    const at = unsortedIdx();
    if (at >= 0) S.cats.splice(at, 0, c); else S.cats.push(c);
    n++;
  }
  return n;
}
