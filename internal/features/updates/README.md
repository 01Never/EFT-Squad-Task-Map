# Check for updates (`internal/features/updates`)

**What it does (player's view):** Settings → Updates → **Check for updates** tells you whether the
owner published a newer version on GitHub. If so you see what's new and press **Download and
restart**: the app downloads the new exe, checks it really is the owner's, swaps it in and starts
it, and your page reloads by itself. **Nothing happens unless you click:** no timers, no checks at
start-up, no background downloads. The app contacts GitHub only when you click Check for updates
(and Download and restart).

**Where the data comes from:** the repo's public GitHub Releases (`GitHubRepo` in `rules.go`,
`01Never/EFT-Squad-Task-Map`). Each release has two assets, built by `cmd/release`:
`SquadTaskMap.exe` and a signed `latest.json`:
```jsonc
{
  "version": "2.6.0",
  "released": "2026-10-20",
  "notes": "• Check for updates…",
  "file": { "name": "SquadTaskMap.exe", "size": 12582912, "sha256": "<64 lower-case hex>" },
  "signature": "<base64 Ed25519 signature>"
}
```
- Manifest: `https://github.com/01Never/EFT-Squad-Task-Map/releases/latest/download/latest.json`
  (GitHub's stable "latest release" address; **not** the REST API, so no 60-an-hour limit; "latest"
  skips drafts and pre-releases, so the owner can stage a release without anyone being offered it).
- Exe: `…/releases/download/v<version>/SquadTaskMap.exe` (version from the *signed* manifest).
- Both answer with redirects to GitHub's download host; they are followed only to allowed hosts.
- `STM_UPDATES_BASE` replaces `https://github.com/<repo>` (development only; `cmd/mock` serves a
  fake GitHub). Its host is then allowed too. `STM_UPDATES_PUBLIC_KEY` replaces the built-in key,
  but only when `STM_UPDATES_BASE`'s host is loopback (127.0.0.1, ::1, localhost); otherwise it is
  ignored with one console line. Neither skips any check.

## The rules (all in `rules.go` unless noted)

**What is signed.** `CanonicalBytes(manifest)`: the manifest **without `signature`**, as compact
JSON (no whitespace) with the keys in this order: `version`, `released`, `notes`,
`file{name, size, sha256}`; `< > &` are written as they are. The Ed25519 signature of those bytes
is stored base64 in `signature`. `cmd/release` signs with `SignManifest`; the app checks with
`VerifySignature`; both call the same `CanonicalBytes`, so whitespace or key order in `latest.json`
never matters. Fields other than these five are ignored (and so unsigned: never act on them).

**Refusals** (each has a code and the message the page shows as is; `errors.go`):

| Situation | Code | Message |
|---|---|---|
| This build still has the placeholder key | `no-public-key` | This copy can't check for updates yet: it has no owner key built in. |
| Name lookup fails | `no-internet` | No internet connection. Check it and try again. |
| Connection fails / times out (20 s) / HTTP error | `github-unreachable` | Couldn't reach GitHub (…). Try again in a few minutes. |
| 404 on the latest-release address | `no-release` | No release has been published yet. |
| Signature doesn't verify | `bad-signature` | This update isn't from the owner; not installed. |
| Not JSON, wrong file name, version not `x.y.z`, size 0 or over 200 MB, bad hash text | `bad-manifest` | The update information on GitHub isn't valid (…); nothing was installed. |
| Manifest over 64 KB | `manifest-too-large` | The update information on GitHub is far bigger than it should be; ignored. |
| Release older than this copy | `older-version` | The latest release (X) is older than the version you're running (Y), so there's nothing to install. |
| Redirect to a host that isn't allowed | `redirect-refused` | GitHub sent the download to an address that isn't allowed; refused. |
| Download SHA-256 differs | `bad-hash` | The downloaded file doesn't match what the owner published; not installed. |
| Download size differs (or more than size + 10%) | `bad-size` | The downloaded file is not the size the owner published; not installed. |
| Network or disk error while downloading | `download-failed` | The download failed (…). Nothing was changed. |
| Running under `go run` | `dev-build` | Updates only apply to the built exe. |
| Can't create files next to the exe | `folder-not-writable` | Couldn't update here. Download it from GitHub instead. (+ `releaseUrl`) |
| Another step is running | `busy` | An update step is already running. |
| Download/apply without a verified result | `nothing-to-apply` | There's no downloaded update to install. Check for updates first. |
| `version` sent doesn't match the last check | `stale` | That version is no longer the one found by the last check. Check for updates again. |
| Backup, rename or start failed | `apply-failed` | says which step and that the old version is in place |
| Cancelled | `cancelled` | (not shown as an error) |

**Versions** (`ParseVersion`, `DecideResult`): `major.minor.patch`, three plain numbers, compared
number by number (2.10.0 > 2.9.0). Newer → `available`; equal → `up-to-date`; older → refused.
**Hosts** (`AllowedHosts`): HTTPS only, and only `github.com`, `objects.githubusercontent.com`,
`release-assets.githubusercontent.com` (plus the test base's host). At most 5 redirects.
**Sizes**: manifest ≤ 64 KB; the exe is cut off at manifest size + 10% and must then equal the
manifest size exactly and match its SHA-256.

## Flow

```
Click "Check for updates"  → POST /api/updates/check → fetch.go FetchManifest
    → size cap → parse → VerifySignature → ValidateManifest → DecideResult → status.result

Click "Download and restart" → POST /api/updates/download → (background) download.go DownloadExe
    → SquadTaskMap.download.exe, SHA-256 + size checked → phase "ready"        ("updates" events)
Page, on phase "ready" → POST /api/updates/apply → apply.go Apply:
    1. re-verify the file on disk (size + SHA-256)
    2. storage.BackupStateBeforeUpdate → squad-task-map-data.before-<new version>.json (newest 3 kept)
    3. write squad-task-map-update-notice.json (release notes for the new copy)
    4. replace.go SwapInNewExe:  SquadTaskMap.previous.exe → SquadTaskMap.previous.old.exe (if any)
                                 SquadTaskMap.exe          → SquadTaskMap.previous.exe
                                 SquadTaskMap.download.exe → SquadTaskMap.exe
       (a step fails → the earlier ones are undone, previous.exe included)
    5. restart.go StartNewCopy: SquadTaskMap.exe --updated-from=<old version>
       (start fails → UndoSwap puts the old exe and the older previous.exe back;
        start works → FinishSwap deletes previous.old.exe)
    6. app.requestExit → this copy closes; the HTTP answer is already sent
New copy: internal/app/run.go sees --updated-from → waits (≤ 15 s) until the old copy's port is
    free → starts as normal on the same port, without opening a browser tab
    → status.justUpdated = {from, to, released, notes}
Page: its event stream dropped and reconnects; /api/status reports the new version → reload;
    show "Updated to X" + notes, then POST /api/updates/seen.
```
On any failure the old exe keeps running and the data files are untouched (the backup is only a
copy). `SquadTaskMap.previous.exe` stays next to the exe as a manual way back.

## HTTP API (the contract for the page)

All routes are `POST`, JSON in, JSON out, on 127.0.0.1 like the rest. **Every answer has the same
shape:**
```jsonc
// success (HTTP 200)
{ "ok": true,  "status": <Status> }
// refusal or failure
{ "ok": false, "error": "<message to show as is>", "code": "<code from the table>",
  "releaseUrl": "…",          // only for folder-not-writable: the release page, "download it from GitHub"
  "status": <Status> }        // the state after the failure (also holds status.error)
```
HTTP status: 200 ok · 409 `busy`/`nothing-to-apply`/`stale` · 400 `dev-build`/`folder-not-writable`/
`no-public-key` · 500 `apply-failed` · 502 everything about GitHub or the file (`no-release`,
`bad-signature`, `bad-hash`, …). The page can ignore the HTTP status and use `ok`, `code` and `error`.

**`Status`** (also `/api/status` → `updates`, and the `updates` event's `status`):
```jsonc
{
  "currentVersion": "2.5.0",
  "canApply": true,              // false under `go run`; then "Download and restart" is disabled
  "cannotApplyMessage": "",      // "Updates only apply to the built exe." when canApply is false
  "phase": "idle",               // idle | checking | downloading | ready | applying
  "lastChecked": null,           // RFC 3339 UTC; null until a manual check has finished (even a failed one)
  "result": "",                  // "" | "up-to-date" | "available"  (after a successful check)
  "available": null,             // when result is "available": 
                                 //   {version, released, notes, sizeBytes, releaseUrl}
  "download": null,              // while downloading / when ready: {bytesDone, bytesTotal}
  "error": null,                 // the last failure: {code, message, releaseUrl?}; cleared by the next step
  "justUpdated": null            // in a copy an update started: {from, to, released, notes}, until /seen
}
```

| Route | Body | Does | Answers when |
|---|---|---|---|
| `POST /api/updates/check` | none | asks GitHub for the latest release (≤ 20 s) | the check is finished. Up to date, available, or a refusal (`no-release`, `bad-signature`, `older-version`, …). Phase `idle` afterwards. `busy` while a download or install runs. A finished download is discarded by a new check. |
| `POST /api/updates/download` | optional `{"version": "2.6.0"}` (the version on screen; another one is `stale`) | starts the background download | at once, with `phase: "downloading"`. Progress and the end arrive as `updates` events: `ready` (verified) or `idle` with `status.error` (`bad-hash`, `download-failed`, …). Errors up front: `nothing-to-apply` (no available release), `dev-build`, `folder-not-writable`, `busy`, `stale`. |
| `POST /api/updates/cancel` | none | stops a download (partial file deleted) or discards a finished one | after it stopped; `phase: "idle"`, `result`/`available` kept, so the button can be offered again. Always `ok`. |
| `POST /api/updates/apply` | none | installs the verified download and restarts (needs `phase: "ready"`) | after the new copy was started: `ok: true`, `phase: "applying"`; this copy then closes within a moment and the page's stream drops. Failures (`apply-failed`, `folder-not-writable`, `bad-hash`, `nothing-to-apply`) leave the old version running; `phase` is `ready` again (retry) or `idle` (download was bad and deleted). |
| `POST /api/updates/seen` | none | dismisses `justUpdated` (and deletes the notes file) | at once; always `ok`. |

**Event `updates`** (broadcast; `internal/events/names.go` `Updates`): `{"type": "updates", "status": <Status>}`
on every change: checking, check result, download started, progress (at most every 250 ms),
ready, applying, failures. Live only: a page opened later reads `/api/status`.

**Page flow the API is built for**
1. Settings opens → `/api/status.updates` → show "You're on {currentVersion}", `lastChecked` if set,
   and `justUpdated` (once; call `/seen` after showing it).
2. Click Check → `POST /check` → render `result` / `available` / `error` from the answer.
3. Click Download and restart (after a confirmation) → `POST /download` → render `download`
   progress from `updates` events; Cancel → `POST /cancel`.
4. On an event with `phase: "ready"` → `POST /apply`. Then expect the event stream to drop; when it
   reconnects, `/api/status` shows the new `currentVersion` → reload the page.
5. `error.code === "folder-not-writable"` → show the message and a link to `releaseUrl`.

## Saved data / settings
- `squad-task-map-data.before-<version>.json`: copy of the saved data made before the new
  version's first start; the newest 3 are kept (`storage.BackupStateBeforeUpdate`).
- `squad-task-map-update-notice.json`: release notes handed to the new copy; deleted when the page
  calls `/seen` (or when an install fails).
- `SquadTaskMap.download.exe`, `SquadTaskMap.previous.exe` next to the exe.
- No settings. `lastChecked` and everything else in `Status` lives in memory only.

## Files
- `rules.go`: constants (repo, public key placeholder, hosts, caps), `Manifest`, `CanonicalBytes`,
  `SignManifest`, `VerifySignature`, `ValidateManifest`, versions, addresses, `AllowedHosts`.
- `errors.go`: every error with its code and message.
- `fetch.go`: `Source`, the HTTP client that follows redirects only to allowed hosts, `FetchManifest`.
- `download.go`: `DownloadExe` (streaming, progress, caps, SHA-256), `VerifyFile`.
- `replace.go`: `FileOps`, `SwapInNewExe`, `UndoSwap`, the real file operations.
- `apply.go`: `Updater.Apply` (verify, backup, notice, swap, start, exit).
- `updater.go`: `Updater`, `Status`, check, background download, cancel, seen.
- `restart.go`: `StartNewCopy`, `WaitUntilPortIsFree`.
- Wiring: `internal/app/updates.go`, routes `internal/httpapi/updates.go`.

## Tests
`go test ./internal/features/updates`: signature (every signed field, wrong key, junk), manifest
validation, versions, host allowlist, redirects (allowed, wrong host, plain HTTP, loops), every
refusal above through a fake GitHub, download (progress, wrong hash/size, over the cap, redirect,
cancel mid-way, partial file deleted), the swap and its rollback at each step with a fake file
system, `Updater` (check, download, install, backup, cancel, busy/stale, `go run`, read-only folder,
zero requests without a click, tamper after verification, "Updated to" notice).
`go test ./internal/storage` (backup rotation), `./internal/app` (routes), `./cmd/mock`, `./cmd/release`.

**Needs the owner on Windows** (ticket 04c acceptance): update 2.5.x → the next version from a real
release; check the data files are untouched, `squad-task-map-data.before-<version>.json` and
`SquadTaskMap.previous.exe` exist, the new copy runs and the page reloads itself; a failure halfway
(read-only folder, killed download) leaves the old exe running. Not testable on Linux: renaming the
running `.exe` while it runs, and the console window staying open when the old copy exits.
