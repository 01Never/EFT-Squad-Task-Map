# Read my extracts from the first raid screenshot (`internal/features/extracts`)

Ticket 06. The page side (marks, the "AI" tag, toast, notice, Settings checkbox) is in
`web/js/features/extracts/`; its README covers marking and the closest extract.

**What it does (player's view):** at the start of a raid you open Tarkov's extract list (double-tap
**O**) and take a screenshot. A few seconds later your extracts are marked on the map, exactly as if
you had clicked them, with an "AI" tag in the panel and a toast ("Marked 4 extracts from your
screenshot (1 not recognised: …)"). Requirement text read beside an extract ("Requires paracord")
shows in the panel and as a tooltip on the map. You can unmark or mark more by clicking; the marks
clear at raid end like hand-made ones. The closest-extract highlight (ticket 03) uses them at once.

**Where the data comes from:** the first in-raid screenshot (a GPS-named file), the OpenAI
Responses API (vision, your key), and the raid's map extracts and transits from the game data.

**The rules:**
- **When it reads:** only in a raid (after `GameStarted`), only with an OpenAI key, and only while
  the setting is on (`storage.Settings.IsReadExtractsOn`: the player's choice, else on once a key
  exists *and* the one-time notice was answered, so an update never starts sending pictures before
  the player was told).
- **How many screenshots:** the first GPS screenshot of the raid. If it doesn't show the list, the
  next ones are tried, **up to 3 per raid**, one at a time, and it stops as soon as a list is found
  (`Attempts.ShouldTry`). Failures (unreadable file, OpenAI error) use up a try too.
- **The picture:** the screenshots watcher only hands a file on once its size is stable, so a file
  still being written is never read. It is decoded (PNG or JPEG; BMP is not supported and counts as
  a failed try), fitted into 2048 px on its long side by averaging pixels (`ShrinkToJPEG`, never
  enlarged) and sent as a JPEG, quality 90, `detail: high`.
- **The call:** one Responses API request with a strict JSON schema
  `{visible: bool, extracts: [{name, note|null}]}`, reasoning effort `low` for models that take one,
  model from Settings. If `visible` is false (or nothing was listed) the next screenshot may be tried.
- **Cleaning (`CleanRead`):** names trimmed and cut at 80 characters, notes at 120 (blank = none),
  repeats of a name dropped, at most 40 extracts.
- **Matching (`MatchNames`):** each name is matched to the raid map's **extracts and transits**:
  exact after normalising (lower case letters and digits only), else the most similar name with a
  similarity of at least `MinSimilarity` = 0.82 (Levenshtein distance / longer length; names whose
  lengths differ by more than 8 aren't compared). Same rule and number as the task scan's page-side
  matcher. Names that match nothing are `unknown`. Two names for one extract mark it once.
- **Which map:** the raid's map from the log's scene path or nameId (`raid.CurrentMap`). When the
  log didn't name it, the event carries the names it read (`read`) and the page matches them
  against the map it has open (same rule, `matchReadExtracts`).
- **One read per raid, and nothing after the raid:** an answer that arrives after raid end (or in
  a newer raid) is dropped. `RaidEnded` and the delivery take the same lock, so a late answer can
  never be queued after `raidEnd`.

**Flow:**
```
log GameStarted → app.onLogEvent → Reader.RaidStarted
GPS-named screenshot (stable size) → app.onScreenshot → Reader.OnGPSShot → (goroutine) read file
  → ShrinkToJPEG → OpenAI → CleanRead → MatchNames (raid map's extracts + transits)
  → app.onExtractsRead → hub.Deliver {type:"extracts", map, marked:[{name,note}], unknown:[…]}
  → page: features/extracts/live-event.js marks them, saves, redraws, toast
log raid end → app.endRaid → Reader.RaidEnded → Deliver raidEnd → page clears the marks
```
`{type:"extracts"}` is **queued** until the page acknowledges it (it changes saved data). When the
map is unknown: `map: null, read: [{name, note}]` instead of `marked`/`unknown`.

**Saved data / settings:** the page stores marks in `prefs[map].extMarked` as `true` (a click, and
every mark saved before this ticket) or `{auto: true, note}`. Settings file (all optional):
`readExtracts` (the checkbox; absent = default) and `extractsNoticeSeen`. `/api/status` →
`settings.readExtracts` (what the checkbox shows) and `settings.extractsNotice` (true while the
one-time notice is due). Nothing new on disk besides those two fields.

**Privacy:** this is the one place the app sends a picture. The first in-raid screenshot of each
raid (up to 3 if the list wasn't on the first), shrunk to 2048 px, goes to api.openai.com with the
player's key, about 1–2k input tokens per raid. Off without a key or with the setting off (checked
in `extracts_test.go` and the browser suite against the mock's request log). The screenshot is still
deleted at raid end by the raid feature. No new timers.

**Files:**
- `rules.go`: `NormalizedName`, `EditDistance`, `Similarity`, `CleanRead`, `MatchNames`,
  `Attempts`, `ShrunkSize`, the constants.
- `image.go`: `ShrinkToJPEG`.
- `extracts.go`: `Reader` (`RaidStarted`, `RaidEnded`, `OnGPSShot`), the prompt and schema.
- `internal/app/extracts.go`: wires it to the settings, the raid's map, the game data and the hub.

**Tests:** `rules_test.go` (matching, cleaning, attempts, sizes), `extracts_test.go` (against a fake
OpenAI: one call per raid and the request's shape, up to 3 tries without a list, nothing sent
without a key / with the setting off / outside a raid, a late answer is dropped, the next raid reads
again, unknown map, the shrink), `internal/storage/extracts_setting_test.go` (the default-on
rule). `cmd/mock`: `POST /set-extracts`, and the log line ends ` extracts=true` for these calls.
`tests/browser/extracts.e2e.mjs` runs the real binary against the mock.

**Needs an in-game check:** double-tap O, take a screenshot: your extracts are marked within a few
seconds. Try a PMC raid and a Scav raid. Check that the in-game names match the map's names (a
mismatch shows in the "not recognised" toast; report it so an alias can be added), and that the
shrunk 2048 px picture is sharp enough for the real model to read the list.
