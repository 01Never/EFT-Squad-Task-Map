package app

import (
	"log"
	"net/url"
	"os"
	"strings"
	"time"

	"squadtaskmap/internal/features/updates"
	"squadtaskmap/internal/storage"
)

// newUpdater connects "Check for updates" (internal/features/updates) to this app. It makes no
// network request and starts nothing: every step waits for a click on the page.
//
// Development overrides (they never skip the signature check):
//   - STM_UPDATES_BASE: use this address instead of the GitHub repository (cmd/mock);
//   - STM_UPDATES_PUBLIC_KEY: trust this key instead of the built-in one. It only counts
//     together with an STM_UPDATES_BASE on this PC (127.0.0.1, ::1 or localhost), so neither a
//     stray variable nor a base on the internet can swap the key of a real copy.
func newUpdater(app *App, updatedFrom, userAgent string) *updates.Updater {
	base := updates.ResolveBase(os.Getenv("STM_UPDATES_BASE"))
	publicKey := updates.EmbeddedPublicKey
	publicKey = chooseUpdatePublicKey(publicKey, os.Getenv("STM_UPDATES_PUBLIC_KEY"), base)
	return updates.New(updates.Config{
		CurrentVersion: app.version,
		UpdatedFrom:    updatedFrom,
		ExePath:        installedExePath(),
		PublicKey:      publicKey,
		Source:         updates.NewSource(base, userAgent),
		Files:          updates.OSFileOps(),
		NoticePath:     app.files.UpdateNotice,
		BackupData: func(newVersion string) error {
			return storage.BackupStateBeforeUpdate(app.files, newVersion)
		},
		StartNewCopy: updates.StartNewCopy,
		Exit:         app.requestExit,
		OnChange:     app.onUpdateStatusChanged,
		Now:          time.Now,
	})
}

// installedExePath is the running exe, or "" under `go run` (the exe is then a temporary build
// and must not be replaced).
func installedExePath() string {
	if runningUnderGoRun() {
		return ""
	}
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	return exe
}

// requestExit asks Run to shut down (after an update started the new copy).
func (app *App) requestExit() {
	app.exitOnce.Do(func() { close(app.exitRequested) })
}

// chooseUpdatePublicKey returns the key manifests must be signed with: the built-in one, unless
// STM_UPDATES_PUBLIC_KEY is set and the update base is on this PC. A key override with any other
// base is ignored, with one line in the console saying so.
func chooseUpdatePublicKey(builtIn, override, base string) string {
	override = strings.TrimSpace(override)
	if override == "" {
		return builtIn
	}
	if !isLoopbackBase(base) {
		log.Println("STM_UPDATES_PUBLIC_KEY ignored: it only counts when STM_UPDATES_BASE points at this PC (127.0.0.1, ::1 or localhost)")
		return builtIn
	}
	return override
}

// isLoopbackBase reports whether a base URL's host is 127.0.0.1, ::1 or localhost.
func isLoopbackBase(base string) bool {
	parsed, err := url.Parse(base)
	if err != nil {
		return false
	}
	switch strings.ToLower(parsed.Hostname()) {
	case "127.0.0.1", "::1", "localhost":
		return true
	}
	return false
}
