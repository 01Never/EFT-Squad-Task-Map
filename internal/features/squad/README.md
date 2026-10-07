# Squad (`internal/features/squad`, ticket 05)

**What it does (player's view):** friends running the app see each other's **drawings** live and,
if each chooses to, each other's **tasks** (with ticks, so "Mike 2/5" works). There's no website
and no server: the copies connect directly over a private Tailscale network built into the exe
(tsnet). You join once with an invite code. A friend who is offline still shows with their last
known data and "last seen". No GPS position is shared (owner's decision).
This package is the server side (part 1 of ticket 05). The page (Settings → Squad, chips,
friends' layers, "Also: …" badges) is part 2, in `web/js/features/squad/`.

**Where the data comes from:**
- **Your share:** the page builds it from its saved data and sends it with
  `PUT /api/squad/share` (about 1 s after a save). The server stamps it and keeps the last one in
  `squad-task-map-squad.json`, so friends get it again after a restart.
- **Friends' shares:** each friend's copy, over the tailnet, from its **peer API** (below).
- **Who your friends are:** the tailnet's peer list (nodes tagged `tag:stm`, named
  `stm-<player id>`), followed on Tailscale's IPN bus (event-driven, no polling).

**Never shared:** the OpenAI key, folder paths, screenshots, settings, bring-list counts,
categories, AI chats, your position. The server only ever sends what's in the share below.

## The rules (`rules.go`)

| Rule | Function | Numbers and why |
|---|---|---|
| A share is `{v, player, rev, updatedAt, draw, tasks}` | `Share` | `v` = 1 (`ShareFormatVersion`); `updatedAt` in ms since 1970 |
| `rev` goes up only when the content changes | `StampShare` | content = player (id, name, colour) + drawings + tasks; the same content again keeps rev and updatedAt |
| Tasks are dropped when "Share my tasks" is off | `StampShare` | enforced by the server, whatever the page sends; turning it off re-stamps at once (rev + 1, `tasks: null`) |
| Everything received is checked; a bad share is dropped whole and logged once | `DecodeShare`, `ValidateShare`, `ValidateParts` | ≤ 2 MB (`MaxShareBytes`, ticket's cap); player id 16 lower-case hex; name 1–32 characters (not bytes), no control characters, no bidi controls or zero-width spaces, at least one visible character, no spaces at the ends; colour `#rrggbb`; task and objective ids exactly 24 lower-case hex characters (what the real game data has: all 515 task ids and 1441 objective ids in the bundled snapshot; so `toString`, `__proto__` and the like can't get in); map keys `[A-Za-z0-9_-]{1,64}` and never a name of a JavaScript object property (`__proto__`, `constructor`, `prototype`, `toString`, `valueOf`, `hasOwnProperty`, …); ≤ 64 maps, ≤ 5000 strokes a map, 1–10000 `[x, z]` points a stroke, width 0–1000, coordinates within ±1e6, stroke colour `#rgb`/`#rrggbb`; ≤ 2000 tasks, ≤ 200 ticks each, a tick is `true` or a whole number 0–100000, `pct` 0–100 |
| A friend's share is new when rev or updatedAt differ | `HasChanged` | not "higher": a friend who reset their data starts again at rev 1 |
| On the tailnet a share must carry the id its node is named after | `ShareFitsPeer` | so one friend can't pose as another (the dev transport has no names) |
| Friends are the online `tag:stm` nodes whose MagicDNS name is exactly `stm-<player id>` | `SquadPeers` | the id comes **only from the DNS name's first part**, which the tailnet keeps unique (a clash becomes `stm-<id>-1`, which doesn't count), never from the host name, which each node picks itself; connections are keyed by the node's stable id; when two machines claim one id (`stm-<id>` and `stm-<id>-1`, online or not), **neither** is trusted and one console line says to delete the old machine; IPv4 address preferred; yourself left out |
| The peer API answers only squad nodes, at its own address | `IsOwnHost`, `HasSquadTag` (tsnet, via `WhoIs`), `IsLoopbackCaller` (dev), `IsBrowserRequest` | the `Host` must be our own address as an IP literal with the port (else 421): a page on a rebinding domain sends its own name, even on a same-origin fetch with no browser headers; any request with `Origin` or `Sec-Fetch-Site` → 403 |
| One friend can't flood you | `MinShareInterval`, `ChangeInterval` | at most one share a second is taken from each friend: newer ones replace the waiting one, so the last one sent always wins; the page's `squad` event and the cache file are updated at most once a second (the first change at once). QA's flood (rev+1 in a loop) made 32k page events in 10 s before |
| One caller can't hold every stream | `StreamsPerCaller` | ≤ 2 open streams per tailnet machine (by stable node id), 16 in all; dev: 5 per caller, since every copy on this PC calls from 127.0.0.1 |
| Names are shown as text | `IsValidName`, `NormalizeName` | bidi controls and zero-width spaces (U+200B, U+200E, U+200F, U+202A–U+202E, U+2060–U+2069, U+FEFF) are **removed** from the name you type (`PUT /api/squad/profile`), then it is trimmed; blank (or only zero-width joiners) is refused. The zero-width joiner and non-joiner (U+200C, U+200D) are allowed: emoji like 👨‍👩‍👧 and some Persian and Indic names need them. In a friend's share they are **refused** (the share is dropped), since a friend's copy never sends them. Markup and quotes are still accepted: **the page must insert names as text (escaped)** |
| Reconnecting waits 1 s, 2 s, 4 s … 60 s | `RetryDelay` | ticket 05; starts over after a stream delivered a valid share |
| Status line | `StatusText` | "Connected · 3 of 4 friends online"; "Connected · no friends seen yet"; "Connecting…"; "Signed out of the squad network: leave, then join again with an invite code"; "Squad connection failed: …"; "Not in a squad" |
| Profile | `NormalizeName`, `NormalizeColor`, `NewPlayerID` | name cleaned (invisible characters removed, trimmed), 1–32 characters; colour lower-cased `#rrggbb`; defaults "Player" and `#4dabf7`; player id made once, and a **new one on Leave** (below) |
| Leaving gives a fresh identity | `Squad.Leave`, `NewPlayerID` | owner's decision: a tailnet may keep a logged-out machine listed, and a rejoin under the old name would become `stm-<id>-1`, which friends never trust. A new player id makes the next Join a brand-new `stm-<new id>` machine, so rejoining always works without touching the admin console. Your share keeps its drawings and tasks, gets the new id, and its rev **goes on** (+1). Friends see a new friend (their per-friend switches start over); the old id stays in their list, offline, until it is 30 days old. Only when you were in a squad (Leave when not joined keeps the id) |
| Friends not seen for 30 days are dropped | `PruneStaleFriends`, `StaleFriendAge` | owner's decision; checked when the cache is loaded (start-up) and each time it is written; no timer |
| A failed join shows only the reason | `JoinFailureText` | tsnet's "Tailscale is starting. Please wait." and "You are logged out. The last login error was:" are removed; anything saying expired becomes "this invite code has expired.", otherwise the text from "invalid key: …" on, otherwise what is left. The whole text goes to the console |
| An invite code looks like a Tailscale auth key | `IsPlausibleAuthKey` | starts with `tskey-`, no spaces, ≤ 200 characters (Tailscale does the real check) |

## Flow

```
page saves → PUT /api/squad/share → Squad.SetMyShare → StampShare → squad-task-map-squad.json
           → shareFeed.publish → every friend's open GET /squad/v1/stream gets the whole share
           → "squad" event to your own page (your rev)

tailnet IPN bus change → TsnetTransport.WatchPeers → SquadPeers → friendLinks.reconcile
  per friend: GET /squad/v1/share, then GET /squad/v1/stream (held open; newest event kept)
           → at most 1/s: DecodeShare + ShareFitsPeer → Squad.onFriendShare
           → cache file and "squad" event, each at most 1/s → page
  stream ends → onFriendStreamClosed (lastSeen) → "squad" event; reconnect after RetryDelay
  friend goes offline on the tailnet → its connection is cancelled at once
```

- **Never joined:** nothing starts. No tsnet, no listener, no goroutine, no timer, no traffic.
- **Joined:** idle cost is tsnet's own keep-alives and the open streams. Shares are sent only when
  they change. No polling: the peer list comes from the IPN bus, shares come on the streams, and a
  stream has no keep-alive timer (a friend that vanished is noticed when the tailnet marks them
  offline). The only timers are the reconnect backoff (≥ 1 s, ≤ 60 s) while a listed friend's
  copy doesn't answer, and single one-shot timers while a change waits for its second to end
  (none when idle).

## Transports (`transport.go`, `tsnet.go`)

`internal/app` picks one (`internal/app/squad.go`):
- **tsnet** (default): a Tailscale node inside the exe. Hostname `stm-<player id>`, state folder
  `squad-task-map-tailscale/` next to the data files (holds the node key: secret), peer API on the
  tailnet at `:7777` only. Starts only when `joined`. Joining waits up to 90 s for the tailnet to
  accept the invite code; a failed join reports Tailscale's own reason (e.g. "invalid authkey",
  from its health messages, rather than "context deadline exceeded"), closes the node and deletes
  the state folder. After a
  restart it resumes from the node key, with no invite code; without a node key it shows
  "Signed out…" instead of starting. When the tailnet signs the node out (machine deleted, key
  expired) it shows "Signed out…" and stops the node (it would otherwise keep asking for a log-in).
  Log uploads to Tailscale are off (`TS_NO_LOGS_NO_SUPPORT`). tsnet's own log goes to the state
  folder (`tailscaled.log1.txt`, `tailscaled.log2.txt`, `tailscaled.log.conf`, next to
  `tailscaled.state` and `profile-data/`). `TS_LOGS_DIR` points tsnet's separate "logs folder"
  lookup there too: without it, on Linux it creates `/var/lib/tailscale` (checked); on Windows it
  only computes `%LocalAppData%\Tailscale` and writes nothing. So nothing is written outside the
  app's files. `STM_SQUAD_DEBUG=1` prints tsnet's own log in the console.
- **dev** (`STM_SQUAD_DEV_LISTEN=127.0.0.1:7901`, `STM_SQUAD_DEV_PEERS=127.0.0.1:7902,127.0.0.1:7903`):
  no tsnet at all. The peer API listens on that address (it must be on this PC, else the variable
  is ignored) and answers only 127.0.0.1/::1. Friends are the listed addresses; a friend's identity
  is the player id in its share. Same lifecycle as tsnet: it runs only while joined, and join takes
  any `tskey-…` text. Three copies with separate `STM_DATA_DIR`s make a squad on one PC.

## The page's API (127.0.0.1, behind `httpapi.Guard`)

All bodies are JSON sent as `application/json` (415 otherwise). Times are ms since 1970.

### `GET /api/squad` → the squad view
```jsonc
{
  "me":        { "playerId": "0123456789abcdef", "name": "Mike", "color": "#4dabf7",
                 "rev": 42, "updatedAt": 1791336708099 },   // rev/updatedAt 0 until a share was sent
  "settings":  { "shareTasks": false, "joined": true },
  "transport": "tsnet",                                        // or "dev"
  "status":    { "state": "connected",                         // off | starting | needsLogin | connected | error
                 "text": "Connected · 2 of 3 friends online",  // show as is
                 "friendsOnline": 2, "friendsKnown": 3,
                 "problem": "" },                               // the error, for state "error"
  "friends": [                                                  // sorted by name, then id
    { "playerId": "fedcba9876543210", "name": "Sam", "color": "#ff922b",
      "online": true, "lastSeen": 1791336708099,
      "share": { "v": 1, "player": {…}, "rev": 7, "updatedAt": …,
                 "draw":  { "<mapKey>": [ { "c": "#ff4d4d", "w": 2.5, "pts": [[x, z], …] } ] },
                 "tasks": null | { "<taskId>": { "ticks": { "<objId>": true | 3 }, "pct": 40 } } } }
  ]
}
```
- A friend is **online** while their stream is open. Offline friends keep their last share;
  `lastSeen` is when their stream closed or their last share arrived.
- Friends' data is read-only. Draw friends' strokes in the friend's `color` (owner's default),
  not the strokes' own `c`.

### `PUT /api/squad/share {draw, tasks}` → `{ok, rev, updatedAt, changed, tasksShared, inSquad}`
- `draw`: the page's `draw` (by map key, strokes `{c, w, pts}`); `tasks`: by task id
  `{ticks, pct}`, or `null`. Any other field is ignored (the server stamps `v`, `player`, `rev`,
  `updatedAt`).
- `changed: false` when the content is the same as the last share (rev unchanged).
  `tasksShared: false` when "Share my tasks" is off: the tasks were dropped. `inSquad: false`: kept
  for when you join; nobody gets it now.
- Over 2 MB → **413**; not the shape or limits above → **400** `{ok: false, error: "The share isn't valid: …"}`.
- Send it debounced (~1 s after a save), and again after turning "Share my tasks" on (the server
  never keeps tasks while sharing is off, so it has none to add by itself).

### `POST /api/squad/join {authKey}` → `{ok: true, squad: <view>}`
- Answers once the tailnet has accepted the code (up to 90 s) and the peer API listener is open (so a friend can connect the moment it returns), then the session runs. The code is
  used once and never saved; the node key in `squad-task-map-tailscale/` is enough from then on.
- **400** "That isn't an invite code. It starts with tskey-"; **409** "Already in a squad. Leave it
  first to join another"; **502** "Couldn't join the squad: …" (Tailscale's reason; nothing kept).

### `POST /api/squad/leave` → `{ok: true, squad: <view>}`
Stops the session, logs the node out of the tailnet, deletes `squad-task-map-tailscale/`, forgets
friends' shares (the cache keeps only your own share) and sets `joined` to false. Always succeeds
(a failed log-out is logged; the folder is deleted anyway).

### `PUT /api/squad/profile {name?, color?, shareTasks?}` → `{ok: true, squad: <view>}`
Only the fields sent change. Name cleaned (bidi controls and zero-width characters removed, then trimmed), 1–32 characters; colour `#rrggbb` (any case, saved
lower-case). **400** with "Your name must be 1 to 32 characters" or "Your colour must look like
#4dabf7". Your share is re-stamped at once, so friends see the new name or colour, and lose your
tasks as soon as sharing is turned off.

### Live event `squad` (broadcast)
`{"type": "squad", "squad": <the same view as GET /api/squad>}`, whenever the status, a friend's
share, a friend's online state, your profile or your share's rev changes; at most once a second
(the first change at once, the latest state always sent last). Not queued: a page
opened later reads `GET /api/squad`. (`internal/events/names.go` and `web/js/app/event-names.js`.)

## The peer API (the tailnet listener, or the dev address; never the page's server)

| Route | Answer |
|---|---|
| `GET /squad/v1/share` | your latest share (`application/json`), or 404 "Nothing shared yet" |
| `GET /squad/v1/stream` | Server-Sent Events: `: squad`, then `event: share` / `data: <share JSON>` now (if there is one) and again whenever it changes. No keep-alives. |

Refused before any route: a `Host` that isn't our own address as an IP literal with the port
(`127.0.0.1:7901`, `100.x.y.z:7777`, `[fd7a:…]:7777`) → 421 (DNS rebinding); any request with
`Origin` or `Sec-Fetch-Site` → 403; callers that aren't `tag:stm` nodes (tsnet `WhoIs`) or not on
this PC (dev) → 403. Only GET; no request body; headers ≤ 16 KB, 10 s to send them; a kept-alive
connection idle for 60 s is closed; each stream write must finish within 10 s (a caller that
stops reading loses its stream); ≤ 2 open streams per tailnet machine (5 per caller on the dev
transport), ≤ 16 in all (503 beyond). As a client: answers' headers within 15 s, a share or one
SSE event ≤ 2 MB, at most one share a second taken from each friend (the newest).

## Saved data / settings
- `squad-task-map-settings.json`, block `"squad"` (unknown fields inside it are kept):
  `playerId` (made once; a new one on Leave), `name`, `color`, `shareTasks` (default false), `joined`. Never the
  invite code.
- `squad-task-map-squad.json`: `{"v": 1, "mine": <my share> | null, "friends": {"<playerId>":
  {"lastSeen": …, "share": …}}}`. Re-checked when read; a friend that fails the checks is left out.
- `squad-task-map-tailscale/`: tsnet's state (node key, its logs). Secret. Deleted by Leave, and
  only a folder with exactly this name (`StateFolderName`).

## Files
`rules.go`: every rule above (pure). `squad.go`: the `Squad` (settings, my share, friends,
join/resume/leave/stop, the session). `peerapi.go`: the peer API server and the feed that wakes
friends' streams. `peers.go`: one connection per friend (fetch, stream, backoff, checks, log once).
`transport.go`: the `Transport` interface and the dev transport. `tsnet.go`: the tsnet transport.
`cache.go`: `squad-task-map-squad.json`. `throttle.go`: "at most once a second, last change
kept" for the page event and the cache file. Wiring: `internal/app/squad.go`; routes:
`internal/httpapi/squad.go`.

## Tests
- `rules_test.go`: rev stamping, tasks stripped when sharing is off, validation rejects bad peer
  data (about 35 cases), ticks, backoff schedule, caller checks (loopback, tag, browser), peer list
  rules, identity check, "new share" rule, profile rules, status line.
- `rules_peers_test.go`: who a friend is (DNS name only, keyed by node id; `-1` names and host
  names don't count; two machines with the same host name or id → neither trusted), the `Host`
  check, `__proto__`/`constructor`/`prototype`/`toString`… refused, and names with markup accepted (the page
  escapes them) but RTL override, zero-width characters and bidi isolates refused; ids that aren't 24 hex characters refused.
- `squad_test.go`: **three copies on the dev transport** (A's share reaches B and C; an update
  propagates; B's tasks aren't sent; C goes offline and A keeps C's share with `lastSeen`, also in
  the cache file; C comes back and refreshes), cache read/write, rev kept across a restart,
  player id made once, sharing off re-stamps, Leave deletes the state folder and forgets friends
  (and only deletes a folder with that name), the peer API's caller and `Host` checks (a
  rebinding domain gets 421), the per-caller stream cap, the server's idle and write limits,
  **a friend sending 1000 shares in a burst** (taken 2–3 times, the last one wins) and **1000
  shares into the squad** (1–3 page events and file writes, rev 1000 in both).
- `tsnet_test.go`: **real tsnet nodes on a fake tailnet** (Tailscale's in-process control server
  and DERP on 127.0.0.1; no internet): a wrong invite code is refused with Tailscale's reason
  ("invalid authkey") and leaves nothing; two
  copies join and share; the code is in no file; an untagged tailnet node gets 403; a restart
  reconnects with the node key alone; Leave deletes the node key; a node the tailnet signs out
  shows "needsLogin". Skipped with `go test -short`, and on Windows unless
  `STM_SQUAD_TSNET_TEST=1` (tsnet binds UDP on every interface, so Windows Firewall would ask
  about every new test binary).
- `internal/app/squad_test.go`: never joined starts nothing; the server drops tasks the page sent
  with sharing off (checked through the real peer API); 413/400/415 on the share route;
  join/leave/profile through the routes; the code isn't in the settings file; the peer API isn't
  on the page's server; a joined copy reconnects at launch.
- **A simulated tailnet for whole copies:** `cmd/faketailnet` (Tailscale's test control server,
  DERP and STUN on 127.0.0.1, with invite codes, the `tag:stm` policy, unique `-1` names, delete /
  expire, relay-only) and `tests/browser/squad-tailnet.e2e.mjs`, which joins three app binaries to
  it through the page (`STM_SQUAD_CONTROL_URL`, `TsnetConfig.ControlURL`). Before Leave made a
  new player id, it found that on a tailnet that keeps logged-out machines listed a rejoined copy
  was named `stm-<id>-1` and ignored until the old machines were deleted; now the rejoin is a new
  `stm-<new id>` and friends see it at once (checked there).
- **Known limits (accepted):** a `tag:stm` machine that names itself like a friend (only someone with the invite code can make one) makes friends trust **neither** it nor the real friend until it is deleted in the admin console ("trust neither" rule; a denial of service, not an impersonation). tsnet logs one `tshttpproxy: using proxy … for URL: "https://controlplane.tailscale.com/"` line at start even with `STM_SQUAD_CONTROL_URL`: a proxy lookup, not a connection.
- **Needs the owner:** a real tailnet with 2+ PCs (setup in `docs/HANDOFF.md`): join with the
  invite code, see each other online, share live; delete a machine in the admin console and see
  "Signed out…"; idle CPU with friends connected on Windows.
