# Live events (`internal/events`)

**What it's for:** sending updates from the server to the open page with Server-Sent Events
(`GET /api/events`). The connection sits idle until something happens, so the page never polls
(CLAUDE.md). The page handles them in `web/js/live.js` `handle()` (ticket 04b moves the router to
`web/js/app/live-events.js`).

**Two kinds of delivery:**
- **`Deliver`**: events that change the page's saved data, `task` and `raidEnd`. Each gets the next
  `id`, is queued in `squad-task-map-pending.json`, and is sent to every open page. Every page that
  connects gets the whole queue again, until a page acknowledges (`POST /api/events/ack {upTo}`,
  which drops every event up to that id). So a task you accepted while the browser was closed
  still lands when you open it. The page acknowledges 300 ms after the last event it applied.
- **`Broadcast`**: live-only events. If no page is open they're dropped; a page that opens later
  reads the current state from `/api/status`.

| Event | Kind | Fields | Sent when |
|---|---|---|---|
| `task` | deliver | `taskId`, `status` (started, failed, finished) | the log says so, the game mode matches and the task is in the data |
| `raidEnd` | deliver | `map`, `deleted` (GPS shots deleted) | back in the menus after a raid |
| `gps` | broadcast | `gps` {map, x, y, z, yaw, t}, `trail` [{x, z, t}] | a GPS screenshot appears |
| `capture` | broadcast | `files` [{name, t, size}]; at the end `done: true` or `cancelled: true` | the scan's capture list changes |
| `raidStart` | broadcast | `map` | `GameStarted` |
| `raidMap` | broadcast | `map` | the game loads a map |
| `mode` | broadcast | `mode`, `dataMode` | `Session mode: …` |
| `keybind` | broadcast | `ok`, `warning` | the game's control settings were read |
| `data` | broadcast | `status` | the game data changed (download, mode switch) |

**What it deliberately doesn't do:** decide what to send (`internal/app` does); keep broadcast
events for later; send heartbeats (the connection is local).

**The rules / limits:**
- `maxPendingEvents` = 500: the queue keeps the newest 500.
- Ids continue from the highest one still queued when the app starts (0 when the queue is empty),
  as v2 did. An open page keeps its old `ackUpTo` across a server restart (HANDOFF §11).
- On connect: a `: hi` comment, then every queued event, then live events as they happen.
- Each event is one `data:` line of JSON: `{"type": …, …fields}`, plus `id` for delivered events.
- A sender never waits for a slow page: each page has a `clientBufferSize` = 64-message buffer,
  and a page that falls that far behind is disconnected; the browser reconnects by itself and gets
  the queued events again.
- `Deliver` queues and sends in one locked step, so a page that connects at that moment gets the
  event exactly once (in its queued batch or live).
- `Close` ends every open stream when the app shuts down, so it closes at once.
- No goroutines of its own: `ServeSSE` runs in the request's goroutine and ends when the page
  disconnects, is dropped, or the hub closes.

**Saved data:** owns `squad-task-map-pending.json` (written atomically through `storage`).

**Files:**
- `names.go`: the event names, spelled exactly as the page expects them.
- `hub.go`: `Hub` (`Broadcast`, `Deliver`, `Acknowledge`, `ServeSSE`, `ClientCount`, `Close`).

**Tests:** `hub_test.go`: delivered events get increasing ids, are saved and survive a restart (ids continue); acknowledging drops them; the 500 limit; a stream sends ": hi", the queue, then live events; a page 64 messages behind is disconnected; `Deliver` reaches a connecting page once; `Close` ends every stream. CODE-STYLE §6 also plans a Go test that reads the page's event-name list
and fails if the two differ; it waits for ticket 04b's `web/js/app/event-names.js`.
