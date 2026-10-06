// The Updater is the one object the app talks to: it remembers what the last check found, runs
// the download in the background, and installs the result. Every step starts from a click on the
// page; there are no timers and no automatic checks.
package updates

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Phases of the update flow, as the page sees them in Status.Phase.
const (
	PhaseIdle        = "idle"        // nothing running
	PhaseChecking    = "checking"    // asking GitHub for latest.json
	PhaseDownloading = "downloading" // fetching the exe
	PhaseReady       = "ready"       // downloaded and verified; Apply installs it
	PhaseApplying    = "applying"    // replacing the exe and restarting
)

// Limits on how long things may take, and how often progress is announced.
const (
	checkTimeout = 20 * time.Second
	// While downloading, a progress event is sent at most this often (a download of ~12 MB
	// would otherwise send hundreds).
	progressEventInterval = 250 * time.Millisecond
	// How long Cancel waits for the download to stop.
	cancelWait = 3 * time.Second
)

// Config is everything the Updater needs from the outside. internal/app fills it in; tests fill
// it with fakes.
type Config struct {
	CurrentVersion string // Version in internal/app/run.go
	UpdatedFrom    string // the "--updated-from=" value: set when this copy was just started by an update
	ExePath        string // the installed exe; "" when running under `go run` (apply is unavailable)
	PublicKey      string // base64 Ed25519 public key manifests must be signed with
	Source         Source // where releases come from
	Files          FileOps
	NoticePath     string // squad-task-map-update-notice.json: carries the release notes across the restart

	// BackupData copies the saved data before the new version's first start
	// (storage.BackupStateBeforeUpdate).
	BackupData func(newVersion string) error
	// StartNewCopy starts the new exe (StartNewCopy in restart.go).
	StartNewCopy func(exePath string, args []string) error
	// Exit asks the app to shut down once the new copy has been started.
	Exit func()
	// OnChange is called after every change of state, for the page's live "updates" event.
	OnChange func(Status)
	// Now is the clock (tests replace it).
	Now func() time.Time
}

// Release is the newer version a check found.
type Release struct {
	Version    string `json:"version"`
	Released   string `json:"released"`
	Notes      string `json:"notes"`
	SizeBytes  int64  `json:"sizeBytes"`
	ReleaseURL string `json:"releaseUrl"` // the release's page on GitHub ("View on GitHub")
}

// Progress is how much of the exe has arrived.
type Progress struct {
	BytesDone  int64 `json:"bytesDone"`
	BytesTotal int64 `json:"bytesTotal"`
}

// Notice is "this copy was just updated": shown once, then dismissed with MarkSeen.
type Notice struct {
	From     string `json:"from"`
	To       string `json:"to"`
	Released string `json:"released"`
	Notes    string `json:"notes"`
}

// Status is everything the page needs to draw Settings → Updates. It is in /api/status
// under "updates", in the "updates" event, and in every answer of the update routes.
type Status struct {
	CurrentVersion string `json:"currentVersion"`
	// CanApply is false when this copy can't install an update (running under `go run`);
	// CannotApplyMessage then says why. Checking still works.
	CanApply           bool   `json:"canApply"`
	CannotApplyMessage string `json:"cannotApplyMessage"`
	Phase              string `json:"phase"`
	// LastChecked is when a manual check last finished (RFC 3339, UTC); null before the first one.
	LastChecked *string `json:"lastChecked"`
	// Result is "up-to-date" or "available" after a successful check, "" otherwise.
	Result string `json:"result"`
	// Available is the newer release (set when Result is "available").
	Available *Release `json:"available"`
	// Download is set while downloading and when the download is ready.
	Download *Progress `json:"download"`
	// Error is the last failure (a refused check, download or install), or null.
	Error *Error `json:"error"`
	// JustUpdated is set in a copy that was started by an update, until the page marks it seen.
	JustUpdated *Notice `json:"justUpdated"`
}

// Updater runs the update flow. Create it with New.
type Updater struct {
	config Config

	mutex       sync.Mutex
	phase       string
	lastChecked *time.Time
	result      string
	manifest    *Manifest // the verified manifest of the release in "available"
	progress    *Progress
	lastError   *Error
	justUpdated *Notice

	cancelDownload context.CancelFunc // set while downloading
	downloadDone   chan struct{}      // closed when the download goroutine ends
	lastAnnounced  time.Time          // last progress event
}

// New creates the Updater. It makes no network request and starts nothing.
func New(config Config) *Updater {
	if config.Now == nil {
		config.Now = time.Now
	}
	updater := &Updater{config: config, phase: PhaseIdle}
	updater.justUpdated = readNotice(config)
	return updater
}

// readNotice builds the "Updated to X" notice for a copy started by an update. The release
// notes come from the file the old copy wrote; without it the notice has no notes.
func readNotice(config Config) *Notice {
	if config.UpdatedFrom == "" {
		return nil
	}
	notice := &Notice{From: config.UpdatedFrom, To: config.CurrentVersion}
	data, err := os.ReadFile(config.NoticePath)
	if err != nil {
		return notice
	}
	var saved Notice
	if json.Unmarshal(data, &saved) == nil && saved.To == config.CurrentVersion {
		notice = &saved
	}
	return notice
}

// Status returns the current state. It never touches the network.
func (updater *Updater) Status() Status {
	updater.mutex.Lock()
	defer updater.mutex.Unlock()
	return updater.statusLocked()
}

func (updater *Updater) statusLocked() Status {
	status := Status{
		CurrentVersion: updater.config.CurrentVersion,
		CanApply:       updater.config.ExePath != "",
		Phase:          updater.phase,
		Result:         updater.result,
		JustUpdated:    updater.justUpdated,
		Error:          updater.lastError,
	}
	if !status.CanApply {
		status.CannotApplyMessage = errDevBuild().Message
	}
	if updater.lastChecked != nil {
		formatted := updater.lastChecked.UTC().Format(time.RFC3339)
		status.LastChecked = &formatted
	}
	if updater.manifest != nil && updater.result == ResultAvailable {
		status.Available = &Release{
			Version:    updater.manifest.Version,
			Released:   updater.manifest.Released,
			Notes:      updater.manifest.Notes,
			SizeBytes:  updater.manifest.File.Size,
			ReleaseURL: ReleasePageURL(updater.config.Source.Base, updater.manifest.Version),
		}
	}
	if updater.progress != nil {
		copied := *updater.progress
		status.Download = &copied
	}
	return status
}

// announceLocked tells the page the state changed. Called with the mutex held; OnChange must
// not call back into the Updater.
func (updater *Updater) announceLocked() {
	if updater.config.OnChange != nil {
		updater.config.OnChange(updater.statusLocked())
	}
}

// ---------------------------------------------------------------- check

// Check asks GitHub for the latest release and compares it with the running version.
// It's the only thing that contacts GitHub without a download, and only when called.
// On a refusal it returns the *Error (also kept in Status.Error) together with the status.
func (updater *Updater) Check(ctx context.Context) (Status, error) {
	if err := updater.beginCheck(); err != nil {
		return updater.Status(), err
	}
	manifest, result, err := updater.fetchAndDecide(ctx)
	return updater.finishCheck(manifest, result, err)
}

// beginCheck moves to "checking" unless another step is running. A new check throws away a
// finished download (it may be for a version that is no longer the latest).
func (updater *Updater) beginCheck() error {
	updater.mutex.Lock()
	defer updater.mutex.Unlock()
	if updater.phase != PhaseIdle && updater.phase != PhaseReady {
		return errBusy()
	}
	if updater.phase == PhaseReady {
		_ = updater.config.Files.Remove(PathsBeside(updater.config.ExePath).Download)
	}
	updater.phase = PhaseChecking
	updater.lastError = nil
	updater.progress = nil
	updater.announceLocked()
	return nil
}

func (updater *Updater) fetchAndDecide(ctx context.Context) (Manifest, string, error) {
	publicKey, err := ParsePublicKey(updater.config.PublicKey)
	if err != nil {
		return Manifest{}, "", errNoPublicKey()
	}
	ctx, cancel := context.WithTimeout(ctx, checkTimeout)
	defer cancel()
	manifest, err := updater.config.Source.FetchManifest(ctx, ed25519.PublicKey(publicKey))
	if err != nil {
		return Manifest{}, "", err
	}
	result, err := DecideResult(updater.config.CurrentVersion, manifest)
	if err != nil {
		return Manifest{}, "", err
	}
	return manifest, result, nil
}

func (updater *Updater) finishCheck(manifest Manifest, result string, err error) (Status, error) {
	updater.mutex.Lock()
	defer updater.mutex.Unlock()
	checkedAt := updater.config.Now()
	updater.lastChecked = &checkedAt
	updater.phase = PhaseIdle
	updater.result = ""
	updater.manifest = nil
	updater.lastError = asError(err)
	if err == nil {
		updater.result = result
		updater.manifest = &manifest
	}
	updater.announceLocked()
	return updater.statusLocked(), err
}

// asError converts any error to the *Error the page shows.
func asError(err error) *Error {
	if err == nil {
		return nil
	}
	if apiError, isAPIError := err.(*Error); isAPIError {
		return apiError
	}
	return errGitHubUnreachable("")
}

// ---------------------------------------------------------------- download

// StartDownload begins downloading the release the last check found, in the background.
// expectedVersion may be "" or the version the page is showing; a different one is refused
// ("stale"). Progress and the result arrive through OnChange. It returns at once.
func (updater *Updater) StartDownload(expectedVersion string) (Status, error) {
	updater.mutex.Lock()
	defer updater.mutex.Unlock()

	if err := updater.canStartDownloadLocked(expectedVersion); err != nil {
		return updater.statusLocked(), err
	}
	manifest := *updater.manifest
	paths := PathsBeside(updater.config.ExePath)

	ctx, cancel := context.WithCancel(context.Background())
	updater.cancelDownload = cancel
	updater.downloadDone = make(chan struct{})
	updater.phase = PhaseDownloading
	updater.lastError = nil
	updater.progress = &Progress{BytesTotal: manifest.File.Size}
	updater.announceLocked()

	// Goroutine: the download. Started here, once per click; it ends when the file is complete
	// and verified, when it fails, or when Cancel cancels ctx.
	go updater.runDownload(ctx, manifest, paths.Download, updater.downloadDone)
	return updater.statusLocked(), nil
}

func (updater *Updater) canStartDownloadLocked(expectedVersion string) error {
	if updater.phase != PhaseIdle {
		return errBusy()
	}
	if updater.manifest == nil || updater.result != ResultAvailable {
		return errNothingToApply()
	}
	if expectedVersion != "" && expectedVersion != updater.manifest.Version {
		return errStale()
	}
	if updater.config.ExePath == "" {
		return errDevBuild()
	}
	releaseURL := ReleasePageURL(updater.config.Source.Base, updater.manifest.Version)
	if err := updater.config.Files.CheckWritable(filepath.Dir(updater.config.ExePath)); err != nil {
		return errFolderNotWritable(releaseURL)
	}
	return nil
}

func (updater *Updater) runDownload(ctx context.Context, manifest Manifest, destination string, done chan struct{}) {
	defer close(done)
	err := updater.config.Source.DownloadExe(ctx, manifest, destination, updater.onProgress)

	updater.mutex.Lock()
	defer updater.mutex.Unlock()
	updater.cancelDownload = nil
	switch {
	case err == nil:
		updater.phase = PhaseReady
		updater.progress = &Progress{BytesDone: manifest.File.Size, BytesTotal: manifest.File.Size}
	case asError(err).Code == CodeCancelled:
		updater.phase = PhaseIdle
		updater.progress = nil
	default:
		updater.phase = PhaseIdle
		updater.progress = nil
		updater.lastError = asError(err)
	}
	updater.announceLocked()
}

// onProgress keeps the byte count and tells the page, at most every progressEventInterval.
func (updater *Updater) onProgress(bytesDone, bytesTotal int64) {
	updater.mutex.Lock()
	defer updater.mutex.Unlock()
	if updater.phase != PhaseDownloading {
		return
	}
	updater.progress = &Progress{BytesDone: bytesDone, BytesTotal: bytesTotal}
	now := updater.config.Now()
	if now.Sub(updater.lastAnnounced) < progressEventInterval {
		return
	}
	updater.lastAnnounced = now
	updater.announceLocked()
}

// Cancel stops a running download (and deletes the partial file), or discards a finished one.
// It returns once the download has stopped.
func (updater *Updater) Cancel() Status {
	updater.mutex.Lock()
	cancel, done := updater.cancelDownload, updater.downloadDone
	isReady := updater.phase == PhaseReady
	if isReady {
		_ = updater.config.Files.Remove(PathsBeside(updater.config.ExePath).Download)
		updater.phase = PhaseIdle
		updater.progress = nil
		updater.announceLocked()
	}
	updater.mutex.Unlock()

	if cancel != nil {
		cancel()
		select {
		case <-done:
		case <-time.After(cancelWait):
		}
	}
	return updater.Status()
}

// ---------------------------------------------------------------- seen

// MarkSeen dismisses the "Updated to X" notice and deletes the file that carried the notes.
func (updater *Updater) MarkSeen() Status {
	updater.mutex.Lock()
	defer updater.mutex.Unlock()
	if updater.justUpdated != nil {
		updater.justUpdated = nil
		if updater.config.NoticePath != "" {
			_ = os.Remove(updater.config.NoticePath)
		}
		updater.announceLocked()
	}
	return updater.statusLocked()
}
