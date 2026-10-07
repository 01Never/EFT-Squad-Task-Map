# Web server (`internal/httpapi`)

**What it's for:** the route table and thin handlers: decode the request, call the app (the
`Backend` interface, implemented in `internal/app/backend.go`), encode the answer. It also serves
the page itself (`web/index.html` and the `web/js/` modules as they are, no bundler), the map art,
the fonts and the maps config, all built into the exe.

**What it deliberately doesn't do:** any feature logic (it lives in the features; `internal/app`
connects them); log-in or CORS (the server only listens on 127.0.0.1, so only this PC reaches it,
and `Guard` makes sure only the app's own page in the browser can use it).

**The rules / limits:**
- Listens on `127.0.0.1` only, on the first free port from 7777 to 7800 (`PORT` changes the
  start). A second copy of the app on the same data folder just opens the running one's page and
  exits (`internal/app/run.go`).
- **Only the app's own page is answered** (`guard.go`, ticket 04d). Other web pages open in the
  same browser can send requests to 127.0.0.1 too, so every request (page, files, API, live
  events) goes through `Guard` first, with a list of allowed hosts that `internal/app` builds for
  the port it actually bound (`127.0.0.1:<port>` and `localhost:<port>`):
  - **Host** must be one of them, or the answer is `421 Misdirected Request` (one plain-text
    line). This blocks DNS rebinding (a site whose name points at 127.0.0.1).
  - **State-changing requests** (every method but GET, HEAD, OPTIONS): an `Origin` header must be
    `http://` + an allowed host, or `403`; `null` counts as foreign. With no `Origin`, a
    `Sec-Fetch-Site` header must be `same-origin` or `none`, or `403`. With neither (curl, the
    tests, a second copy checking for the first) the request passes. This blocks cross-site
    "simple" POSTs, which a browser sends without asking first.
  - **JSON-body routes** (`jsonBody` in the route table: events/ack, state, settings, ai/key,
    ai/categorize, scan/remove, scan/read, scan/confirm, updates/download, squad/share,
    squad/join, squad/profile) take a body only as
    `application/json` (a charset is fine), or `415`. A request with no body and no Content-Type
    passes and reads as `{}`. So a form or `text/plain` POST can't reach them even from a
    browser that leaves out `Origin`.
  - Ticket 05's peer API (what friends' copies ask for) is **not on this server**: it's a
    separate listener with its own caller check, in `internal/features/squad` (`peerapi.go`).
    None of these rules was loosened for it.
- Request bodies over `maxRequestBody` = 32 MB are refused (the biggest real one is a scan
  screenshot of a few MB).
- An unknown path, or a known path with the wrong method, gets 404 "Not found" (as v2).
- A body that isn't a JSON object counts as `{}` (as v2); text fields read like JavaScript's
  `String(x || "")`.
- Static files get an explicit content type (Go's own lookup reads the Windows registry, and some
  PCs map `.js` to `text/plain`, which browsers refuse to run as a module). Built-in files carry the
  app version as their ETag with `no-cache`, so the browser re-checks cheaply and gets new files
  after an update; map SVGs are cached 1 hour, fonts 1 day. While developing (`go run`, or
  `STM_ASSETS_DIR`) files come from disk, uncached.
- `/js/` serves only `.js` files and never `*.test.js`; `/maps/` serves only `.svg` files.

**Routes:**

| Route | What it does | Notes |
|---|---|---|
| `GET /`, `/index.html`, `/js/…`, `/fonts/{name}`, `/maps/{file}.svg`, `/api/config` | the page, its modules, the Bender font, map art, `assets/maps-config.json` | |
| `GET /api/data` | the game data in the page's format | `gamedata` |
| `GET /api/status` | everything the page shows about the program | version, data, settings, logs, screenshots, keybind, raid, gps, trail, capture, ai, updates |
| `POST /api/data/refresh` | download the game data now | |
| `GET /api/events` | live events (SSE) | `events` |
| `POST /api/events/ack {upTo}` | drop queued events up to that id | |
| `GET /api/state`, `PUT /api/state` | the page's saved data (`null` when none) | `PUT` refuses anything that isn't JSON (400) |
| `PUT /api/settings` | change settings → `{ok, status}` | only fields sent with the right type: `gameMode` (regular, pve or pvp-season), `logsPath`, `screenshotsPath` (trimmed), `followPosition`, `autoCenter`. A new mode switches the game data; a new folder restarts both watchers. |
| `PUT /api/ai/key {key, model, effort}` | check and save the OpenAI key | an empty key keeps the saved one; an empty model is the default; effort is "", low, medium or high (anything else becomes ""); 400 with the reason |
| `DELETE /api/ai/key` | forget the key | |
| `POST /api/ai/categorize` | start an AI Categorize job → `{ok, job}` | instruction ≤ 2000 characters; last 8 turns ≤ 4000 each; ≤ 50 categories; ≤ 500 parts |
| `GET /api/ai/job/{id}` | a job's progress or result | 404 `{status: "error", error: "Job not found"}` |
| `POST /api/scan/start` | capture on → `{ok, dir}` | 400 `{error, dir}` when the screenshots folder isn't watched |
| `POST /api/scan/stop` | capture off → `{ok, files}` | |
| `POST /api/scan/cancel` | forget the list | broadcasts `capture` with `cancelled: true` |
| `POST /api/scan/remove {name}` | take one off the list | |
| `GET /api/scan/image?name=` | one captured picture | listed files only; not cached |
| `POST /api/scan/read {image}` | the AI reads one screenshot → `{ok, rows, usage}` | 400: no key or bad image; 502: OpenAI's error |
| `POST /api/scan/confirm {names}` | delete the listed files → `{ok, deleted}` | broadcasts `capture` with `done: true` |
| `POST /api/updates/check` | ask GitHub for the latest release → `{ok, status}` | answers when finished; a refusal is `{ok: false, error, code, status}` |
| `POST /api/updates/download {version?}` | start the background download | answers at once; progress comes as `updates` events |
| `POST /api/updates/cancel` | stop or discard the download | |
| `POST /api/updates/apply` | install the verified download and restart | this copy closes right after the answer |
| `POST /api/updates/seen` | dismiss "Updated to X" | |
| `GET /api/squad` | the squad view: you, squad settings, status line, friends with their last shares | same shape as the `squad` event |
| `PUT /api/squad/share {draw, tasks}` | your share → `{ok, rev, updatedAt, changed, tasksShared, inSquad}` | over 2 MB → 413; wrong shape → 400 with the reason; tasks dropped while "Share my tasks" is off |
| `POST /api/squad/join {authKey}` | join with an invite code → `{ok, squad}` | answers once the tailnet accepted it (≤ 90 s); 400 not a `tskey-…` code, 409 already in a squad, 502 the join failed; the code is never saved |
| `POST /api/squad/leave` | leave → `{ok, squad}` | logs out, deletes `squad-task-map-tailscale/`, forgets friends |
| `PUT /api/squad/profile {name?, color?, shareTasks?}` | change your profile → `{ok, squad}` | name 1–32 characters, colour `#rrggbb`; 400 with the reason |

The update routes' requests, answers, error codes and events are written out in
`internal/features/updates/README.md`. Nothing contacts GitHub unless one of them is called.
The squad routes, the `squad` event and the peer API are written out in
`internal/features/squad/README.md`.

**Files:** `guard.go` (the Host, Origin and JSON-body checks), `routes.go` (route table and handlers), `updates.go` (the update routes), `squad.go` (the squad
routes), `backend.go` (the `Backend` interface and
`SettingsChange`), `helpers.go` (JSON in and out, JavaScript-style text and limits), `static.go`
(page, modules, map art, fonts).

**Tests:** `guard_test.go`: our hosts on our port pass for the page, its files and the live
events; a foreign host, another port or no port → 421; a foreign, `null`, other-port or https
Origin, or a cross-site/same-site `Sec-Fetch-Site`, → 403 on state-changing requests (GETs
pass); `text/plain`, form or untyped bodies → 415; refused requests never reach the route.
`internal/app/guard_test.go`: the hosts use the bound port, a second launch still finds the
running copy, and a cross-site POST to `/api/updates/check` gets 403 without asking GitHub.
`internal/app/squad_test.go`: the squad routes (413/400/415 on the share, join/leave/profile
answers, the peer API's paths are 404 on this server).
`static_test.go`: explicit content types, `*.test.js` and non-JS files under `/js/` refused, ETag and 304, fonts from `assets/fonts.json`, unknown paths "Not found", the state round trip, the request size limit and acks (with a small fake `Backend`). The routes were also compared with v2's Bun server in the ticket 04 parity
run.
