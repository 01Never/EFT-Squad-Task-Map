// Tests for the squad's page rules (rules.js): what is shared, who shows, the texts, friends'
// positions (ticket 17), and what a new `squad` event changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshState, migrateSavedData } from "../../app/saved-data.js";
import { partsOfTask } from "../tasks/rules.js";
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
  FRIEND_POSITION_FADES_AFTER_MS,
  FRIEND_POSITION_GOES_AFTER_MS,
  friendPositionOf,
  friendPositionLook,
  friendPositionsOnMap,
  friendElsewhereText,
  friendPositionTooltip,
  msUntilNextFriendPositionChange,
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

test("drawings are shown by default and tasks are not; the choices are remembered per friend", () => {
  const saved = freshState();
  assert.deepEqual(friendPrefsOf(saved, "mike"), { drawings: true, tasks: false, position: true });
  setFriendPref(saved, "mike", "tasks", true);
  setFriendPref(saved, "sam", "drawings", false);
  assert.deepEqual(friendPrefsOf(saved, "mike"), { drawings: true, tasks: true, position: true });
  assert.deepEqual(friendPrefsOf(saved, "sam"), { drawings: false, tasks: false, position: true });
  assert.deepEqual(friendPrefsOf(saved, "someone-new"), { drawings: true, tasks: false, position: true });
});

test("a saved file from before the squad is read with the defaults and is not changed by reading it", () => {
  const older = migrateSavedData({ version: 2, cats: [], tasks: {}, prefs: {} });
  assert.equal("squad" in older, false, "no squad block is invented");
  assert.deepEqual(friendPrefsOf(older, "mike"), { drawings: true, tasks: false, position: true });
  assert.equal(isSharedOnlyFilterOn(older), false);
  assert.equal("squad" in older, false, "reading choices writes nothing");
  setSharedOnlyFilter(older, true);
  assert.equal(isSharedOnlyFilterOn(older), true);
});

test("a squad block that lost a field is read with the defaults", () => {
  const saved = migrateSavedData({ version: 2, cats: [], tasks: {}, prefs: {}, squad: { friends: { mike: { tasks: true } } } });
  assert.deepEqual(friendPrefsOf(saved, "mike"), { drawings: true, tasks: true, position: true });
  const hollow = migrateSavedData({ version: 2, cats: [], tasks: {}, prefs: {}, squad: {} });
  assert.deepEqual(friendPrefsOf(hollow, "mike"), { drawings: true, tasks: false, position: true });
});

test("which friends show: drawings by their toggle; tasks by their toggle and only when they share", () => {
  const saved = freshState();
  const mike = friend("mike", "Mike");
  const sam = friendSharing("sam", "Sam", {});
  const kim = friendSharing("kim", "Kim", {});
  setFriendPref(saved, "sam", "tasks", true);
  setFriendPref(saved, "kim", "drawings", false);
  setFriendPref(saved, "mike", "tasks", true); // Mike shares no tasks (null)
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
  setFriendPref(saved, player.playerId, "tasks", true); // switched on, but Player shares nothing
  // Sam shares, but his ☰ Tasks is off (the default)
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
  assert.deepEqual(describeSquadChange(before, after, "customs", NOW), {
    chipsChanged: false,
    settingsChanged: false,
    drawingsChanged: ["mike"],
    tasksChanged: [],
    positionsChanged: [],
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
    assert.deepEqual(friendPrefsOf(saved, key), { drawings: true, tasks: false, position: true }, `${key}: defaults`);
    setFriendPref(saved, key, "tasks", true);
    assert.equal(friendPrefsOf(saved, key).tasks, true, `${key}: remembered`);
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

// ---------------------------------------------------------------- friends' positions (ticket 17)

const MINUTE = 60_000;
const MAP_NAMES = { customs: "Customs", woods: "Woods", "streets-of-tarkov": "Streets of Tarkov" };

function positionOn(map, minutesAgo, extra = {}) {
  return { map, x: 120.5, y: 2.1, z: -210.75, yaw: 90, t: NOW - minutesAgo * MINUTE, ...extra };
}

function friendAt(playerId, name, pos, extra = {}) {
  return friend(playerId, name, { share: { rev: 1, updatedAt: 1, draw: {}, tasks: null, pos }, ...extra });
}

const namesOf = (shown) => shown.map((one) => one.friend.name);

test("a friend's position shows only on the map they are on", () => {
  const saved = freshState();
  const mike = friendAt("mike", "Mike", positionOn("customs", 1));
  const sam = friendAt("sam", "Sam", positionOn("woods", 1));
  const kim = friend("kim", "Kim"); // no position: out of raid, or not sharing it
  const friends = [mike, sam, kim];
  assert.deepEqual(namesOf(friendPositionsOnMap(friends, saved, "customs", NOW)), ["Mike"]);
  assert.deepEqual(namesOf(friendPositionsOnMap(friends, saved, "woods", NOW)), ["Sam"]);
  assert.deepEqual(namesOf(friendPositionsOnMap(friends, saved, "reserve", NOW)), []);
  const [shown] = friendPositionsOnMap(friends, saved, "customs", NOW);
  assert.deepEqual(shown.position, positionOn("customs", 1), "the position as sent, for the projection");
});

test("friends' positions are shown by default, and each friend's ◎ Pos switch hides theirs", () => {
  const saved = freshState();
  const mike = friendAt("mike", "Mike", positionOn("customs", 1));
  const sam = friendAt("sam", "Sam", positionOn("customs", 1));
  assert.equal(friendPrefsOf(saved, "mike").position, true, "on by default");
  setFriendPref(saved, "sam", "position", false);
  assert.equal(friendPrefsOf(saved, "sam").position, false, "remembered");
  assert.deepEqual(saved.squad.friends.sam, { drawings: true, tasks: false, position: false });
  assert.deepEqual(namesOf(friendPositionsOnMap([mike, sam], saved, "customs", NOW)), ["Mike"]);
  setFriendPref(saved, "sam", "position", true);
  assert.deepEqual(namesOf(friendPositionsOnMap([mike, sam], saved, "customs", NOW)), ["Mike", "Sam"]);
});

test("a friend's choices saved before ticket 17 (no position) read the position switch as on", () => {
  const older = migrateSavedData({
    version: 2, cats: [], tasks: {}, prefs: {},
    squad: { friends: { mike: { drawings: false, tasks: true } }, sharedOnly: true },
  });
  assert.deepEqual(friendPrefsOf(older, "mike"), { drawings: false, tasks: true, position: true });
  assert.deepEqual(older.squad.friends.mike, { drawings: false, tasks: true }, "reading changes nothing");
  const oddValue = migrateSavedData({ version: 2, cats: [], tasks: {}, prefs: {}, squad: { friends: { mike: { position: "no" } } } });
  assert.equal(friendPrefsOf(oddValue, "mike").position, true, "anything but true/false reads as the default");
});

test("a position is fully opaque up to 5 minutes, faded after 5, and not drawn after 30", () => {
  assert.equal(FRIEND_POSITION_FADES_AFTER_MS, 5 * MINUTE);
  assert.equal(FRIEND_POSITION_GOES_AFTER_MS, 30 * MINUTE);
  const lookAt = (ageMs) => friendPositionLook({ ...positionOn("customs", 0), t: NOW - ageMs }, NOW);
  assert.equal(lookAt(0), "fresh");
  assert.equal(lookAt(5 * MINUTE), "fresh", "exactly 5 minutes is still fresh");
  assert.equal(lookAt(5 * MINUTE + 1), "faded");
  assert.equal(lookAt(30 * MINUTE), "faded", "exactly 30 minutes is still drawn");
  assert.equal(lookAt(30 * MINUTE + 1), "gone");

  const saved = freshState();
  const friends = [
    friendAt("a", "Fresh", positionOn("customs", 2)),
    friendAt("b", "Faded", positionOn("customs", 12)),
    friendAt("c", "Gone", positionOn("customs", 31)),
  ];
  const shown = friendPositionsOnMap(friends, saved, "customs", NOW);
  assert.deepEqual(shown.map((one) => [one.friend.name, one.isFaded]), [["Fresh", false], ["Faded", true]]);
});

test("a position from a friend whose clock is ahead of yours counts as just taken", () => {
  const fromTheFuture = { ...positionOn("customs", 0), t: NOW + 3 * MINUTE };
  assert.equal(friendPositionLook(fromTheFuture, NOW), "fresh");
  assert.equal(friendPositionLook(fromTheFuture, NOW + 8 * MINUTE), "fresh", "age 5 min by their clock");
  assert.equal(friendPositionLook(fromTheFuture, NOW + 9 * MINUTE), "faded");
  const mike = friendAt("mike", "Mike", fromTheFuture);
  assert.equal(friendPositionTooltip(mike, fromTheFuture, NOW), "Mike · just now", "never 'in 3 min'");
});

test("the tooltip says 'Mike · 2 min ago', worked out at the moment it is shown", () => {
  const position = positionOn("customs", 0);
  const mike = friendAt("mike", "  Mike\u0007 ", position);
  assert.equal(friendPositionTooltip(mike, position, NOW), "Mike · just now");
  assert.equal(friendPositionTooltip(mike, position, NOW + 2 * MINUTE), "Mike · 2 min ago", "the same marker, later");
  assert.equal(friendPositionTooltip(mike, position, NOW + 25 * MINUTE), "Mike · 25 min ago");
  const markup = friendAt("x", "<b>Sam</b>", position);
  assert.equal(friendPositionTooltip(markup, position, NOW), "<b>Sam</b> · just now", "text (set with textContent)");
});

test("a friend on another map shows 'on Customs' on their chip", () => {
  const saved = freshState();
  const mike = friendAt("mike", "Mike", positionOn("customs", 3));
  assert.equal(friendElsewhereText(mike, saved, "woods", MAP_NAMES, NOW), "on Customs");
  assert.equal(friendElsewhereText(mike, saved, "customs", MAP_NAMES, NOW), "", "on this map: drawn instead");
  const streets = friendAt("sam", "Sam", positionOn("streets-of-tarkov", 3));
  assert.equal(friendElsewhereText(streets, saved, "woods", MAP_NAMES, NOW), "on Streets of Tarkov");
});

test("'on Customs' needs a recent position, the friend's ◎ Pos switch on and a map the config names", () => {
  const saved = freshState();
  const old = friendAt("old", "Old", positionOn("customs", 31));
  assert.equal(friendElsewhereText(old, saved, "woods", MAP_NAMES, NOW), "", "over 30 minutes old");
  const faded = friendAt("faded", "Faded", positionOn("customs", 20));
  assert.equal(friendElsewhereText(faded, saved, "woods", MAP_NAMES, NOW), "on Customs", "faded still counts");
  assert.equal(friendElsewhereText(friend("none", "None"), saved, "woods", MAP_NAMES, NOW), "", "no position");
  const hidden = friendAt("hidden", "Hidden", positionOn("customs", 1));
  setFriendPref(saved, "hidden", "position", false);
  assert.equal(friendElsewhereText(hidden, saved, "woods", MAP_NAMES, NOW), "", "switch off");
  const unknownMap = friendAt("lab", "Lab", positionOn("the-lab", 1));
  assert.equal(friendElsewhereText(unknownMap, saved, "woods", MAP_NAMES, NOW), "", "a map the config doesn't name");
});

test("the one timer waits until the next fade or hide moment among friends with a position", () => {
  const fresh = friendAt("a", "Fresh", positionOn("customs", 2)); // fades in 3 min
  const faded = friendAt("b", "Faded", positionOn("woods", 20)); // goes in 10 min
  const gone = friendAt("c", "Gone", positionOn("customs", 45)); // nothing more to change
  assert.equal(msUntilNextFriendPositionChange([fresh, faded, gone], NOW), 3 * MINUTE + 1);
  assert.equal(msUntilNextFriendPositionChange([faded, gone], NOW), 10 * MINUTE + 1);
  assert.equal(msUntilNextFriendPositionChange([gone, friend("d", "None")], NOW), null, "no timer at all");
  assert.equal(msUntilNextFriendPositionChange([], NOW), null);
});

test("the timer never waits less than a second, nor longer than a browser timer can", () => {
  const almostFaded = friendAt("a", "A", { ...positionOn("customs", 0), t: NOW - 5 * MINUTE });
  assert.equal(msUntilNextFriendPositionChange([almostFaded], NOW), 1000);
  const farFuture = friendAt("b", "B", { ...positionOn("customs", 0), t: NOW + 365 * 24 * 60 * MINUTE });
  assert.equal(msUntilNextFriendPositionChange([farFuture], NOW), 2 ** 31 - 1);
});

test("a position that isn't shaped right is ignored without throwing", () => {
  const saved = freshState();
  const good = positionOn("customs", 1);
  const without = (field) => {
    const copy = { ...good };
    delete copy[field];
    return copy;
  };
  const badPositions = [
    null, undefined, "customs", 42, [], [1, 2, 3],
    without("map"), without("x"), without("y"), without("z"), without("yaw"), without("t"),
    { ...good, x: "120" }, { ...good, z: NaN }, { ...good, y: Infinity }, { ...good, yaw: null },
    { ...good, t: "now" }, { ...good, t: NaN }, { ...good, x: 1e9 },
    { ...good, map: "" }, { ...good, map: "bad map key!" }, { ...good, map: 5 }, { ...good, map: "x".repeat(65) },
    Object.create(good), // fields only on its prototype, not its own
  ];
  for (const pos of badPositions) {
    const mike = friendAt("mike", "Mike", pos);
    const what = JSON.stringify(pos) ?? String(pos);
    assert.equal(friendPositionOf(mike), null, what);
    assert.deepEqual(friendPositionsOnMap([mike], saved, "customs", NOW), [], what);
    assert.equal(friendElsewhereText(mike, saved, "woods", MAP_NAMES, NOW), "", what);
    assert.equal(msUntilNextFriendPositionChange([mike], NOW), null, what);
  }
  for (const share of [null, "share", { rev: 1 }, { pos: undefined }]) {
    assert.equal(friendPositionOf(friend("sam", "Sam", { share })), null, JSON.stringify(share));
  }
});

test("a friend's position under a map key like '__proto__' or 'toString' shows nowhere", () => {
  const saved = freshState();
  for (const key of PROTOTYPE_KEYS) {
    const pos = JSON.parse(`{"map":"${key}","x":1,"y":2,"z":3,"yaw":4,"t":${NOW}}`);
    const mike = friendAt("mike", "Mike", pos);
    assert.deepEqual(friendPositionsOnMap([mike], saved, "customs", NOW), [], `${key}: not on Customs`);
    assert.equal(friendElsewhereText(mike, saved, "customs", MAP_NAMES, NOW), "", `${key}: no "on …"`);
  }
  // a share whose own "__proto__" key carries a position is not a position
  const sneaky = friend("sam", "Sam", { share: JSON.parse(`{"rev":1,"updatedAt":1,"__proto__":{"pos":${JSON.stringify(positionOn("customs", 1))}}}`) });
  assert.equal(friendPositionOf(sneaky), null);
});

// ---------------------------------------------------------------- what a squad event changed: positions

test("a friend's new position on the open map redraws only the positions", () => {
  const before = viewOf([friendAt("mike", "Mike", positionOn("customs", 3))]);
  const after = viewOf([friendAt("mike", "Mike", positionOn("customs", 0, { x: 140 }))]);
  assert.deepEqual(describeSquadChange(before, after, "customs", NOW), {
    chipsChanged: false,
    settingsChanged: false,
    drawingsChanged: [],
    tasksChanged: [],
    positionsChanged: ["mike"],
  });
});

test("a friend's new position on another map redraws nothing on this one, and their chip only if the map changed", () => {
  const onWoods = viewOf([friendAt("mike", "Mike", positionOn("woods", 3))]);
  const movedOnWoods = viewOf([friendAt("mike", "Mike", positionOn("woods", 0, { x: 140 }))]);
  const sameMap = describeSquadChange(onWoods, movedOnWoods, "customs", NOW);
  assert.deepEqual([sameMap.chipsChanged, sameMap.positionsChanged], [false, []]);
  const onStreets = viewOf([friendAt("mike", "Mike", positionOn("streets-of-tarkov", 0))]);
  const newMap = describeSquadChange(onWoods, onStreets, "customs", NOW);
  assert.deepEqual([newMap.chipsChanged, newMap.positionsChanged], [true, []], "'on Woods' becomes 'on Streets of Tarkov'");
});

test("a friend arriving on this map or leaving it (or their raid ending) redraws the positions and the chips", () => {
  const onWoods = viewOf([friendAt("mike", "Mike", positionOn("woods", 1))]);
  const onCustoms = viewOf([friendAt("mike", "Mike", positionOn("customs", 0))]);
  const outOfRaid = viewOf([friendAt("mike", "Mike", null)]);
  for (const [before, after, what] of [[onWoods, onCustoms, "arrives"], [onCustoms, onWoods, "leaves"], [onCustoms, outOfRaid, "raid ends"]]) {
    const change = describeSquadChange(before, after, "customs", NOW);
    assert.deepEqual([change.chipsChanged, change.positionsChanged], [true, ["mike"]], what);
  }
});

test("a new position replacing one over 30 minutes old updates the chip, even on the same map", () => {
  const old = viewOf([friendAt("mike", "Mike", positionOn("woods", 40))]);
  const renewed = viewOf([friendAt("mike", "Mike", positionOn("woods", 0))]);
  assert.equal(describeSquadChange(old, renewed, "customs", NOW).chipsChanged, true);
});

test("a friend's new colour or name redraws their position on this map", () => {
  const before = viewOf([friendAt("mike", "Mike", positionOn("customs", 1))]);
  const recoloured = viewOf([friendAt("mike", "Mike", positionOn("customs", 1), { color: "#00ff00" })]);
  assert.deepEqual(describeSquadChange(before, recoloured, "customs", NOW).positionsChanged, ["mike"]);
  assert.deepEqual(describeSquadChange(before, recoloured, "woods", NOW).positionsChanged, [], "not on this map");
});

test("the first view, or a friend joining or leaving, draws the positions on the open map", () => {
  const withMike = viewOf([friendAt("mike", "Mike", positionOn("customs", 1))]);
  assert.deepEqual(describeSquadChange(null, withMike, "customs", NOW).positionsChanged, ["mike"]);
  assert.deepEqual(describeSquadChange(null, withMike, null, NOW).positionsChanged, [], "no map open");
  assert.deepEqual(describeSquadChange(viewOf([]), withMike, "customs", NOW).positionsChanged, ["mike"]);
  assert.deepEqual(describeSquadChange(withMike, viewOf([]), "customs", NOW).positionsChanged, ["mike"]);
});

test("a friend's other news (drawings, going offline) does not redraw positions", () => {
  const before = viewOf([friendAt("mike", "Mike", positionOn("customs", 1))]);
  const offline = viewOf([friendAt("mike", "Mike", positionOn("customs", 1), { online: false, lastSeen: NOW })]);
  assert.deepEqual(describeSquadChange(before, offline, "customs", NOW).positionsChanged, []);
  const drew = viewOf([friendAt("mike", "Mike", positionOn("customs", 1))]);
  drew.friends[0].share = { ...drew.friends[0].share, rev: 2, updatedAt: 2, draw: { customs: [stroke()] } };
  const change = describeSquadChange(before, drew, "customs", NOW);
  assert.deepEqual([change.drawingsChanged, change.positionsChanged], [["mike"], []]);
});
