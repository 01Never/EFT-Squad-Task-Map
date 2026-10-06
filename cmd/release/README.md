# Release tool (`cmd/release`)

**What it's for:** the owner's tool for publishing an update (ticket 04c). It checks the version,
runs the tests, builds the Windows exe, signs the manifest the app's "Check for updates" reads, and
tells you how to attach both files to a GitHub release. It never uploads anything and never uses
the network itself.

```
go run ./cmd/release -init-keys                          # once: make the signing key pair
go run ./cmd/release -version 2.6.0 -notes notes.md      # for each release
```

## `-init-keys` (once)
- Writes the **private** key (base64, one line, owner-only permissions) to
  `<your config folder>\SquadTaskMap\release-private-key.txt` (`%AppData%` on Windows), or to
  `-key-out <path>`. It prints the path and refuses to overwrite an existing file.
- Prints the **public** key as a Go constant. Paste it into `EmbeddedPublicKey` in
  `internal/features/updates/rules.go`, build, and hand that build out by hand once: copies built
  before it can't verify updates.
- **Back the private key up** (password manager or a USB stick) and keep it out of the repo and
  GitHub. Lose it and friends must update by hand once; leak it and anyone can publish "updates".

## `-version X.Y.Z -notes notes.md`
Needs `STM_RELEASE_KEY` = the path of the private key file (PowerShell:
`$env:STM_RELEASE_KEY = "C:\...\release-private-key.txt"`). Steps, stopping at the first problem:
1. **Version check:** X.Y.Z must equal `Version` in `internal/app/run.go`, `version` in
   `package.json`, and `file_version`/`product_version` (as `X.Y.Z.0`), `FileVersion` and
   `ProductVersion` in `winres/winres.json`. The message lists every place that disagrees.
2. **Key check:** the private key's public half must equal the key built into the app, or installed
   copies would reject the update.
3. `go test ./...` and, when `npm` is installed, `npm test`.
4. `GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o dist/SquadTaskMap.exe .`
5. Size and SHA-256 of the exe → `dist/latest.json`
   (`{version, released, notes, file{name,size,sha256}, signature}`), signed with the same
   `updates.CanonicalBytes` the app verifies. The tool verifies its own signature and the app's
   field checks before writing.
6. Prints the next step, both ways:
   - `gh release create vX.Y.Z dist/SquadTaskMap.exe dist/latest.json --title "X.Y.Z" --notes-file notes.md`
   - by hand: GitHub → Releases → Draft a new release, tag `vX.Y.Z`, attach both files, publish
     (not as a draft or pre-release: "latest" skips those, so use them to stage).

Notes: line endings in the notes file become `\n`. `-date YYYY-MM-DD` overrides today's date.
`-out`, `-root` change the folders. `-skip-tests`, `-skip-build -exe <file>` exist for the tool's
own tests and for dry runs; don't use them for a real release.

## Files
- `main.go`: flags and the release steps in order. `keys.go`: key pair, loading, key check.
- `versions.go`: reading and comparing the version in the three files.
- `steps.go`: notes, tests, build, manifest, the printed instructions.

## Tests
`go test ./cmd/release`: version consistency (each file named, one stale file), key generation
(file mode, public key printed as a constant, never overwrites), the key must match the app's,
notes line endings, the manifest verifies with the app's own functions, a full dry run writes a
`latest.json` the app would accept and the instructions, a wrong key writes nothing, the flags.
**Needs the owner:** run `-init-keys` once and keep the private key safe; the first real release.
