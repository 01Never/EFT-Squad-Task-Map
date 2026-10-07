# Fake tailnet (`cmd/faketailnet`, test tool for ticket 05)

**What it does (owner's view):** a whole Tailscale network on this PC, for testing the squad
without real PCs or a Tailscale account: a coordination server, a relay (DERP) and STUN, all on
127.0.0.1, plus an HTTP "admin console" (machines, delete, expire key, policy, relay-only). Copies
of the app join it from Settings → Squad like the real one, with the invite codes below.
**Test-only:** it is never built into the app (`go build .` doesn't include `cmd/`), and the app
only uses it when `STM_SQUAD_CONTROL_URL` points at it.

**Where it comes from:** Tailscale's own test packages, pinned with the app's `tailscale.com`
version: `tstest/integration/testcontrol` (the coordination server: Noise handshake, registering
nodes, addresses, map responses), `derp/derpserver` (the relay) and `net/stun` (STUN replies).
This tool adds the parts of the real service the squad depends on, through testcontrol's two hooks
(`MaybeRejectRequest` for register requests, `AltMapStream` for map polls).

## Run it

```
go run ./cmd/faketailnet                      # prints its address; Ctrl+C stops it
go run ./cmd/faketailnet -listen 127.0.0.1:7870 -state <folder>
```
It prints (stdout), for scripts to wait on:
```
faketailnet: control http://127.0.0.1:7870
faketailnet: admin http://127.0.0.1:7870/admin/
faketailnet: invite codes tagged=… expired=… untagged=…
faketailnet: ready
```
Then start copies of the app with `STM_SQUAD_CONTROL_URL=http://127.0.0.1:7870` (and their own
`STM_DATA_DIR` and `PORT`) and join with the tagged code. `-listen` must be on 127.0.0.1 or ::1;
the relay and STUN take free ports on 127.0.0.1. `-state` holds the test nodes' state (default: a
temporary folder, removed at exit).

## The rules (`rules.go`)

| Rule | Function | Numbers and why |
|---|---|---|
| Three invite codes, like keys made in the admin console | `InviteCodeTags` | `tskey-auth-faketailnet-squad-0001`: reusable, tagged `tag:stm` (the squad's kind); `tskey-auth-faketailnet-expired-0002`: refused "invalid key: this auth key has expired"; `tskey-auth-faketailnet-untagged-0003`: joins with no tag. Anything else: "invalid key: unknown auth key". (Tailscale's real wording may differ; the app shows whatever the server says.) |
| Who may register | `DecideRegistration` | a known machine comes back with no code (restart); a known machine asking for an expiry in the past is logging out; a new node needs a good code; a new node with no code is sent to an interactive log-in (an auth URL nobody completes). A deleted machine's key counts as unknown. |
| MagicDNS names are unique | `DNSLabelFor`, `MagicDNSName` | the host name, lower-cased, other characters → `-`; when another machine (online or not, logged out or not) has it: `-1`, `-2`, …; only deleting a machine frees its name. Full name `<label>.faketailnet.ts.net.` |
| The policy (ACL) | `ACLAllows`, `CanSeeEachOther`, `PacketFilterFor` | `squad` (default, the owner's policy): `tag:stm` → `tag:stm` on TCP 7777 only; nodes only get the peers they may talk to, so an untagged node sees no squad node. `open`: everyone reaches everyone (Tailscale's default policy), to check the app's own `tag:stm` check. An empty filter can't be sent (it would mean "unchanged"), so "accept nothing" is a rule from 192.0.2.1 (TEST-NET-1), which no node has. |
| Online | `tailnet.serveMapStream` | a machine is online while it holds a map stream (Tailscale's own signal); closing the app closes it at once. testcontrol's `AllOnline` is not used. |
| Logged out, expired, deleted | `tailnet.register`, `signOutMachine`, `describeNodeLocked` | log-out (Leave): the machine **stays listed** as logged out and keeps its name, until deleted (the stm-<id>-1 risk, which the app now avoids by taking a new player id on Leave; `logoutRemovesMachine: true` removes it instead, to compare; what real Tailscale does is for the owner's test). Expire: listed, key expired, peers see it expired. Delete: gone from every list. Expired and deleted machines get a key expiry in the past in their own map, so they go to "needs log-in". |
| Relay-only | `ShouldRelayFrame`, `IsDiscoPacket` | see below |

### How relay-only forces every packet through the relay

Tailscale finds direct paths two ways: the endpoints each node reports to the coordination server
(passed on in map responses), and disco messages (pings and "call me maybe", which carry a node's
direct addresses) sent to the peer through the relay. In relay-only mode the tool removes both:
map responses carry **no endpoints**, and the relay **drops every disco message** (they start with
a 6-byte magic in the clear; WireGuard data doesn't). With no direct address known, WireGuard
keeps sending through the relay. It applies to paths made after it is switched on: paths that
already work directly stay direct, so restart the copies after switching it on.

**Proof it worked:** `GET /admin/relay` counts the WireGuard bytes relayed between each pair of
machines; a drawing sent in relay-only mode raises the sender → friend counts. A test node's
`GET /admin/test-nodes/{name}/paths` shows `direct: ""` (no direct address in use) for every copy.
In normal mode the same call shows a direct `127.0.0.1:<port>` path.

## The admin API (on the control address, under `/admin/`)

JSON in and out. Requests with an `Origin` or `Sec-Fetch-Site` header (a browser page) get 403.

| Route | What it does |
|---|---|
| `GET /admin/invites` | `{tagged, expired, untagged}`: the three codes |
| `GET /admin/nodes` | the machine list (deleted ones left out), oldest first: `[{id, name, dnsName, hostName, tags, online, loggedOut, expired, addresses, inviteCode, created, lastSeen}]` |
| `POST /admin/nodes/{id or name}/delete` | delete a machine (as in the console); 404 if unknown |
| `POST /admin/nodes/{id or name}/expire` | expire its key |
| `GET /admin/settings`, `PUT /admin/settings` | `{acl: "squad"\|"open", relayOnly, logoutRemovesMachine}`; a PUT changes only the fields sent; every node gets a new map at once |
| `GET /admin/relay` | `{pairs: [{from, to, packets, bytes}], discoRelayed, discoDropped}`: WireGuard data relayed per pair of machines, disco messages relayed or dropped |
| `POST /admin/test-nodes {hostName, inviteCode, serveShare?}` | start a **test node**: a plain tsnet node in this process (an intruder, an impostor, a witness). With `serveShare` (a share's JSON) it answers on its own `:7777` like a copy's peer API (`/squad/v1/share`, and one event on `/squad/v1/stream`). Answers `{hostName, addresses}`, or 502 with Tailscale's reason |
| `POST /admin/test-nodes/{hostName}/fetch {url}` | a GET from that test node through the tailnet: `{status, body, error}` (status 0 and an error such as a timeout when the policy drops the packets) |
| `GET /admin/test-nodes/{hostName}/paths` | how the test node reaches each peer it sees, after a TSMP ping to each: `[{dnsName, online, direct, relay, rxBytes, txBytes, ping}]` |
| `DELETE /admin/test-nodes/{hostName}` | stop it and delete its machine |

## Flow

```
app (tsnet, STM_SQUAD_CONTROL_URL) → /key, /ts2021 (Noise) → testcontrol
  register → MaybeRejectRequest → tailnet.register (DecideRegistration) → testcontrol creates the node
  map poll → AltMapStream → tailnet.serveMapStream: stores endpoints; streams one full map per change
           (testcontrol's MapResponse → applyRules: names, tags, online, expiry, peers, filter)
  WireGuard → direct UDP between copies, or the relay: relayFilter (counts; drops disco in relay-only)
admin API → tailnet (settings, delete, expire) → every open map stream gets a new map
```

## Files
`main.go`: flags, start-up, the lines it prints. `rules.go`: every rule above (pure). `tailnet.go`:
the hooks on testcontrol, the machine list, online state, the admin console's actions.
`derp.go`: the relay with its frame filter and counters, and STUN. `admin.go`: the admin API.
`testnodes.go`: test nodes (intruder, impostor, witness).

## Tests
- `rules_test.go`: invite codes, registration decisions (restart, log-out, new node, refused,
  no code), unique names (`-1`, `-2`), the policy and packet filters, relay-only frame filtering.
- `tests/browser/squad-tailnet.e2e.mjs` drives it end to end with three app binaries (see
  `tests/browser/README.md`).
- **Windows:** the test nodes are real tsnet nodes, which bind UDP on every interface: Windows
  Firewall asks about the binary the first time (the app's copies too). The browser scenario only
  runs there with `STM_E2E_TAILNET=1`.
- **What it can't show:** real NAT traversal between two PCs, the real admin console's wording and
  behaviour (whether a logged-out machine stays listed), Windows Firewall, and real network delays.
