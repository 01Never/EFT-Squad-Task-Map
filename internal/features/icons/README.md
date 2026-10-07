# Item icons: the icon cache (`internal/features/icons`)

The page side (which markers get an icon, how they are drawn) is in
`web/js/features/icons/README.md`.

**What it does (player's view):** pictures of items (the MS2000 on a mark spot, the item to stash,
the Bring list's thumbnails) show up on the map and in the panel, and still show with no network
after the first time.

**Where the data comes from:** `https://assets.tarkov.dev/<itemId>-icon.webp`, downloaded by this
package, never by the browser. `STM_ASSETS_BASE` replaces the host (the mock serves
`http://127.0.0.1:7820/assets`).

**The rules:**
- **Only item ids.** An id is 24 lower-case hex digits (`IsItemID`). The route `GET
  /icons/<id>.webp` accepts nothing else, and nothing but the id goes into the download address, so
  the page can't make the app fetch anything else (no paths, no other host).
- **Once.** The first request downloads the icon into `squad-task-map-icons/<id>.webp` (next to the
  data files; written atomically). Later requests, also after a restart, are served from there.
- **Same host only.** A redirect is followed only within the same scheme and host (and at most 3
  of them); anything else fails the download.
- **Small WebP only.** At most `MaxIconBytes` = 256 KB (real ones are a few KB) and the file must
  start like a WebP (`RIFF…WEBP`); otherwise it isn't stored (a captive-portal page, say).
- **One download per id at a time.** Ten requests for the same icon wait for one download; at most
  6 icons download at once (a full Bring list asks for a hundred).
- **Failures are remembered, not retried by a timer.** A failed download (no network, 404 for an
  item without an icon) is not tried again for `RetryFailedAfter` = 10 minutes: only the next
  *request* after that tries again. Nothing runs in the background.
- A failure answers `404` with `Cache-Control: no-store`; a hit has `max-age=86400` and the type
  `image/webp`.

**Flow:** `<img>` / `<image href="/icons/<id>.webp">` → `httpapi` `GET /icons/{file}` →
`Backend.IconPath` (`app`) → `Cache.Path` → file on disk, or one download from assets.tarkov.dev →
`http.ServeContent`.

**Saved data / settings:** none in the settings file. The icon folder is deleted-safe: icons
download again when needed. Ticket 09 (keys) uses the same `/icons/<id>.webp`.

**Files:**
- `rules.go`: ids, the file name, the address, the WebP check, `MayTryAgain`, the limits.
- `cache.go`: `Cache` (`Path`): disk, downloading, de-duplication, remembered failures.
- `icons_test.go`: the tests. The route is tested in `internal/httpapi/icons_test.go`.

**Tests:** ids and file names; download once then disk (also after a restart, with the network
gone); ten parallel requests download once; a failure isn't retried until 10 minutes pass; too
big, not a WebP and an off-host redirect are never stored; a non-id never reaches the network;
the route answers WebP, 404 + `no-store`, and ignores malformed names. Needs the real
assets.tarkov.dev (not reachable from the cloud session): that the owner's real quest-item ids
all have icons (see the page README).
