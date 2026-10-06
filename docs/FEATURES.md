# Features: start here

One row per feature. Open the feature's page folder (and, after ticket 04, its Go package) to see
everything about it. Each folder has a README with the rules, the flow and the tests.

Features built before the roadmap (tasks, parts, readiness, scan, logs, AI Categorize, drawing…)
still live in the v2 layout (`web/js/*.js`, `web/js/logic/`, `server/*.ts`); see `HANDOFF.md` §4.
Ticket 04 adds their Go packages and ticket 04b moves their page code into `web/js/features/`.

| Feature | Ticket | Go package | Page folder | Saved data it owns | Events | Settings |
|---|---|---|---|---|---|---|
| Find me: player marker, pulse, off-screen chip, Find me button, auto-center (⌖ Follow) | 01, 02 | (server: `server/gpsname.ts`, `main.ts` until 04) | `web/js/features/find-me/` | none (pulse start in memory) | receives `gps` | `followPosition` (switch map), `autoCenter` |
