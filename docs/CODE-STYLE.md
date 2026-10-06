# Code style: readability first

The owner wants to read any feature and understand its logic. **Readable beats concise, every time.** More lines, more files and longer names are fine. Cleverness, terseness and abstraction a reader has to chase through are not.

This applies to all new code and to everything rewritten in tickets 04 (Go backend) and 04b (page reorganisation). The v2 code written before 04/04b is compact and doesn't follow this guide; 04b fixes the page, and 04 writes the backend this way from the start.

---

## 1. Organise by feature, with the same names on both sides

To understand a feature, open its folder in Go and its folder in the page. That's everything about it.

### Backend (Go)
```
main.go                    tiny: calls app.Run()
embed.go                   //go:embed web assets (must sit at the repo root)
internal/
  app/                     Run(): creates every feature, wires events between them, starts HTTP.
                           The ONE place that shows how features connect. Read this first.
  httpapi/                 route table → feature handlers (thin: decode, call the feature, encode)
  events/                  event names (constants), live/queued delivery to the page, the pending queue
  storage/                 files next to the exe: settings, the page's saved data (opaque), atomic write + .bak
  gamedata/                download / cache / validate tarkov.dev data; convert it to the page's format
  gamefolders/             find Tarkov's logs and screenshots folders (registry, Steam, Documents)
  screenshots/             watch the screenshots folder; hand new files to the features that want them
  openai/                  small OpenAI client shared by features (Responses API, strict schemas)
  features/
    gamelog/               Tarkov's logs → task accepted/finished/failed, raid start/end, game mode, keybind
    raid/                  current raid: map, start/end; clean up that raid's GPS screenshots at the end
    gps/                   your position and heading from screenshot file names
    taskscan/              "Scan tasks": capture, read with AI, confirm (and delete) or cancel
    aicategorize/          AI Categorize and its wiki lookups
    squad/                 multiplayer over tsnet                          (ticket 05)
    extracts/              read your extracts from the first raid screenshot (ticket 06)
    icons/                 item icon cache                                 (ticket 07)
    loot/ keys/ routes/    only if they need server code                   (tickets 08–10)
cmd/mock/                  offline stand-ins for json.tarkov.dev, OpenAI and the wiki
testdata/                  fixtures and golden files
```

### Page (JavaScript, served as-is: no bundler)
```
web/index.html
web/css/base.css           colours, fonts and layout shared by everything (CSS variables live here)
web/js/
  main.js                  start-up only
  app/                     saved data + saving, server API calls, live-event router, routing, small DOM helpers,
                           types.js (JSDoc types), event-names.js
  map/                     the map view: pan/zoom, projection, layer order, shared marker drawing, overlay animations.
                           No feature rules in here.
  panel/                   the right-hand panel shell and tabs. Features add their own sections.
  features/
    tasks/                 parts, categories, ticks, pins; the task list; task markers and zones
    readiness/             what each objective needs; "!" and fading; the Bring list
    scan/  ai-categorize/  drawing/  sub-tasks/  settings/  picker/
    find-me/               player marker, radar, auto-center               (tickets 01–02)
    extracts/              extract marks, closest extract, AI marks        (tickets 03, 06)
    squad/  icons/  loot/  keys/  routes/                                   (tickets 05, 07–10)
```

### Inside a page feature folder
| File | What goes in it |
|---|---|
| `README.md` | The feature in one page (template in §9) |
| `rules.js` | The feature's logic as plain functions: no DOM, no network. **This is where you read the logic.** |
| `panel.js` | What it adds to the right-hand panel, and the handlers for those buttons |
| `map-layer.js` | What it draws on the map, and the handlers for clicks on it |
| `<feature>.css` | Its styles |
| `rules.test.js` | Tests for `rules.js` |

Go feature packages follow the same idea: a `doc.go` or `README.md`, `rules.go` for the logic, a file for its I/O (watcher, HTTP handler), and `*_test.go`.

### Where things connect
- **Backend:** only `internal/app` creates features and connects them. Features don't reach into each other's internals; they expose small functions or emit events.
- **Map layer order:** listed once, bottom to top, in `web/js/map/layers.js`. For example: zones → place names → drawings → extracts → loot → key doors → routes → task markers → squad → you. It's an explicit list, not auto-registration.
- **Panel sections:** listed once, in order, in `web/js/panel/panel.js`.

---

## 2. Keep rules separate from plumbing

Every game or design rule is a **named function in a rules file**, with explicit inputs and no I/O, tested on its own. Drawing and network code calls the rules; it never re-implements them inline.

Before (v2):
```js
export const partReady = (p, ticks, have) => p.objs.filter((o) => !objDone(o, ticks)).every((o) => objReady(o, have));
```
After:
```js
/**
 * A part is "possible" when, for every objective you haven't ticked yet,
 * you're carrying at least one of each thing it needs.
 * Example: 2 markers and 5 marker spots → all 5 spots are possible.
 */
export function isPartPossible(part, ticks, bag) {
  const remainingObjectives = part.objectives.filter((objective) => !isObjectiveDone(objective, ticks));
  return remainingObjectives.every((objective) => hasEverythingFor(objective, bag));
}
```

Go:
```go
// Tarkov writes these message types into its notifications log.
var taskStatusByMessageType = map[int]TaskStatus{
	10: TaskAccepted,
	11: TaskFailed,
	12: TaskFinished,
}

// TaskEventFromNotification turns a "ChatMessageReceived" notification into a task event.
// It returns false for messages that aren't about tasks.
func TaskEventFromNotification(n Notification) (TaskEvent, bool) {
	status, isTaskMessage := taskStatusByMessageType[n.Message.Type]
	if !isTaskMessage {
		return TaskEvent{}, false
	}

	// templateId looks like "<taskId> description".
	fields := strings.Fields(n.Message.TemplateID)
	if len(fields) == 0 {
		return TaskEvent{}, false
	}
	return TaskEvent{TaskID: fields[0], Status: status}, true
}
```

---

## 3. Naming
- **Full words.** `state`, `mapView`, `objective`, `extract`, `screenshot`; not `S`, `M`, `o`, `ex`, `ss`. Single letters only for loop indexes and `x`/`y`/`z` coordinates.
- **True/false values read as questions:** `isReady`, `hasKey`, `isInRaid`, `shouldFollowPlayer`.
- **Functions say what they do:** `findClosestExtract`, `markExtractsFromScreenshot`, `deleteThisRaidsGpsScreenshots`.
- **Units in names when it matters:** `distanceMeters`, `pollIntervalSeconds`, `maxImageEdgePixels`.
- **Game and design numbers are named constants** at the top of the rules file, with a comment saying where the number comes from:
  ```js
  // Loot within this distance of a locked door, on the same floor, is shown as "likely behind it".
  // The data has door positions, not room walls, so this is an estimate (owner tuned it to 8 m).
  const LOOT_BEHIND_DOOR_RADIUS_METERS = 8;
  ```
- The same thing has the same name everywhere: Go, JS, saved data, event names and README.

## 4. Functions and control flow
- **One job per function,** short enough to read without scrolling (roughly ≤ 40 lines).
- **Return early** instead of nesting. At most two or three levels of indentation.
- **No nested ternaries, no clever one-liners,** no long chains of `.filter().map().reduce()` when a plain loop reads clearer.
- **One statement per line;** lines ≤ 100 characters.
- **Name intermediate values** instead of inlining them: `const visibleParts = …; const markers = …;`.
- **Handlers are named functions next to the UI they serve:** `onPinClicked()`, `onRaidEnded()`. Don't use one big `switch` over every action in the app. A small table mapping action names to handlers is fine, if it sits in the same feature file.
- **Build HTML in small render functions** (`renderTaskRow`, `renderTaskDetails`, `renderObjectiveLine`), not one giant template string.

## 5. Comments
- **Every file starts with 1–3 lines:** what it's for, and what it deliberately doesn't do.
- **Every exported Go function and every exported JS function** gets a doc comment saying what it returns and any rule behind it.
- **Comment why, and how the game behaves.** For example: "Tarkov puts your position in the screenshot's file name"; "type 12 = task finished". Don't narrate what the next line obviously does.
- Link the ticket or SPEC section when a behaviour exists because of a decision: `// Owner decision (ticket 02): never change zoom automatically.`

## 6. Events and data flow
- **Event names are defined once per side, spelled identically:** Go `internal/events/names.go` constants, JS `web/js/app/event-names.js`. A Go test reads the JS file and fails if the two lists differ.
- **The page has one live-event router** (`web/js/app/live-events.js`). It maps each event name to one named handler, which calls into the owning feature.
- Each feature README writes out its flow end to end, e.g.:
  `screenshot file → screenshots watcher → gps.ParseFileName → raid.OnPosition → event "gps" → find-me/map-layer.js`.
- **Goroutines (Go):** each one has a comment saying who starts it, what it waits on, and how it stops. No fire-and-forget goroutines.
- **Errors (Go):** wrap with context (`fmt.Errorf("reading log %s: %w", path, err)`). Never `panic` for expected problems like a missing folder or a bad file.

## 7. Types you can see without a build step
- **Go:** structs for everything, with JSON tags and a comment on non-obvious fields.
- **JS:**
  - `// @ts-check` at the top of every file, plus `jsconfig.json` with `"checkJs": true`. VS Code then type-checks plain JavaScript, with no TypeScript compile.
  - Core shapes (Task, Objective, Part, SavedState, Event payloads) are JSDoc `@typedef`s in `web/js/app/types.js`.
  - Functions take and return those types.

## 8. Tests read like the rules
- Test names are sentences: `"two markers make all five marker spots possible"`, `"a finished task is removed quietly and unpinned"`.
- **Go:** table-driven tests with a `name` per case.
- **JS:** `node --test` (no packages). Tests sit next to the code they test (`rules.test.js`).
- Every rule function has at least one test showing the normal case and one showing the edge case the rule exists for.

## 9. Docs that stay current
- **`docs/FEATURES.md`:** one table to start from. Columns: feature → ticket → Go package → page folder → saved data it owns → events it sends/receives → settings it uses.
- **A `README.md` in each feature folder** (both sides, or one shared README in the page folder that links the Go package), using this template:
  ```md
  # <Feature>
  **What it does (player's view):** …
  **Where the data comes from:** …
  **The rules:** (with the numbers and why)
  **Flow:** event/file → function → … → what you see
  **Saved data / settings:** …
  **Files:** rules.js — …; panel.js — …; map-layer.js — …
  **Tests:** what's covered, what needs an in-game check
  ```
- **Every PR description** says, in plain language: which feature folders changed, how the rule works now, and how it was checked.
- When code changes a rule, the README changes in the same PR.

## 10. Avoid
- Frameworks, build steps for the page, code generators, dependency-injection containers, deep inheritance, "manager/helper/util" grab-bags.
- Abstractions with one user. Copy a few lines rather than invent a shared layer nobody can follow.
- Hidden magic: auto-registration, reflection-driven wiring, or global mutable state outside `internal/app` and `web/js/app/state.js`.
- Formatting fights. Use `gofmt` and `go vet` for Go. For JS, optionally Prettier (`printWidth: 100`) as a dev-only tool if Node is installed.
