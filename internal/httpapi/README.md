# Web server (`internal/httpapi`)

**What it's for:** the route table and thin handlers: decode the request, call the app (the
`Backend` interface, implemented in `internal/app/backend.go`), encode the answer. It also serves
the page itself (`web/index.html` and the `web/js/` modules as they are, no bundler), the map art,
the fonts and the maps config, all built into the exe.

**What it deliberately doesn't do:** any feature logic (it lives in the features; `internal/app`
connects them); log-in or CORS (the server only listens on 127.0.0.1, so only this PC reaches it).

**The rules / limits:**
- Listens on `127.0.0.1` only, on the first free port from 7777 to 7800 (`PORT` changes the
  start). A second copy of the app on the same data folder just opens the running one's page and
  exits (`internal/app/run.go`).
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
| `GET /api/status` | everything the page shows about the program | version, data, settings, logs, screenshots, keybind, raid, gps, trail, capture, ai |
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

**Files:** `routes.go` (route table and handlers), `backend.go` (the `Backend` interface and
`SettingsChange`), `helpers.go` (JSON in and out, JavaScript-style text and limits), `static.go`
(page, modules, map art, fonts).

**Tests:** `static_test.go`: explicit content types, `*.test.js` and non-JS files under `/js/` refused, ETag and 304, fonts from `assets/fonts.json`, unknown paths "Not found", the state round trip, the request size limit and acks (with a small fake `Backend`). The routes were also compared with v2's Bun server in the ticket 04 parity
run.
