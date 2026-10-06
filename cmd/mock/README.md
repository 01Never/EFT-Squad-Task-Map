# Offline mock (`cmd/mock`)

**What it does:** stands in for json.tarkov.dev, the OpenAI API and the Escape from Tarkov wiki,
so the app can be tested end to end with no internet and no real API key. It's the Go port of
v2's `tests/mock-server.ts`. It answers byte for byte the same, and its request log has the same
lines.

```
go run ./cmd/mock          # from the repo root; prints "mock up" once it's listening
```

Point the app at it:
```
STM_JSON_BASE=http://127.0.0.1:7820  STM_OPENAI_API=http://127.0.0.1:7820/v1  STM_WIKI_API=http://127.0.0.1:7820/wiki
```
(plus `STM_DATA_DIR`, `STM_LOGS_DIR`, `STM_SCREENSHOTS_DIR` and `STM_NO_BROWSER=1` for scratch
folders, as in `docs/HANDOFF.md`).

## Settings (environment variables)
| Variable | Default | Meaning |
|---|---|---|
| `MOCK_PORT` | `7820` | Port on 127.0.0.1. A missing, zero or unreadable value means 7820, as in v2. |
| `MOCK_DOCS` | `snapshot` | `snapshot`: the docs v2's mock built from the bundled snapshot. `real`: the real json.tarkov.dev files in `testdata/jsontarkovdev/`. Anything else stops with an error. |
| `MOCK_TESTDATA_DIR` | `testdata` | Where the testdata folder is, relative to the working folder. Set it if you don't run from the repo root. |

## Endpoints
The HTTP method is ignored, as in v2. Paths are checked in this order.

**Test controls**
| Request | Answer |
|---|---|
| `GET /log` | JSON list of the request log, oldest first (lines below). |
| `POST /set-rows` with a JSON body | That JSON becomes what the fake vision model reads. `{"ok":true}` |
| `POST /fail` with `{"fail":true}` | json.tarkov.dev answers 503 `down` until `{"fail":false}`. `{"ok":true}` |

**json.tarkov.dev:** `/<mode>/<name>`, with mode `regular`, `pve` or `pvp-season`.
- Names: `tasks`, `tasks_en`, `maps`, `maps_en`, `traders`, `traders_en`, `items_en`. Every mode
  gets the same files.
- Any other name: 404 `nf`. During `/fail`: 503 `down`.
- Logged as `json /<mode>/<name>`, even when it fails.
- `snapshot` docs come from `testdata/golden/mock-raw-docs.json.gz`: what v2's
  `tests/helpers.ts` `snapshotToRaw()` made. The file is pretty-printed, so each doc is compacted
  when it's loaded. That gives exactly the bytes v2 sent.
- `real` docs are `testdata/jsontarkovdev/regular-<name>.json.gz`, served unchanged.

**Wiki:** `GET /wiki?page=<title>` answers
`{"parse":{"title":<title>,"wikitext":"==Objectives==\n*Do the thing\n==Guide==\nIt's upstairs."}}`
for any title. Logged as `wiki <title>` (`wiki null` without `page`).

**OpenAI** (`/v1/...`):
- The `Authorization` header must be exactly `Bearer sk-test_1234567890abcdefghijkl`.
  Otherwise: 401 `{"error":{"message":"Incorrect API key provided"}}`.
- `GET /v1/models/<id>` → `{"id":"<id>"}`.
- `POST /v1/responses` logs
  `responses model=<model> vision=<true|false> reasoning=<JSON or null> imgBytes=<n>`. `imgBytes`
  is the length of `input` as JSON when there's an image, otherwise 0.
  - **Scan (vision):** `input` mentions `input_image`. The answer's `output_text` is
    `{"rows": [...]}`. The default rows are 8 tasks, including the misspelled
    "Seizing the Initative" and the made-up "Some Story Chapter", which exercise name matching.
    `/set-rows` replaces them.
  - **AI Categorize:** any other request. It reads the parts JSON after `PARTS:\n` in the first
    message. It creates a "Key runs" category (`#4dabf7`, star) and moves every part with an
    objective that has `keys` into it, with the reason `Needs <first key>`. The reply is
    `Moved N parts that need keys.` A request without `PARTS:` (the follow-up that carries wiki
    tool results) moves nothing.
- Any other `/v1/` path → 404 `nf`.

**Fake GitHub Releases** (ticket 04c, `github.go`): for testing "Check for updates" offline. Point
the app at it, and at the mock's TEST public key (the matching private key is
`testdata/updates/mock-private-key.txt`; it only ever signs the mock's manifests):
```
STM_UPDATES_BASE=http://127.0.0.1:7820/github/01Never/EFT-Squad-Task-Map
STM_UPDATES_PUBLIC_KEY=<contents of testdata/updates/mock-public-key.txt>
```
| Address | Answer |
|---|---|
| `/github/<repo>/releases/latest/download/latest.json` | 404 when no release is published, else a 302 to `…/releases/download/v<version>/latest.json` (as GitHub does) |
| `/github/<repo>/releases/download/v<version>/{latest.json,SquadTaskMap.exe}` | 302 to the "download host" |
| `/github-objects/<version>/latest.json` | the manifest, signed with the test key |
| `/github-objects/<version>/SquadTaskMap.exe` | a fake exe (`MZ mock exe v<version>` + filler, 200 KB), or the file named by `MOCK_UPDATE_EXE` (a script lets you watch the app start the "new" copy) |
| `POST /github-set` | change what it serves (below); `{"ok":true}` |

`POST /github-set` takes any of `"release"` (`"none"` = no release yet, `"published"`),
`"version"` (default `9.9.9`; set an older one to see "older version"), `"notes"`, `"exeSize"`,
`"fault"`, or `{"reset": true}`. Faults: `bad-signature` (signed by an untrusted key), `bad-hash`
(exe differs from the manifest), `wrong-size` (10 bytes short), `oversize` (twice as long),
`off-allowlist-redirect` (the download host redirect goes to `localhost` instead of
`127.0.0.1`), `huge-manifest` (over 64 KB), `server-error` (503 for latest.json),
`slow-download` (16 KB every 100 ms, to watch progress and Cancel). The request log gets one
line per request, `github <path>`: there are none unless the app was asked to check.

Anything else → 404 `nf`.

## How tests use it
- **By hand or from a script:**
  1. Start the mock.
  2. Start the app with the `STM_*` variables above.
  3. Drive it: append game log lines, drop screenshots, click.
  4. Read `GET /log` to check what the app requested. For example: no OpenAI call without a key;
     the hourly refresh asked for all seven files; scan sent a high-detail image.
- `POST /fail` checks that a json.tarkov.dev outage keeps the old data and shows the error.
- `MOCK_DOCS=real` runs the app on the real files, for the `/api/data` parity check.

## Matching v2 exactly (`javascript_json.go`)
v2 sent request data back through JavaScript's `JSON.stringify`. That covers the rows from
`/set-rows`, `reasoning`, the model and the part ids. So the mock reads JSON into `jsValue`,
which keeps JavaScript's rules:
- object key order, with array-index keys first;
- numbers written like JavaScript (`1.50` → `1.5`, `1e21` → `1e+21`);
- only quotes, backslashes and control characters escaped (`<`, `>`, `&` stay as they are);
- truthiness, `String(value)` (`model=undefined`) and UTF-16 text length for `imgBytes`.

**Known differences from v2:**
- A request that crashed v2's handler (a body that isn't JSON, a `/fail` body of `null`, a
  `/v1/responses` without `input`, PARTS that aren't a JSON list) gets 500. Bun sent its HTML
  error page; this sends the error as plain text.
- Very odd input that no client sends is answered sensibly rather than copied quirk for quirk:
  - content that's a list instead of text;
  - parts without an `objectives` list (500 here, as in v2, but the message differs);
  - lone UTF-16 surrogates;
  - `.`/`..` segments in the path, which JavaScript's URL would resolve.
- Go serves requests in parallel (a mutex guards the log, rows and outage flag). Requests that
  overlap may be logged in either order. One client making requests one at a time sees v2's order.

## Files
- `main.go`: settings and start-up.
- `server.go`: path dispatch, test controls, json.tarkov.dev files, wiki.
- `openai.go`: key check, models, vision and categorize answers.
- `github.go`: the fake GitHub Releases (ticket 04c).
- `documents.go`: loading the snapshot or real files.
- `javascript_json.go`: JavaScript-style JSON values.

## Tests
`go test ./cmd/mock`:
- each endpoint: files, outage, key check, vision and `/set-rows`, categorize, log lines, wiki,
  bad bodies;
- loading both doc sets from `testdata/`;
- the fake GitHub (`github_test.go`), driven by the app's own update code: published release,
  no release, each fault refused with its code, older version, reset, slow download and cancel,
  nothing logged until the app asks;
- JavaScript number format, key order, escapes and truthiness.

**Checked side by side against v2** (ticket 04): `bun tests/mock-server.ts` on one port and
this mock on another, with the same requests sent to both:
- every doc for `regular` and `pve`;
- unknown docs and paths;
- the wiki;
- models with good, bad and no key;
- vision, including a body escaped Go-style (`<`);
- categorize with keyed, unkeyed, `keys: []` and `keys: null` parts;
- a follow-up with no PARTS, and a request with no model;
- `/set-rows` with odd numbers and keys, then vision again;
- `/fail` on, a doc, `/fail` off;
- `/log`.

Every answer had the same status and content type and was byte-equal, apart from the bodies of
the 500 answers, which were expected to differ (see above). `MOCK_DOCS=real` serves the
decompressed files byte for byte.
