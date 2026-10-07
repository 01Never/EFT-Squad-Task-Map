// @ts-check
// Squad (page side): what to share, who shows, and every text about friends. Plain functions
// only: no DOM, no network. Everything a friend sends is untrusted: names are escaped where they
// are drawn, and colours go through safeFriendColor() before they reach a style or an SVG attribute.
// The server's contract is internal/features/squad/README.md.
import {
  partsOfTask,
  isTaskOnMap,
  isPartOnMap,
  isPartDone,
  partProgressPercent,
  requiredObjectives,
  tickCount,
  tickTarget,
  isObjectiveDone,
} from "../tasks/rules.js";
import { shareableKeyring } from "../keys/rules.js";

/** @import { SavedState, Task, Part, Stroke, SquadView, SquadFriend, MyShare, FriendPrefs } from "../../app/types.js" */

// ---------------------------------------------------------------- numbers the server enforces

// The server drops a share that breaks these (internal/features/squad/rules.go), so the page
// never sends more than they allow.
const MAX_SHARED_MAPS = 64;
const MAX_STROKES_PER_MAP = 5000;
const MAX_POINTS_PER_STROKE = 10000;
const MAX_STROKE_WIDTH = 1000;
const MAX_COORDINATE = 1e6;
const MAX_SHARED_TASKS = 2000;
const MAX_TICKS_PER_TASK = 200;
const MAX_TICK_COUNT = 100000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
// The game's own task and objective ids; the server refuses any other id in a share.
const GAME_ID = /^[0-9a-f]{24}$/;
const STROKE_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Used when a stroke's colour isn't one the server accepts (it never happens with the colour picker).
const FALLBACK_STROKE_COLOR = "#ff4d4d";

// ---------------------------------------------------------------- friends: colour, name, status

// A friend's colour must be exactly #rrggbb. Anything else (a friend running a modified copy
// could send any text) is drawn in this neutral colour, so it can never reach a style as code.
export const NEUTRAL_FRIEND_COLOR = "#8f8d80";
const STRICT_COLOR = /^#[0-9a-fA-F]{6}$/;

// The longest name the server accepts; used here only to cut text that is somehow longer.
const MAX_NAME_LENGTH = 32;
const UNKNOWN_FRIEND_NAME = "Friend";
const NO_NAME_TEXT = "(no name)";
// Direction overrides and invisible characters: one name must not be able to reorder the text
// around it, or look empty while not being empty.
// The zero-width joiner and non-joiner (U+200C, U+200D) stay: emoji sequences and some names need
// them. A name of only those (and spaces) is shown as "(no name)".
const BIDI_AND_INVISIBLE = /[\u200b\u200e\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
const ONLY_JOINERS_AND_SPACES = /^[\u200c\u200d\s]*$/;

/**
 * Own-property read: a friend can send any key, including "toString" or "__proto__", and those
 * must never find something on Object.prototype.
 * @param {any} object
 * @param {string} key
 * @returns {any}
 */
export function ownValue(object, key) {
  if (!object || typeof object !== "object") return undefined;
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

/**
 * A colour that is safe to put in a style or an SVG attribute.
 * @param {unknown} color
 * @returns {string} the colour in lower case when it is exactly #rrggbb, else the neutral colour
 */
export function safeFriendColor(color) {
  if (typeof color === "string" && STRICT_COLOR.test(color)) return color.toLowerCase();
  return NEUTRAL_FRIEND_COLOR;
}

/**
 * A friend's name as shown: text only, control, direction and zero-width characters removed, at
 * most 32 characters (not UTF-16 units), "(no name)" when nothing is left.
 * (It is still escaped wherever it goes into HTML.)
 * @param {unknown} name
 */
export function friendDisplayName(name) {
  if (typeof name !== "string") return UNKNOWN_FRIEND_NAME;
  const cleaned = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").replace(BIDI_AND_INVISIBLE, "").trim();
  const cut = Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join("").trim();
  return ONLY_JOINERS_AND_SPACES.test(cut) ? NO_NAME_TEXT : cut;
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * "just now", "5 min", "2 h", "3 d": how long ago a friend was last seen.
 * @param {number} lastSeenMs ms since 1970
 * @param {number} nowMs
 */
export function lastSeenAgo(lastSeenMs, nowMs) {
  const elapsed = Math.max(0, nowMs - lastSeenMs);
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h`;
  return `${Math.floor(elapsed / DAY_MS)} d`;
}

/**
 * The chip's status text: "online", or "last seen 2 h" (just "offline" when no time is known).
 * @param {SquadFriend} friend
 * @param {number} nowMs
 */
export function friendStatusText(friend, nowMs) {
  if (friend.online) return "online";
  if (!friend.lastSeen) return "offline";
  const ago = lastSeenAgo(friend.lastSeen, nowMs);
  return ago === "just now" ? "last seen just now" : `last seen ${ago}`;
}

// ---------------------------------------------------------------- what you choose per friend

// Drawings are shown by default (that is why you joined); tasks only after you switch them on.
/** @type {FriendPrefs} */
const DEFAULT_FRIEND_PREFS = Object.freeze({ drawings: true, tasks: false });

/**
 * Your two choices for a friend. A saved file without a `squad` block (every file before 2.7.0)
 * simply gets the defaults; nothing is written until you change a toggle.
 * @param {SavedState} saved
 * @param {string} playerId
 * @returns {FriendPrefs}
 */
export function friendPrefsOf(saved, playerId) {
  const stored = ownValue(saved.squad && saved.squad.friends, playerId);
  return {
    drawings: stored && typeof stored.drawings === "boolean" ? stored.drawings : DEFAULT_FRIEND_PREFS.drawings,
    tasks: stored && typeof stored.tasks === "boolean" ? stored.tasks : DEFAULT_FRIEND_PREFS.tasks,
  };
}

/**
 * Remember one choice for a friend, creating the `squad` block the first time.
 * @param {SavedState} saved
 * @param {string} playerId
 * @param {"drawings" | "tasks"} choice
 * @param {boolean} isOn
 */
export function setFriendPref(saved, playerId, choice, isOn) {
  const squad = (saved.squad = saved.squad || { friends: {} });
  squad.friends = squad.friends || {};
  const prefs = { ...friendPrefsOf(saved, playerId), [choice]: isOn };
  // defineProperty, so an id like "__proto__" becomes a plain key instead of changing the object
  Object.defineProperty(squad.friends, playerId, { value: prefs, enumerable: true, writable: true, configurable: true });
}

/**
 * Whether "Shared with squad" is on (also off for a file without the field).
 * @param {SavedState} saved
 */
export function isSharedOnlyFilterOn(saved) {
  return !!(saved.squad && saved.squad.sharedOnly);
}

/**
 * @param {SavedState} saved
 * @param {boolean} isOn
 */
export function setSharedOnlyFilter(saved, isOn) {
  const squad = (saved.squad = saved.squad || { friends: {} });
  squad.sharedOnly = isOn;
}

// ---------------------------------------------------------------- which friends show

/**
 * Friends whose drawings you want to see.
 * @param {SquadFriend[]} friends
 * @param {SavedState} saved
 */
export function friendsWithDrawingsOn(friends, saved) {
  return friends.filter((friend) => friendPrefsOf(saved, friend.playerId).drawings);
}

/**
 * Friends whose tasks you want to see and who share them (their tasks aren't null).
 * @param {SquadFriend[]} friends
 * @param {SavedState} saved
 */
export function friendsWithTasksOn(friends, saved) {
  return friends.filter((friend) => friendPrefsOf(saved, friend.playerId).tasks && friendTasksOf(friend) !== null);
}

/**
 * A friend's shared tasks, or null when they don't share them (or nothing arrived yet).
 * @param {SquadFriend} friend
 * @returns {Record<string, { ticks?: Record<string, true | number>, pct?: number }> | null}
 */
export function friendTasksOf(friend) {
  const tasks = friend.share && friend.share.tasks;
  return tasks && typeof tasks === "object" ? tasks : null;
}

/**
 * Of the friends you show, the ones who also have this task active.
 * @param {string} taskId
 * @param {SquadFriend[]} friendsWithTasks
 */
export function friendsAlsoDoing(taskId, friendsWithTasks) {
  return friendsWithTasks.filter((friend) => !!ownValue(friendTasksOf(friend), taskId));
}

/**
 * "Also: Mike, Sam", or "" when nobody is.
 * @param {SquadFriend[]} friends
 */
export function alsoText(friends) {
  if (!friends.length) return "";
  return "Also: " + friends.map((friend) => friendDisplayName(friend.name)).join(", ");
}

/**
 * A friend's progress on one part of a task, as the popup shows it: "✓" when they finished the
 * part, "2/5" for a single objective (kills, items), else "1/3" objectives done.
 * @param {Part} part
 * @param {Record<string, true | number>} friendTicks
 * @returns {{ isDone: boolean, text: string }}
 */
export function friendPartProgress(part, friendTicks) {
  if (isPartDone(part, friendTicks)) return { isDone: true, text: "✓" };
  const required = requiredObjectives(part);
  if (required.length === 1) {
    const objective = required[0];
    return { isDone: false, text: `${tickCount(objective, friendTicks)}/${tickTarget(objective)}` };
  }
  const doneCount = required.filter((objective) => isObjectiveDone(objective, friendTicks)).length;
  return { isDone: false, text: `${doneCount}/${required.length}` };
}

/**
 * "Mike 2/5 · Sam ✓": each friend who has the task, with their progress on this part.
 * @param {Part} part
 * @param {string} taskId
 * @param {SquadFriend[]} friends friends who have the task (friendsAlsoDoing)
 */
export function progressSummaryText(part, taskId, friends) {
  return progressPieces(part, taskId, friends)
    .map((piece) => `${piece.name} ${piece.text}`)
    .join(" · ");
}

/**
 * The parts of progressSummaryText, one per friend, so the page can isolate each name.
 * @param {Part} part
 * @param {string} taskId
 * @param {SquadFriend[]} friends
 * @returns {{ name: string, text: string }[]}
 */
export function progressPieces(part, taskId, friends) {
  return friends.map((friend) => {
    const ticks = ticksOfSharedTask(ownValue(friendTasksOf(friend), taskId));
    return { name: friendDisplayName(friend.name), text: friendPartProgress(part, ticks).text };
  });
}

/**
 * The ticks inside one shared task (`{ticks, pct}`), or {} when it isn't shaped like that.
 * @param {any} sharedTask
 * @returns {Record<string, true | number>}
 */
function ticksOfSharedTask(sharedTask) {
  const ticks = sharedTask && typeof sharedTask === "object" ? sharedTask.ticks : null;
  return ticks && typeof ticks === "object" ? ticks : {};
}

// ---------------------------------------------------------------- friends' other tasks

/**
 * What one friend has that you don't: their active tasks that exist in your game data, aren't on
 * your own list, and have something on this map. Shown read-only; they never touch your list.
 * @param {SquadFriend} friend
 * @param {SavedState} saved
 * @param {Record<string, Task>} taskById
 * @param {string} mapKey
 * @returns {{ task: Task, ticks: Record<string, true | number>, percent: number }[]}
 */
export function friendsOwnTasksOnMap(friend, saved, taskById, mapKey) {
  const shared = friendTasksOf(friend);
  if (!shared) return [];
  const found = [];
  for (const taskId of Object.keys(shared)) {
    const task = ownValue(taskById, taskId);
    const mine = ownValue(saved.tasks, taskId);
    const isOnMyList = mine && mine.active;
    if (!task || isOnMyList || !isTaskOnMap(task, mapKey)) continue;
    const ticks = ticksOfSharedTask(shared[taskId]);
    found.push({ task, ticks, percent: wholeTaskPercent(task, ticks) });
  }
  return found.sort((first, second) => first.task.name.localeCompare(second.task.name));
}

/**
 * The parts of a friend's task that are still open for them and have something on this map.
 * @param {Task} task
 * @param {Record<string, true | number>} friendTicks
 * @param {string} mapKey
 * @returns {Part[]}
 */
export function openPartsOnMap(task, friendTicks, mapKey) {
  return partsOfTask(task, false).filter(
    (part) => isPartOnMap(part, mapKey, task) && !isPartDone(part, friendTicks),
  );
}

/**
 * The whole task's progress in whole percent, from a set of ticks.
 * @param {Task} task
 * @param {Record<string, true | number>} ticks
 */
function wholeTaskPercent(task, ticks) {
  return partProgressPercent(partsOfTask(task, true)[0], ticks);
}

// ---------------------------------------------------------------- my share

/**
 * What you send your friends (PUT /api/squad/share): all your drawings; when "Share my tasks" is
 * on, `{ticks, pct}` for each active task; when "Share my keys" is on (ticket 09), your key list
 * per map. Nothing else leaves your saved data. Anything the server would refuse is left out, so
 * one odd stroke never blocks the whole share.
 * @param {SavedState} saved
 * @param {Record<string, Task>} taskById
 * @param {boolean} shareTasks
 * @param {boolean} [shareKeys]
 * @returns {MyShare}
 */
export function buildMyShare(saved, taskById, shareTasks, shareKeys = false) {
  return {
    draw: shareableDrawings(saved.draw),
    tasks: shareTasks ? shareableTasks(saved, taskById) : null,
    keys: shareKeys ? shareableKeyring(saved) : null,
  };
}

/**
 * @param {Record<string, Stroke[]>} draw
 * @returns {Record<string, Stroke[]>}
 */
function shareableDrawings(draw) {
  /** @type {Record<string, Stroke[]>} */
  const shared = {};
  for (const mapKey of Object.keys(draw || {})) {
    if (Object.keys(shared).length >= MAX_SHARED_MAPS) break;
    if (!SAFE_ID.test(mapKey)) continue;
    const strokes = (Array.isArray(draw[mapKey]) ? draw[mapKey] : []).filter(isShareableStroke).slice(-MAX_STROKES_PER_MAP);
    if (strokes.length) shared[mapKey] = strokes.map(strokeForShare);
  }
  return shared;
}

/** @param {Stroke} stroke */
function isShareableStroke(stroke) {
  if (!stroke || !Array.isArray(stroke.pts)) return false;
  if (stroke.pts.length < 1 || stroke.pts.length > MAX_POINTS_PER_STROKE) return false;
  if (!isNumberWithin(stroke.w, 0, MAX_STROKE_WIDTH)) return false;
  return stroke.pts.every(
    (point) =>
      Array.isArray(point) &&
      isNumberWithin(point[0], -MAX_COORDINATE, MAX_COORDINATE) &&
      isNumberWithin(point[1], -MAX_COORDINATE, MAX_COORDINATE),
  );
}

/**
 * Only the three fields the share has; a colour the server wouldn't accept becomes red.
 * @param {Stroke} stroke
 * @returns {Stroke}
 */
function strokeForShare(stroke) {
  const color = STROKE_COLOR.test(stroke.c) ? stroke.c : FALLBACK_STROKE_COLOR;
  return { c: color, w: stroke.w, pts: stroke.pts.map((point) => [point[0], point[1]]) };
}

/**
 * @param {SavedState} saved
 * @param {Record<string, Task>} taskById
 * @returns {Record<string, { ticks: Record<string, true | number>, pct: number }>}
 */
function shareableTasks(saved, taskById) {
  const shared = {};
  for (const taskId of Object.keys(saved.tasks)) {
    if (Object.keys(shared).length >= MAX_SHARED_TASKS) break;
    const task = ownValue(taskById, taskId);
    if (!task || !saved.tasks[taskId].active || !GAME_ID.test(taskId)) continue;
    const ticks = shareableTicks(task, saved.ticks);
    shared[taskId] = { ticks, pct: wholeTaskPercent(task, saved.ticks) };
  }
  return shared;
}

/**
 * The ticks of this task's objectives: `true`, or a whole count above 0.
 * @param {Task} task
 * @param {Record<string, true | number>} ticks
 */
function shareableTicks(task, ticks) {
  /** @type {Record<string, true | number>} */
  const shared = {};
  for (const objective of task.objs) {
    if (Object.keys(shared).length >= MAX_TICKS_PER_TASK) break;
    if (!GAME_ID.test(objective.id)) continue;
    const tick = ownValue(ticks, objective.id);
    if (tick === true) {
      shared[objective.id] = true;
    } else if (typeof tick === "number" && tick >= 1 && tick <= MAX_TICK_COUNT) {
      shared[objective.id] = Math.floor(tick);
    }
  }
  return shared;
}

/**
 * @param {unknown} value
 * @param {number} lowest
 * @param {number} highest
 */
function isNumberWithin(value, lowest, highest) {
  return typeof value === "number" && Number.isFinite(value) && value >= lowest && value <= highest;
}

/**
 * Text that is the same exactly when the share's content is the same, so an unchanged share is
 * never sent again.
 * @param {MyShare} share
 */
export function shareFingerprint(share) {
  return JSON.stringify(share);
}

/**
 * Whether the page should send its share at start-up: only when joined and the server has never
 * had one from this player (rev 0), e.g. right after joining on another page.
 * @param {SquadView | null} view
 */
export function shouldSendShareAtStart(view) {
  return !!view && view.settings.joined && view.me.rev === 0;
}

// ---------------------------------------------------------------- what changed between two views

/**
 * @typedef {object} SquadChange What a new `squad` event changed.
 * @property {boolean} chipsChanged someone's name, colour, online state (or "last seen"), or who is in the squad
 * @property {boolean} settingsChanged the status line, or your own profile / settings
 * @property {string[]} drawingsChanged friends whose strokes on the open map (or colour) changed
 * @property {string[]} tasksChanged friends whose shared tasks, name or colour changed
 * @property {string[]} [keysChanged] friends whose shared key lists changed (ticket 09)
 */

/**
 * What a new `squad` event changed compared with the view before it, so the page redraws only
 * that.
 * @param {SquadView | null} before
 * @param {SquadView} after
 * @param {string | null} mapKey the open map, or null
 * @returns {SquadChange}
 */
export function describeSquadChange(before, after, mapKey) {
  if (!before) return everythingChanged(after, mapKey);
  const change = { chipsChanged: false, settingsChanged: false, drawingsChanged: [], tasksChanged: [], keysChanged: [] };
  const own = (view) => JSON.stringify([view.status, view.me, view.settings]);
  change.settingsChanged = own(before) !== own(after);
  const friendsBefore = new Map(before.friends.map((friend) => [friend.playerId, friend]));
  const friendsAfter = new Map(after.friends.map((friend) => [friend.playerId, friend]));
  for (const playerId of new Set([...friendsBefore.keys(), ...friendsAfter.keys()])) {
    compareFriend(change, friendsBefore.get(playerId), friendsAfter.get(playerId), mapKey);
  }
  return change;
}

/**
 * Everything changed (the page had no earlier view).
 * @param {SquadView} after
 * @param {string | null} mapKey
 * @returns {SquadChange}
 */
function everythingChanged(after, mapKey) {
  const ids = after.friends.map((friend) => friend.playerId);
  return { chipsChanged: true, settingsChanged: true, drawingsChanged: mapKey ? ids : [], tasksChanged: ids, keysChanged: ids };
}

/**
 * Add what differs about one friend to `change`.
 * @param {SquadChange} change
 * @param {SquadFriend | undefined} before
 * @param {SquadFriend | undefined} after
 * @param {string | null} mapKey
 */
function compareFriend(change, before, after, mapKey) {
  const playerId = (before || after).playerId;
  if (!before || !after) {
    change.chipsChanged = true;
    if (mapKey) change.drawingsChanged.push(playerId);
    change.tasksChanged.push(playerId);
    change.keysChanged.push(playerId);
    return;
  }
  const hasNewLook = before.name !== after.name || before.color !== after.color;
  const hasNewPresence = before.online !== after.online || (!after.online && before.lastSeen !== after.lastSeen);
  if (hasNewLook || hasNewPresence) change.chipsChanged = true;
  if (hasNewLook) change.tasksChanged.push(playerId);
  if (before.color !== after.color && mapKey) change.drawingsChanged.push(playerId);
  if (!hasShareChanged(before, after)) return;
  if (mapKey && !change.drawingsChanged.includes(playerId)) {
    const drawingsBefore = JSON.stringify(ownValue(before.share?.draw, mapKey) || null);
    const drawingsAfter = JSON.stringify(ownValue(after.share?.draw, mapKey) || null);
    if (drawingsBefore !== drawingsAfter) change.drawingsChanged.push(playerId);
  }
  if (!change.tasksChanged.includes(playerId)) {
    const tasksBefore = JSON.stringify(before.share?.tasks || null);
    const tasksAfter = JSON.stringify(after.share?.tasks || null);
    if (tasksBefore !== tasksAfter) change.tasksChanged.push(playerId);
  }
  const keysBefore = JSON.stringify(before.share?.keys || null);
  const keysAfter = JSON.stringify(after.share?.keys || null);
  if (keysBefore !== keysAfter) change.keysChanged.push(playerId);
}

/**
 * Whether a friend's share is a new one (the server's own rule: rev or time differ, not "higher").
 * @param {SquadFriend} before
 * @param {SquadFriend} after
 */
function hasShareChanged(before, after) {
  if (!before.share || !after.share) return !!before.share !== !!after.share;
  return before.share.rev !== after.share.rev || before.share.updatedAt !== after.share.updatedAt;
}
