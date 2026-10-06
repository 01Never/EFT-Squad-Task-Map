# Check for updates (page side)

The server side (signed manifest, download, swap, restart, the HTTP routes and the `updates`
event) is in [`internal/features/updates`](../../../../internal/features/updates/README.md); its
README is the contract. This folder is the **Settings → Updates** section, the dot on ⚙ Settings,
and the "Updated to X" notice.

**What it does (player's view):** Settings → Updates says "You're on 2.6.0" and has **Check for
updates**. "Last checked 5 min ago" appears only after a check. The result is "You're up to date.",
or "2.7.0 is available" with the release notes, the download size, **View on GitHub** and
**Download and restart** (it asks "Yes, download and restart / Not now" first), or the server's
plain message when something is wrong (no internet, GitHub unreachable, no release yet, "This
update isn't from the owner; not installed", …). While downloading there's a progress bar and
**Cancel**. After the restart the page reloads by itself and shows **Updated to 2.7.0** with the
notes, once. After a check found a newer version a small dot shows on **⚙ Settings** until the app
is updated (the new copy starts with no result, so the dot goes by itself). Under `go run`
(`canApply` false) the button is disabled and shows the server's `cannotApplyMessage`.

**Where the data comes from:** `app.status.updates` (from `/api/status` at load, then every
`updates` live event replaces it). The page never polls and never contacts an update route unless
the player clicks.

**The rules** (`rules.js`):
- `viewForStatus()`: a running phase wins (checking, downloading, installing = ready/applying);
  otherwise the last result (available, up to date); otherwise the start view. An `error` is shown
  next to whichever view, in the server's words; `folder-not-writable` adds a link to `releaseUrl`.
- `isBusy()` disables Check for updates while any step runs; `canDownload()` is `canApply`.
- `showsUpdateDot()`: result "available" with a release, until the app is updated.
- `formatSize()` (B / KB / MB), `downloadProgress()` ("3.2 of 12.0 MB (26%)" and the bar fraction),
  `lastCheckedText()` (empty until a check has finished).
- `shouldReloadAfterReconnect()`: reload when the server reports another version than the page
  started with. `safeLink()`: only http(s) addresses become links.

**Flow:**
```
Click Check → POST /api/updates/check → answer.status → renderSection()          (the page shows "Checking…" at once)
Click Download and restart → confirm → POST /api/updates/download {version}
  → "updates" events (progress, at most every 250 ms) → bar moves (transform only)
  → event phase "ready" (and this page asked for it) → POST /api/updates/apply
  → the stream drops; on reconnect onStreamConnected() reads /api/status
  → new version → location.reload() → main.js showUpdatedNotice() → POST /api/updates/seen
```
If any step fails the answer's `status.error` is shown and the old version keeps running. A
download that was started from another tab isn't installed by this page: only the page where the
player confirmed installs it.

**Saved data / settings:** none. Nothing is stored in the page's saved data or settings; the
server keeps the status in memory.

**Light while Tarkov runs:** no timers. The only continuous work is the progress bar while a
download runs (an HTML element in the dialog, moved with `transform`, redrawn at most 4 times a
second by the server's events). The map is not touched.

**Files:**
- `rules.js`: the decisions and texts above.
- `panel.js`: the Updates box in the Settings dialog, its clicks, the `updates` event handler, the
  reload after a restart, the dot (`#settings.has-update`) and the "Updated to X" dialog.
- `updates.css`: the notes box, the progress bar and the dot.
- Wiring: `features/settings/panel.js` (the box), `app/live-events.js` (`updates` event and stream
  reconnect), `main.js` (dot and notice at start-up).

**Tests:** `rules.test.js` covers every rule above. The flow was driven in headless Chromium
against `cmd/mock`'s fake GitHub (up to date, new version, no release, bad signature, progress,
cancel, apply → reload → "Updated to" once, and zero GitHub requests until a click).
**Needs the owner on Windows:** the real swap of the running `.exe` and the reload after it (see
the server README).
