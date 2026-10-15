// Tests for the squad's page rules (rules.js): what is shared, who shows, the texts, and what a
// new `squad` event changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshState, migrateSavedData, blankTaskEntry } from "../../app/saved-data.js";
import { partsOfTask, togglePinnedTask, isRowListed, countMyOpenTasks, countSquadOnlyTasks } from "../tasks/rules.js";
import {
  NEUTRAL_FRIEND_COLOR,
  safeFriendColor,
  friendDisplayName,
  lastSeenAgo,
  friendStatusText,
  friendPrefsOf,
  setFriendPref,
  isSharedOnlyFilterOn,
  setSharedOnlyFilter,
  isSharedOnlyFilterInEffect,
  isHiddenBySharedOnlyFilter,
  friendsWithDrawingsOn,
  friendsWithTasksOn,
  friendsAlsoDoing,
  alsoText,
  friendPartProgress,
  progressSummaryText,
  friendsOwnTasksOnMap,
  openPartsOnMap,
  buildMyShare,
  shareFingerprint,
  shouldSendShareAtStart,
  describeSquadChange,
  progressPieces,
  friendTasksOf,
  friendTasksButtonTitle,
  friendBoxes,
  friendOnlyRowsOnMap,
} from "./rules.js";

// ---------------------------------------------------------------- fixtures

function objective(id, extra = {}) {
  return { id, type: "visit", d: "Visit " + id, n: 0, zones: [{ m: "customs", x: 0, z: 0 }], poss: [], maps: ["customs"], ...extra };
}

// Each test task has its own id: the page remembers a task's parts by id.
const killScavs = { id: "aaaaaaaaaaaaaaaaaaaa0001", name: "Kill Scavs", trader: "Prapor", map: "customs", objs: [objective("bbbbbbbbbbbbbbbbbbbb0001", { type: "shoot", d: "Eliminate Scavs", n: 5, targets: ["Any"] })] };
const visitTwoPlaces = { id: "aaaaaaaaaaaaaaaaaaaa0002", name: "Visit two places", trader: "Skier", map: "customs", objs: [objective("bbbbbbbbbbbbbbbbbbbb000a"), objective("bbbbbbbbbbbbbbbbbbbb000b")] };
const onlyOnWoods = { id: "aaaaaaaaaaaaaaaaaaaa0003", name: "Woods only", trader: "Jaeger", map: "woods", objs: [objective("bbbbbbbbbbbbbbbbbbbb000c", { zones: [{ m: "woods", x: 0, z: 0 }], maps: ["woods"] })] };
const taskById = { [killScavs.id]: killScavs, [visitTwoPlaces.id]: visitTwoPlaces, [onlyOnWoods.id]: onlyOnWoods };

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);

function friend(playerId, name, extra = {}) {
  return { playerId, name, color: "#ff922b", online: true, lastSeen: NOW, share: null, ...extra };
}

function friendSharing(playerId, name, tasks, extra = {}) {
  return friend(playerId, name, { share: { rev: 1, updatedAt: 1, draw: {}, tasks }, ...extra });
}

function savedWithActive(...tasks) {
  const saved = freshState();
  for (const task of tasks) saved.modes.regular.tasks[task.id] = { active: true };
  return saved;
}

// ---------------------------------------------------------------- what a friend sends is untrusted

test("a friend's colour is used only when it is exactly #rrggbb", () => {
  assert.equal(safeFriendColor("#FF922B"), "#ff922b");
  assert.equal(safeFriendColor("#ff922b"), "#ff922b");
  for (const bad of ["red", "#fff", "#ff922b;background:url(x)", "url(javascript:1)", "#ff922bff", "", null, undefined, 5, { a: 1 }]) {
    assert.equal(safeFriendColor(bad), NEUTRAL_FRIEND_COLOR, `${JSON.stringify(bad)} falls back`);
  }
});

test("a friend's name is cut to 32 characters, loses control characters and is never empty", () => {
  assert.equal(friendDisplayName("  Mike\u0007 "), "Mike");
  assert.equal(friendDisplayName("x".repeat(80)).length, 32);
  assert.equal(friendDisplayName(""), "(no name)");
  assert.equal(friendDisplayName(42), "Friend");
  // Markup stays text here; it is escaped where it is drawn.
  assert.equal(friendDisplayName("<b>Mike</b>"), "<b>Mike</b>");
});

// ---------------------------------------------------------------- the chips

test("a friend shows 'online', or 'last seen' with how long ago", () => {
  assert.equal(friendStatusText(friend("a", "Mike"), NOW), "online");
  const offline = (minutesAgo) => friend("a", "Mike", { online: false, lastSeen: NOW - minutesAgo * 60_000 });
  assert.equal(friendStatusText(offline(0), NOW), "last seen just now");
  assert.equal(friendStatusText(offline(5), NOW), "last seen 5 min");
  assert.equal(friendStatusText(offline(120), NOW), "last seen 2 h");
  assert.equal(friendStatusText(offline(3 * 24 * 60), NOW), "last seen 3 d");
  assert.equal(friendStatusText(friend("a", "Mike", { online: false, lastSeen: 0 }), NOW), "offline");
  assert.equal(lastSeenAgo(NOW + 5000, NOW), "just now", "a clock a little behind is still 'just now'");
});

test("drawings and tasks are shown by default (ticket 26); the choices are remembered per friend", () => {
  const saved = freshState();
  assert.deepEqual(friendPrefsOf(saved, "mike"), { drawings: true, tasks: true });
  setFriendPref(saved, "mike", "tasks", false);
  setFriendPref(saved, "sam", "drawings", false);
  assert.deepEqual(friendPrefsOf(saved, "mike"), { drawings: true, tasks: false });
  assert.deepEqual(friendPrefsOf(saved, "sam"), { drawings: false, tasks: true });
  assert.deepEqual(friendPrefsOf(saved, "someone-new"), { drawings: true, tasks: true });
});

test("a ☰ Tasks switched off and saved before ticket 26 stays off; one never touched is now on", () => {
  const saved = migrateSavedData({
    version: 2,
    cats: [],
    tasks: {},
    prefs: {},
    squad: { friends: { mike: { drawings: true, tasks: false }, sam: { drawings: true } } },
  });
  assert.equal(friendPrefsOf(saved, "mike").tasks, false, "explicit off kept");
  assert.equal(friendPrefsOf(saved, "sam").tasks, true, "no saved choice: the new default");
  assert.equal(friendPrefsOf(saved, "kim").tasks, true, "a friend you never set");
});

test("a saved file from before the squad is read with the defaults and is not changed by reading it", () => {
  const older = migrateSavedData({ version: 2, cats: [], tasks: {}, prefs: {} });
  assert.equal("squad" in older, false, "no squad block is invented");
  assert.deepEqual(friendPrefsOf(older, "mike"), { drawings: true, tasks: true });
  assert.equal(isSharedOnlyFilterOn(older), false);
  assert.equal("squad" in older, false, "reading choices writes nothing");
  setSharedOnlyFilter(older, true);
  assert.equal(isSharedOnlyFilterOn(older), true);
});

test("a squad block that lost a field is read with the defaults", () => {
  const saved = migrateSavedData({ version: 2, cats: [], tasks: {}, prefs: {}, squad: { friends: { mike: { tasks: false } } } });
  assert.deepEqual(friendPrefsOf(saved, "mike"), { drawings: true, tasks: false });
  const hollow = migrateSavedData({ version: 2, cats: [], tasks: {}, prefs: {}, squad: {} });
  assert.deepEqual(friendPrefsOf(hollow, "mike"), { drawings: true, tasks: true });
});

test("which friends show: drawings by their toggle; tasks by their toggle and only when they share", () => {
  const saved = freshState();
  const mike = friend("mike", "Mike");
  const sam = friendSharing("sam", "Sam", {});
  const kim = friendSharing("kim", "Kim", {});
  setFriendPref(saved, "kim", "drawings", false);
  setFriendPref(saved, "kim", "tasks", false);
  // Mike's and Sam's ☰ Tasks are on (the default); Mike shares no tasks (null)
  const friends = [mike, sam, kim];
  assert.deepEqual(friendsWithDrawingsOn(friends, saved).map((one) => one.name), ["Mike", "Sam"]);
  assert.deepEqual(friendsWithTasksOn(friends, saved, "regular").map((one) => one.name), ["Sam"]);
});

// ---------------------------------------------------------------- the "Shared with squad" filter

test("'Shared with squad' is off in a new file and in a file from before the squad", () => {
  assert.equal(isSharedOnlyFilterOn(freshState()), false);
  assert.equal(isSharedOnlyFilterOn(migrateSavedData({ version: 2, cats: [], tasks: {}, prefs: {} })), false);
  assert.equal(isSharedOnlyFilterOn(migrateSavedData({ version: 2, cats: [], tasks: {}, prefs: {}, squad: {} })), false);
});

test("'Shared with squad' hides none of your tasks while no friend whose tasks you show shares them (2.8.1)", () => {
  // The owner's 2.8.0 bug: the filter was on, the only friend ("Player", last seen 1 h) shared no
  // tasks, and every row and marker on every map was gone.
  const saved = savedWithActive(killScavs, visitTwoPlaces);
  setSharedOnlyFilter(saved, true);
  const player = friend("0123456789abcdef", "Player", { online: false, lastSeen: NOW - 60 * 60_000 });
  const sam = friendSharing("fedcba9876543210", "Sam", { [killScavs.id]: { ticks: {}, pct: 0 } });
  // Player's ☰ Tasks is on (the default), but Player shares nothing
  setFriendPref(saved, sam.playerId, "tasks", false); // Sam shares, but you switched his ☰ Tasks off
  const shown = friendsWithTasksOn([player, sam], saved, "regular");
  assert.equal(shown.length, 0);
  assert.equal(isSharedOnlyFilterInEffect(saved, shown), false);
  assert.equal(isHiddenBySharedOnlyFilter(killScavs.id, saved, shown), false);
  assert.equal(isHiddenBySharedOnlyFilter(visitTwoPlaces.id, saved, shown), false);
  assert.equal(isSharedOnlyFilterOn(saved), true, "your choice is kept for when a friend shares again");
});

test("with a shown friend sharing tasks, 'Shared with squad' keeps only the tasks they also have", () => {
  const saved = savedWithActive(killScavs, visitTwoPlaces);
  const sam = friendSharing("fedcba9876543210", "Sam", { [killScavs.id]: { ticks: {}, pct: 0 } });
  setFriendPref(saved, sam.playerId, "tasks", true);
  const shown = friendsWithTasksOn([sam], saved, "regular");
  assert.equal(isSharedOnlyFilterInEffect(saved, shown), false, "off until you switch it on");
  assert.equal(isHiddenBySharedOnlyFilter(visitTwoPlaces.id, saved, shown), false);

  setSharedOnlyFilter(saved, true);
  assert.equal(isSharedOnlyFilterInEffect(saved, shown), true);
  assert.equal(isHiddenBySharedOnlyFilter(killScavs.id, saved, shown), false, "Sam has it too");
  assert.equal(isHiddenBySharedOnlyFilter(visitTwoPlaces.id, saved, shown), true, "only yours");
});

// ---------------------------------------------------------------- shared tasks

test("'Also: Mike, Sam' names the shown friends who have the task", () => {
  const mike = friendSharing("mike", "Mike", { [killScavs.id]: { ticks: {}, pct: 0 } });
  const sam = friendSharing("sam", "Sam", { [killScavs.id]: { ticks: {}, pct: 0 }, [visitTwoPlaces.id]: { ticks: {}, pct: 0 } });
  const kim = friendSharing("kim", "Kim", { [visitTwoPlaces.id]: { ticks: {}, pct: 0 } });
  const shown = [mike, sam, kim];
  assert.equal(alsoText(friendsAlsoDoing(killScavs.id, shown)), "Also: Mike, Sam");
  assert.equal(alsoText(friendsAlsoDoing(visitTwoPlaces.id, shown)), "Also: Sam, Kim");
  assert.equal(alsoText(friendsAlsoDoing(onlyOnWoods.id, shown)), "");
});

test("a friend's progress on a part: a count for one objective, objectives done for several, a tick when finished", () => {
  const [killsPart] = partsOfTask(killScavs);
  const [visitPart] = partsOfTask(visitTwoPlaces);
  assert.deepEqual(friendPartProgress(killsPart, { "bbbbbbbbbbbbbbbbbbbb0001": 2 }), { isDone: false, text: "2/5" });
  assert.deepEqual(friendPartProgress(killsPart, {}), { isDone: false, text: "0/5" });
  assert.deepEqual(friendPartProgress(killsPart, { "bbbbbbbbbbbbbbbbbbbb0001": 5 }), { isDone: true, text: "✓" });
  assert.deepEqual(friendPartProgress(visitPart, { "bbbbbbbbbbbbbbbbbbbb000a": true }), { isDone: false, text: "1/2" });
  assert.deepEqual(friendPartProgress(visitPart, { "bbbbbbbbbbbbbbbbbbbb000a": true, "bbbbbbbbbbbbbbbbbbbb000b": true }), { isDone: true, text: "✓" });
});

test("the popup line lists each friend with their progress: 'Mike 2/5 · Sam ✓'", () => {
  const [killsPart] = partsOfTask(killScavs);
  const mike = friendSharing("mike", "Mike", { [killScavs.id]: { ticks: { "bbbbbbbbbbbbbbbbbbbb0001": 2 }, pct: 40 } });
  const sam = friendSharing("sam", "Sam", { [killScavs.id]: { ticks: { "bbbbbbbbbbbbbbbbbbbb0001": 5 }, pct: 100 } });
  assert.equal(progressSummaryText(killsPart, killScavs.id, [mike, sam]), "Mike 2/5 · Sam ✓");
});

test("friends' other tasks: theirs, not on your list, with something on this map", () => {
  const saved = savedWithActive(killScavs);
  const mike = friendSharing("mike", "Mike", {
    [killScavs.id]: { ticks: {}, pct: 0 }, // you have it too: not "other"
    [visitTwoPlaces.id]: { ticks: { "bbbbbbbbbbbbbbbbbbbb000a": true }, pct: 50 },
    [onlyOnWoods.id]: { ticks: {}, pct: 0 }, // not on Customs
    "task-unknown-to-your-game-data": { ticks: {}, pct: 0 },
  });
  const found = friendsOwnTasksOnMap(mike, saved, "regular", taskById, "customs");
  assert.deepEqual(found.map((one) => one.task.id), [visitTwoPlaces.id]);
  assert.equal(found[0].percent, 50);
  assert.deepEqual(friendsOwnTasksOnMap(friend("sam", "Sam"), saved, taskById, "customs"), [], "no shared tasks, none shown");
});

test("a friend's finished part leaves the map; their open part stays", () => {
  const [visitPart] = partsOfTask(visitTwoPlaces);
  assert.deepEqual(openPartsOnMap(visitTwoPlaces, {}, "customs"), [visitPart]);
  assert.deepEqual(openPartsOnMap(visitTwoPlaces, { "bbbbbbbbbbbbbbbbbbbb000a": true, "bbbbbbbbbbbbbbbbbbbb000b": true }, "customs"), []);
  assert.deepEqual(openPartsOnMap(onlyOnWoods, {}, "customs"), []);
});

// ---------------------------------------------------------------- my share

function stroke(extra = {}) {
  return { c: "#ff4d4d", w: 2.5, pts: [[1, 2], [3, 4]], ...extra };
}

test("my share holds my drawings on every map, and no tasks while sharing is off", () => {
  const saved = freshState();
  saved.draw = { customs: [stroke()], woods: [stroke({ c: "#fff" })], empty: [] };
  const share = buildMyShare(saved, "regular", taskById, false);
  assert.deepEqual(Object.keys(share.draw), ["customs", "woods"], "a map with no lines is left out");
  assert.equal(share.tasks, null);
  assert.deepEqual(share.draw.customs, [stroke()]);
});

test("my share holds my active tasks with their ticks and progress when sharing is on", () => {
  const saved = savedWithActive(killScavs, visitTwoPlaces);
  saved.modes.regular.tasks[onlyOnWoods.id] = { active: false };
  saved.modes.regular.tasks["task-not-in-game-data"] = { active: true };
  saved.modes.regular.ticks = { "bbbbbbbbbbbbbbbbbbbb0001": 2, "bbbbbbbbbbbbbbbbbbbb000a": true, "bbbbbbbbbbbbbbbbbbbb000c": true, "not-an-objective-of-these": true };
  const share = buildMyShare(saved, "regular", taskById, true);
  assert.deepEqual(share.tasks, {
    [killScavs.id]: { ticks: { "bbbbbbbbbbbbbbbbbbbb0001": 2 }, pct: 40 },
    [visitTwoPlaces.id]: { ticks: { "bbbbbbbbbbbbbbbbbbbb000a": true }, pct: 50 },
  });
});

test("my share never carries anything but the game mode, drawings and tasks", () => {
  const saved = savedWithActive(killScavs);
  saved.modes.regular.have = { "some-item": 3 };
  saved.cats = [{ id: "secret-category" }];
  saved.prefs = { customs: { secret: true } };
  const text = JSON.stringify(buildMyShare(saved, "regular", taskById, true));
  for (const privateThing of ["some-item", "secret-category", "secret", "have", "cats", "prefs", "dcolor"]) {
    assert.equal(text.includes(privateThing), false, privateThing);
  }
});

test("a stroke the server would refuse is left out, and the rest is still sent", () => {
  const saved = freshState();
  saved.draw = {
    customs: [
      stroke(),
      stroke({ pts: [] }),
      stroke({ pts: [[1, "x"]] }),
      stroke({ pts: [[1e9, 0]] }),
      stroke({ w: -1 }),
      stroke({ w: 5000 }),
      stroke({ c: "javascript:1" }), // sent, but in a colour the server accepts
    ],
    "bad map key!": [stroke()],
  };
  const share = buildMyShare(saved, "regular", taskById, false);
  assert.deepEqual(Object.keys(share.draw), ["customs"]);
  assert.equal(share.draw.customs.length, 2);
  assert.equal(share.draw.customs[1].c, "#ff4d4d");
});

test("a stroke carries only its colour, width and points", () => {
  const saved = freshState();
  saved.draw = { customs: [{ ...stroke(), extra: "nope" }] };
  assert.deepEqual(Object.keys(buildMyShare(saved, "regular", taskById, false).draw.customs[0]).sort(), ["c", "pts", "w"]);
});

test("the same content gives the same fingerprint, so an unchanged share is not sent again", () => {
  const saved = savedWithActive(killScavs);
  const first = shareFingerprint(buildMyShare(saved, "regular", taskById, true));
  assert.equal(shareFingerprint(buildMyShare(saved, "regular", taskById, true)), first);
  saved.modes.regular.ticks["bbbbbbbbbbbbbbbbbbbb0001"] = 1;
  assert.notEqual(shareFingerprint(buildMyShare(saved, "regular", taskById, true)), first);
  assert.notEqual(shareFingerprint(buildMyShare(saved, "regular", taskById, false)), first, "turning sharing off is a change");
});

test("at start-up the share is sent only when joined and the server never had one", () => {
  const view = (joined, rev) => ({ settings: { joined, shareTasks: false }, me: { rev } });
  assert.equal(shouldSendShareAtStart(null), false);
  assert.equal(shouldSendShareAtStart(view(false, 0)), false);
  assert.equal(shouldSendShareAtStart(view(true, 7)), false);
  assert.equal(shouldSendShareAtStart(view(true, 0)), true);
});

// ---------------------------------------------------------------- what a squad event changed

function viewOf(friends, extra = {}) {
  return {
    me: { playerId: "me", name: "Me", color: "#4dabf7", rev: 1, updatedAt: 1 },
    settings: { joined: true, shareTasks: false },
    transport: "dev",
    status: { state: "connected", text: "Connected", friendsOnline: 1, friendsKnown: 1, problem: "" },
    friends,
    ...extra,
  };
}

function withDrawing(playerId, strokes, rev) {
  return friend(playerId, "Mike", { share: { rev, updatedAt: rev, draw: { customs: strokes }, tasks: null } });
}

test("a friend's new drawing on the open map redraws only that friend's lines", () => {
  const before = viewOf([withDrawing("mike", [stroke()], 1), withDrawing("sam", [stroke()], 1)]);
  const after = viewOf([withDrawing("mike", [stroke(), stroke({ pts: [[5, 5]] })], 2), withDrawing("sam", [stroke()], 1)]);
  assert.deepEqual(describeSquadChange(before, after, "customs"), {
    chipsChanged: false,
    settingsChanged: false,
    drawingsChanged: ["mike"],
    tasksChanged: [],
  });
});

test("a drawing on another map changes nothing on this one", () => {
  const before = viewOf([withDrawing("mike", [stroke()], 1)]);
  const after = viewOf([withDrawing("mike", [stroke()], 2)]);
  after.friends[0].share.draw = { woods: [stroke()] };
  assert.deepEqual(describeSquadChange(before, after, "woods").drawingsChanged, ["mike"]);
  assert.deepEqual(describeSquadChange(before, after, "streets").drawingsChanged, []);
});

test("undo (a stroke fewer) counts as a drawing change", () => {
  const before = viewOf([withDrawing("mike", [stroke(), stroke({ pts: [[5, 5]] })], 2)]);
  const after = viewOf([withDrawing("mike", [stroke()], 3)]);
  assert.deepEqual(describeSquadChange(before, after, "customs").drawingsChanged, ["mike"]);
});

test("a friend going offline redraws the chips only", () => {
  const before = viewOf([friend("mike", "Mike")]);
  const after = viewOf([friend("mike", "Mike", { online: false, lastSeen: NOW })]);
  const change = describeSquadChange(before, after, "customs");
  assert.equal(change.chipsChanged, true);
  assert.deepEqual(change.drawingsChanged, []);
  assert.deepEqual(change.tasksChanged, []);
});

test("a friend's new tasks are a task change; a friend's colour change redraws their lines and markers", () => {
  const before = viewOf([friendSharing("mike", "Mike", {})]);
  const withTasks = viewOf([friendSharing("mike", "Mike", { [killScavs.id]: { ticks: {}, pct: 0 } }, { share: { rev: 2, updatedAt: 2, draw: {}, tasks: { [killScavs.id]: { ticks: {}, pct: 0 } } } })]);
  assert.deepEqual(describeSquadChange(before, withTasks, "customs").tasksChanged, ["mike"]);
  const recoloured = viewOf([friendSharing("mike", "Mike", {}, { color: "#00ff00" })]);
  const change = describeSquadChange(before, recoloured, "customs");
  assert.equal(change.chipsChanged, true);
  assert.deepEqual(change.drawingsChanged, ["mike"]);
  assert.deepEqual(change.tasksChanged, ["mike"]);
});

test("a new friend or one who left changes the chips, lines and tasks", () => {
  const empty = viewOf([]);
  const withMike = viewOf([friend("mike", "Mike")]);
  const joined = describeSquadChange(empty, withMike, "customs");
  assert.deepEqual([joined.chipsChanged, joined.drawingsChanged, joined.tasksChanged], [true, ["mike"], ["mike"]]);
  const left = describeSquadChange(withMike, empty, "customs");
  assert.deepEqual([left.chipsChanged, left.drawingsChanged, left.tasksChanged], [true, ["mike"], ["mike"]]);
});

test("the status line and my own profile are 'settings'; the first view changes everything", () => {
  const before = viewOf([]);
  const connecting = viewOf([], { status: { ...before.status, text: "Connecting…" } });
  assert.equal(describeSquadChange(before, connecting, null).settingsChanged, true);
  assert.equal(describeSquadChange(before, viewOf([]), null).settingsChanged, false);
  const first = describeSquadChange(null, viewOf([friend("mike", "Mike")]), "customs");
  assert.deepEqual([first.chipsChanged, first.settingsChanged, first.drawingsChanged], [true, true, ["mike"]]);
  assert.deepEqual(describeSquadChange(null, viewOf([friend("mike", "Mike")]), null).drawingsChanged, [], "no map open, no lines to draw");
});

// ---------------------------------------------------------------- names that try to reorder or hide

test("a name loses direction overrides and zero-width characters, and is cut by characters", () => {
  assert.equal(friendDisplayName("\u202eevil\u202c Mike\u200b\u2066x\u2069\ufeff"), "evil Mikex");
  assert.equal(friendDisplayName("\u202e\u200b\u2060 \ufeff"), "(no name)");
  const emoji = "😀".repeat(40);
  assert.equal(friendDisplayName(emoji), "😀".repeat(32), "32 characters, not 32 UTF-16 units");
  assert.equal(friendDisplayName("W".repeat(32)), "W".repeat(32));
});

test("zero-width joiners stay (emoji and some names need them), but a name of only them is no name", () => {
  const family = "Sam \u{1F468}\u200d\u{1F469}\u200d\u{1F467}";
  assert.equal(friendDisplayName(family), family);
  assert.equal(friendDisplayName("\u200d \u200c"), "(no name)");
});

// ---------------------------------------------------------------- keys that are names on Object.prototype

const PROTOTYPE_KEYS = ["toString", "valueOf", "hasOwnProperty", "__proto__", "constructor"];

test("a friend's task ids named like Object.prototype members are ignored, not crashed on", () => {
  const saved = savedWithActive(killScavs);
  const [killsPart] = partsOfTask(killScavs);
  for (const key of PROTOTYPE_KEYS) {
    // JSON.parse makes "__proto__" a real own key, as a share coming off the wire does
    const tasks = JSON.parse(`{"${key}":{"ticks":{"${key}":3},"pct":10},"${visitTwoPlaces.id}":{"ticks":{"bbbbbbbbbbbbbbbbbbbb000a":true},"pct":50}}`);
    const mike = friend("mike", "Mike", { share: { rev: 1, updatedAt: 1, draw: {}, tasks } });
    const found = friendsOwnTasksOnMap(mike, saved, "regular", taskById, "customs");
    assert.deepEqual(found.map((one) => one.task.id), [visitTwoPlaces.id], `${key}: only the real task`);
    assert.deepEqual(friendsAlsoDoing(killScavs.id, [mike]), [], `${key}: does not have Kill Scavs`);
    assert.equal(progressSummaryText(killsPart, killScavs.id, [mike]), "Mike 0/5", `${key}: no progress on Kill Scavs`);
  }
});

test("asking for a task id like 'toString' finds nothing when the friend has no such task", () => {
  const mike = friendSharing("mike", "Mike", { [killScavs.id]: { ticks: {}, pct: 0 } });
  const [killsPart] = partsOfTask(killScavs);
  for (const key of PROTOTYPE_KEYS) {
    assert.deepEqual(friendsAlsoDoing(key, [mike]), [], key);
    assert.equal(progressSummaryText(killsPart, key, [mike]), "Mike 0/5", key);
  }
});

test("a friend's task entries that are not objects are skipped", () => {
  const sam = friendSharing("sam", "Sam", { [visitTwoPlaces.id]: null, [killScavs.id]: 5 });
  const found = friendsOwnTasksOnMap(sam, freshState(), "regular", taskById, "customs");
  assert.deepEqual(found.map((one) => one.task.id).sort(), [killScavs.id, visitTwoPlaces.id].sort());
});

test("the game's task lookup, even a plain object, does not answer for 'toString'", () => {
  const sam = friendSharing("sam", "Sam", JSON.parse('{"toString":{},"constructor":{},"valueOf":null}'));
  assert.deepEqual(friendsOwnTasksOnMap(sam, freshState(), "regular", taskById, "customs"), []);
});

test("objective ids named like Object.prototype members count as no progress", () => {
  for (const key of PROTOTYPE_KEYS) {
    const task = { id: "task-odd-" + key, name: "Odd", trader: "Prapor", map: "customs", objs: [objective(key, { type: "shoot", n: 5, targets: ["Any"] })] };
    const [part] = partsOfTask(task);
    assert.equal(friendPartProgress(part, {}).text, "0/5", `${key}: empty ticks`);
    assert.equal(friendPartProgress(part, JSON.parse(`{"${key}":2}`)).text, "2/5", `${key}: a real tick still counts`);
  }
});

test("a friend's choices are read and saved safely for ids like '__proto__' and 'constructor'", () => {
  for (const key of PROTOTYPE_KEYS) {
    const saved = freshState();
    assert.deepEqual(friendPrefsOf(saved, key), { drawings: true, tasks: true }, `${key}: defaults`);
    setFriendPref(saved, key, "tasks", false);
    assert.equal(friendPrefsOf(saved, key).tasks, false, `${key}: remembered`);
    assert.equal(Object.getPrototypeOf(saved.squad.friends), Object.prototype, `${key}: prototype untouched`);
  }
});

test("drawings under map keys like 'toString' don't break the share or the change check", () => {
  const stroke = { c: "#ff0000", w: 2, pts: [[0, 0], [1, 1]] };
  for (const key of PROTOTYPE_KEYS) {
    const saved = freshState();
    saved.draw = JSON.parse(`{"${key}":[${JSON.stringify(stroke)}],"customs":[${JSON.stringify(stroke)}]}`);
    assert.ok(Object.hasOwn(buildMyShare(saved, "regular", taskById, false).draw, "customs"));
    const before = viewOf([friend("mike", "Mike")]);
    const after = viewOf([friend("mike", "Mike", { share: { rev: 2, updatedAt: 2, draw: {}, tasks: null } })]);
    assert.deepEqual(describeSquadChange(before, after, key).drawingsChanged, [], `${key}: nothing drawn, no change`);
  }
});

test("progress pieces give each name and progress separately", () => {
  const [killsPart] = partsOfTask(killScavs);
  const mike = friendSharing("mike", "Mike", { [killScavs.id]: { ticks: { "bbbbbbbbbbbbbbbbbbbb0001": 2 }, pct: 40 } });
  assert.deepEqual(progressPieces(killsPart, killScavs.id, [mike]), [{ name: "Mike", text: "2/5" }]);
});

test("my share carries only the game's own ids (24 lowercase hex characters)", () => {
  const odd = { id: "toString", name: "Odd", trader: "Prapor", map: "customs", objs: [objective("bbbbbbbbbbbbbbbbbbbb000d"), objective("not-hex")] };
  const saved = savedWithActive(odd);
  saved.modes.regular.ticks = { bbbbbbbbbbbbbbbbbbbb000d: true, "not-hex": true };
  assert.deepEqual(buildMyShare(saved, "regular", { toString: odd }, true).tasks, {}, "a task with an odd id is left out");
  const task = { ...odd, id: "aaaaaaaaaaaaaaaaaaaa0009" };
  const saved2 = savedWithActive(task);
  saved2.modes.regular.ticks = saved.modes.regular.ticks;
  const shared = buildMyShare(saved2, "regular", { [task.id]: task }, true).tasks;
  assert.deepEqual(Object.keys(shared[task.id].ticks), ["bbbbbbbbbbbbbbbbbbbb000d"], "an odd objective id is left out");
});

// ---------------------------------------------------------------- game modes (ticket 22)

/** A friend sharing Kill Scavs, with their copy saying which game mode it's for (or nothing). */
function friendOnMode(playerId, name, mode) {
  const tasks = { [killScavs.id]: { ticks: { bbbbbbbbbbbbbbbbbbbb0001: 2 }, pct: 40 } };
  const share = { rev: 1, updatedAt: 1, draw: { customs: [stroke()] }, tasks };
  if (mode !== undefined) share.mode = mode;
  return friend(playerId, name, { share });
}

test("a friend's tasks show only when they're for your game mode, or their copy doesn't say", () => {
  const saved = freshState();
  const onPve = friendOnMode("mike", "Mike", "pve");
  const onSeason = friendOnMode("sam", "Sam", "pvp-season");
  const olderCopy = friendOnMode("kim", "Kim", undefined);
  const emptyMode = friendOnMode("lee", "Lee", "");
  const friends = [onPve, onSeason, olderCopy, emptyMode];
  for (const one of friends) setFriendPref(saved, one.playerId, "tasks", true);

  const shown = friendsWithTasksOn(friends, saved, "pvp-season");

  assert.deepEqual(shown.map((one) => one.name), ["Sam", "Kim", "Lee"]);
  assert.equal(friendTasksOf(onPve, "pvp-season"), null);
  assert.notEqual(friendTasksOf(onPve, "pve"), null);
  assert.deepEqual(friendsAlsoDoing(killScavs.id, shown).map((one) => one.name), ["Sam", "Kim", "Lee"]);
});

test("a friend on another game mode adds no tasks to your map, but their drawings still show", () => {
  const saved = freshState();
  const onPve = friendOnMode("mike", "Mike", "pve");
  assert.deepEqual(friendsOwnTasksOnMap(onPve, saved, "regular", taskById, "customs"), []);
  assert.deepEqual(friendsOwnTasksOnMap(onPve, saved, "pve", taskById, "customs").map((one) => one.task.id), [killScavs.id]);
  assert.deepEqual(friendsWithDrawingsOn([onPve], saved).map((one) => one.name), ["Mike"]);
});

test("friends' other tasks are compared with your list of the game mode shown", () => {
  const saved = freshState();
  saved.modes.pve.tasks[killScavs.id] = { active: true };
  const onPve = friendOnMode("mike", "Mike", "pve");
  assert.deepEqual(friendsOwnTasksOnMap(onPve, saved, "pve", taskById, "customs"), [], "you have it in PvE");
  const olderCopy = friendOnMode("kim", "Kim", undefined);
  assert.equal(friendsOwnTasksOnMap(olderCopy, saved, "regular", taskById, "customs").length, 1, "not in your PvP list");
});

test("my share says the game mode shown and carries that mode's tasks only", () => {
  const saved = freshState();
  saved.modes.pve.tasks[killScavs.id] = { active: true };
  saved.modes.pve.ticks = { bbbbbbbbbbbbbbbbbbbb0001: 2 };
  saved.modes["pvp-season"].tasks[visitTwoPlaces.id] = { active: true };

  const share = buildMyShare(saved, "pve", taskById, true);
  assert.equal(share.mode, "pve");
  assert.deepEqual(Object.keys(share.tasks), [killScavs.id]);

  const afterSwitching = buildMyShare(saved, "pvp-season", taskById, true);
  assert.equal(afterSwitching.mode, "pvp-season");
  assert.deepEqual(Object.keys(afterSwitching.tasks), [visitTwoPlaces.id]);
  assert.notEqual(shareFingerprint(afterSwitching), shareFingerprint(share), "switching mode sends the share again");
  assert.equal(buildMyShare(saved, "pve", taskById, false).mode, "pve", "the mode is sent even without tasks");
});

test("a friend switching game mode is a task change and redraws their chip", () => {
  const before = viewOf([friendOnMode("mike", "Mike", "pve")]);
  const switched = friendOnMode("mike", "Mike", "regular");
  switched.share.rev = 2;
  const change = describeSquadChange(before, viewOf([switched]), "customs");
  assert.deepEqual(change.tasksChanged, ["mike"]);
  assert.equal(change.chipsChanged, true);
});

test("the ☰ Tasks title says why a friend's tasks don't show", () => {
  assert.equal(friendTasksButtonTitle(friendOnMode("mike", "Mike", "pve"), "pve"), "Show Mike's tasks");
  assert.equal(friendTasksButtonTitle(friendOnMode("mike", "Mike", "pve"), "regular"), "Mike's tasks are for PvE");
  assert.equal(friendTasksButtonTitle(friendOnMode("mike", "Mike", "<odd>"), "regular"), "Mike's tasks are for <odd>");
  assert.equal(friendTasksButtonTitle(friend("sam", "Sam"), "regular"), "Sam isn't sharing tasks");
  assert.equal(friendTasksButtonTitle(friendOnMode("kim", "Kim", undefined), "pve"), "Show Kim's tasks");
});

// ---------------------------------------------------------------- ticket 26: squadmates' tasks in your list

// Marks one place and visits another: two parts (Mark, Scout & extract) when split.
const markThenVisit = {
  id: "aaaaaaaaaaaaaaaaaaaa0026",
  name: "Mark then visit",
  trader: "Mechanic",
  map: "customs",
  objs: [
    objective("bbbbbbbbbbbbbbbbbbbb0261", { type: "mark", d: "Mark the truck" }),
    objective("bbbbbbbbbbbbbbbbbbbb0262", { d: "Visit the dorms" }),
  ],
};
const taskByIdWithSplit = { ...taskById, [markThenVisit.id]: markThenVisit };
const noTicks = { ticks: {}, pct: 0 };

/** Rows the list shows for squadmates' tasks, as the page asks for them. */
function squadRows(friends, saved, mode = "regular", mapKey = "customs") {
  const shown = friendsWithTasksOn(friends, saved, mode);
  return friendOnlyRowsOnMap(shown, saved, mode, taskByIdWithSplit, mapKey);
}

test("a task only a squadmate has lands in the category its kind of work gets by default", () => {
  const saved = savedWithActive(killScavs);
  const mike = friendSharing("mike", "Mike", { [killScavs.id]: noTicks, [visitTwoPlaces.id]: noTicks, [markThenVisit.id]: noTicks });
  const rows = squadRows([mike], saved);
  const shape = rows.map((row) => [row.task.id, row.part.action, row.cat.id, row.notMine, row.done]);
  assert.deepEqual(shape, [
    [markThenVisit.id, "mark", "b-mark", true, false],
    [markThenVisit.id, "go", "b-go", true, false],
    [visitTwoPlaces.id, "go", "b-go", true, false],
  ]);
  assert.ok(!rows.some((row) => row.task.id === killScavs.id), "a task you have is your own row, not a squad row");
});

test("your own category choices and Don't split never apply to a squadmate's task", () => {
  const saved = freshState();
  // an old entry of yours, off your list: you once moved its mark part to Boss hunts and kept it whole
  saved.modes.regular.tasks[markThenVisit.id] = {
    ...blankTaskEntry(NOW),
    noSplit: true,
    partCats: { [`${markThenVisit.id}:mark`]: { cat: "b-boss", manual: true }, "*": { cat: "b-boss", manual: true } },
  };
  const mike = friendSharing("mike", "Mike", { [markThenVisit.id]: noTicks });
  const rows = squadRows([mike], saved);
  assert.deepEqual(rows.map((row) => row.cat.id), ["b-mark", "b-go"]);
});

test("a part a squadmate finished isn't listed, unless another shown friend still has it open", () => {
  const saved = freshState();
  const markDone = { ticks: { bbbbbbbbbbbbbbbbbbbb0261: true }, pct: 50 };
  const mike = friendSharing("mike", "Mike", { [markThenVisit.id]: markDone });
  assert.deepEqual(squadRows([mike], saved).map((row) => row.part.action), ["go"]);
  const sam = friendSharing("sam", "Sam", { [markThenVisit.id]: noTicks });
  assert.deepEqual(squadRows([mike, sam], saved).map((row) => row.part.action), ["mark", "go"]);
});

test("squad rows are per map: a task on Woods isn't listed on Customs", () => {
  const mike = friendSharing("mike", "Mike", { [onlyOnWoods.id]: noTicks });
  assert.deepEqual(squadRows([mike], freshState(), "regular", "customs"), []);
  assert.deepEqual(squadRows([mike], freshState(), "regular", "woods").map((row) => row.task.id), [onlyOnWoods.id]);
});

test("a squadmate whose ☰ Tasks you switched off, or who is on another game mode, adds no rows", () => {
  const saved = freshState();
  const mike = friendSharing("mike", "Mike", { [visitTwoPlaces.id]: noTicks });
  assert.equal(squadRows([mike], saved).length, 1, "☰ Tasks is on by default");
  setFriendPref(saved, "mike", "tasks", false);
  assert.deepEqual(squadRows([mike], saved), [], "switched off");
  const onPve = friendSharing("kim", "Kim", { [visitTwoPlaces.id]: noTicks });
  onPve.share.mode = "pve";
  assert.deepEqual(squadRows([onPve], freshState(), "regular"), [], "Kim's tasks are for PvE");
  assert.equal(squadRows([onPve], freshState(), "pve").length, 1, "shown when you're on PvE too");
});

test("each row shows a colour box and name for every shown friend who has it, yours too", () => {
  const saved = savedWithActive(killScavs);
  const mike = friendSharing("mike", "Mike", { [killScavs.id]: noTicks, [visitTwoPlaces.id]: noTicks }, { color: "#E03131" });
  const sam = friendSharing("sam", "Sam‮", { [killScavs.id]: noTicks }, { color: "red;background:url(x)" });
  const kim = friendSharing("kim", "Kim", { [killScavs.id]: noTicks });
  setFriendPref(saved, "kim", "tasks", false);
  const shown = friendsWithTasksOn([mike, sam, kim], saved, "regular");
  assert.deepEqual(
    friendBoxes(killScavs.id, shown),
    [
      { playerId: "mike", name: "Mike", color: "#e03131" },
      { playerId: "sam", name: "Sam", color: NEUTRAL_FRIEND_COLOR },
    ],
    "your own task: Mike and Sam (Kim is switched off); colours and names made safe",
  );
  assert.deepEqual(friendBoxes(visitTwoPlaces.id, shown).map((box) => box.name), ["Mike"], "a squad-only task");
  assert.deepEqual(friendBoxes(onlyOnWoods.id, shown), [], "nobody has it");
});

test("a pinned squadmate's task is a pin only: off your list, listed under Pinned only", () => {
  const saved = freshState();
  const list = saved.modes.regular;
  assert.equal(togglePinnedTask(list, visitTwoPlaces.id, NOW), true);
  assert.deepEqual(list.tasks[visitTwoPlaces.id], { ...blankTaskEntry(NOW), pinned: true }, "a blank entry, not on your list");
  assert.equal(buildMyShare(saved, "regular", taskById, true).tasks[visitTwoPlaces.id], undefined, "not shared as yours");
  const mike = friendSharing("mike", "Mike", { [visitTwoPlaces.id]: noTicks, [markThenVisit.id]: noTicks });
  const rows = squadRows([mike], saved);
  const listedUnderPinnedOnly = rows.filter((row) => isRowListed(row, true)).map((row) => row.task.id);
  assert.deepEqual(listedUnderPinnedOnly, [visitTwoPlaces.id]);
  assert.equal(rows.filter((row) => isRowListed(row, false)).length, 3, "all of them without the filter");
  assert.equal(togglePinnedTask(list, visitTwoPlaces.id, NOW), false, "and unpinned again");
});

test("a pinned squadmate's task that no shown friend has any more keeps its pin but has no row", () => {
  const saved = freshState();
  togglePinnedTask(saved.modes.regular, visitTwoPlaces.id, NOW);
  const mikeWithout = friendSharing("mike", "Mike", { [killScavs.id]: noTicks });
  assert.deepEqual(squadRows([mikeWithout], saved).map((row) => row.task.id), [killScavs.id]);
  assert.equal(saved.modes.regular.tasks[visitTwoPlaces.id].pinned, true, "the pin is kept");
});

test("the header counts your tasks only; squadmates' tasks are a separate '+N from squad'", () => {
  const saved = savedWithActive(killScavs);
  const mike = friendSharing("mike", "Mike", { [visitTwoPlaces.id]: noTicks, [markThenVisit.id]: noTicks });
  const [killsPart] = partsOfTask(killScavs);
  const myRows = [{ task: killScavs, part: killsPart, cat: saved.cats[2], done: false, pinned: false }];
  const rows = [...myRows, ...squadRows([mike], saved)];
  assert.equal(countMyOpenTasks(rows), 1);
  assert.equal(countSquadOnlyTasks(rows), 2, "two tasks (three rows)");
});

test("'Shared with squad' never hides a squadmate's task (a friend has it by definition)", () => {
  const saved = savedWithActive(killScavs);
  setSharedOnlyFilter(saved, true);
  const mike = friendSharing("mike", "Mike", { [visitTwoPlaces.id]: noTicks });
  const shown = friendsWithTasksOn([mike], saved, "regular");
  for (const row of squadRows([mike], saved)) {
    assert.equal(isHiddenBySharedOnlyFilter(row.task.id, saved, shown), false);
  }
  assert.equal(isHiddenBySharedOnlyFilter(killScavs.id, saved, shown), true, "your own task nobody else has");
});
