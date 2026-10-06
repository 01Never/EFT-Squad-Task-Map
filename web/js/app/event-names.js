// @ts-check
// The live events the server sends (SSE), spelled exactly as in internal/events/names.go. A Go
// test (internal/events/names_test.go) reads this list and fails if the two differ.
// Each name maps to itself; app/live-events.js maps each one to its handler.

export const EVENT_NAMES = Object.freeze({
  task: "task", // deliver: a task was started, finished or failed in the game
  raidEnd: "raidEnd", // deliver: the raid ended; reset bag counts, extract marks and the trail
  gps: "gps", // broadcast: a new position from an in-raid screenshot
  capture: "capture", // broadcast: the list of screenshots captured for a task scan changed
  raidStart: "raidStart", // broadcast: a raid started
  raidMap: "raidMap", // broadcast: the game is loading this map
  mode: "mode", // broadcast: the game reported which game mode it's in
  keybind: "keybind", // broadcast: whether a screenshot key is bound in the game
  data: "data", // broadcast: the game data changed (new download, mode switch)
});
