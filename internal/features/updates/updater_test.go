package updates

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// faultyOps is the real file system with failures on demand.
type faultyOps struct {
	FileOps
	failRename  map[string]error // "<old base name> -> <new base name>"
	notWritable bool
}

func (ops faultyOps) Rename(oldPath, newPath string) error {
	key := filepath.Base(oldPath) + " -> " + filepath.Base(newPath)
	if err := ops.failRename[key]; err != nil {
		return err
	}
	return ops.FileOps.Rename(oldPath, newPath)
}

func (ops faultyOps) CheckWritable(folder string) error {
	if ops.notWritable {
		return errors.New("read-only")
	}
	return ops.FileOps.CheckWritable(folder)
}

// rig is an Updater wired to a fake GitHub, a scratch folder holding "the installed exe",
// and recorders for everything the Updater asks the outside world to do.
type rig struct {
	t          *testing.T
	updater    *Updater
	github     *fakeGitHub
	publicKey  ed25519.PublicKey
	privateKey ed25519.PrivateKey
	folder     string
	paths      ExePaths
	ops        faultyOps

	mutex         sync.Mutex
	statuses      []Status
	backups       []string
	startedWith   [][]string
	exitCalled    bool
	backupError   error
	startError    error
	checkedAtTime time.Time
}

const installedVersion = "2.5.0"

func newRig(t *testing.T) *rig {
	t.Helper()
	publicKey, privateKey := testKeys(t)
	folder := t.TempDir()
	r := &rig{
		t: t, github: newFakeGitHub(t), publicKey: publicKey, privateKey: privateKey, folder: folder,
		paths:         PathsBeside(filepath.Join(folder, "SquadTaskMap.exe")),
		ops:           faultyOps{FileOps: OSFileOps(), failRename: map[string]error{}},
		checkedAtTime: time.Date(2026, 10, 20, 12, 30, 0, 0, time.UTC),
	}
	os.WriteFile(r.paths.Current, []byte("old exe"), 0o644)
	r.build(r.paths.Current)
	return r
}

// build (re)creates the Updater; exePath "" simulates `go run`.
func (r *rig) build(exePath string) {
	r.updater = New(Config{
		CurrentVersion: installedVersion,
		ExePath:        exePath,
		PublicKey:      publicKeyText(r.publicKey),
		Source:         r.github.testSource(),
		Files:          r.opsPointer(),
		NoticePath:     filepath.Join(r.folder, "notice.json"),
		BackupData: func(version string) error {
			r.mutex.Lock()
			defer r.mutex.Unlock()
			r.backups = append(r.backups, version)
			return r.backupError
		},
		StartNewCopy: func(exePath string, arguments []string) error {
			r.mutex.Lock()
			defer r.mutex.Unlock()
			r.startedWith = append(r.startedWith, append([]string{exePath}, arguments...))
			return r.startError
		},
		Exit: func() {
			r.mutex.Lock()
			defer r.mutex.Unlock()
			r.exitCalled = true
		},
		OnChange: func(status Status) {
			r.mutex.Lock()
			defer r.mutex.Unlock()
			r.statuses = append(r.statuses, status)
		},
		Now: func() time.Time { return r.checkedAtTime },
	})
}

// opsPointer lets tests change r.ops after the Updater was built.
func (r *rig) opsPointer() FileOps { return opsRef{r} }

type opsRef struct{ r *rig }

func (ref opsRef) Rename(a, b string) error     { return ref.r.ops.Rename(a, b) }
func (ref opsRef) Remove(path string) error     { return ref.r.ops.Remove(path) }
func (ref opsRef) Exists(path string) bool      { return ref.r.ops.Exists(path) }
func (ref opsRef) CheckWritable(f string) error { return ref.r.ops.CheckWritable(f) }

func (r *rig) publish(version string, exe []byte) Manifest {
	return r.github.publish(r.privateKey, version, exe)
}

func (r *rig) check() (Status, error) { return r.updater.Check(context.Background()) }

// waitForPhase waits (in test time only) until the background download reaches a phase.
func (r *rig) waitForPhase(phase string) Status {
	r.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if status := r.updater.Status(); status.Phase == phase {
			return status
		}
		time.Sleep(5 * time.Millisecond)
	}
	r.t.Fatalf("never reached phase %q; now %q", phase, r.updater.Status().Phase)
	return Status{}
}

func (r *rig) fileText(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return "(missing)"
	}
	return string(data)
}

// downloaded checks a new version, downloads it and waits until it is ready to install.
func (r *rig) downloaded(version string, exe []byte) {
	r.t.Helper()
	r.publish(version, exe)
	if _, err := r.check(); err != nil {
		r.t.Fatalf("check: %v", err)
	}
	if _, err := r.updater.StartDownload(version); err != nil {
		r.t.Fatalf("StartDownload: %v", err)
	}
	r.waitForPhase(PhaseReady)
}

// ---------------------------------------------------------------- nothing happens by itself

func TestCreatingTheUpdaterAndReadingItsStatusMakeNoNetworkRequests(t *testing.T) {
	r := newRig(t)
	r.publish("2.6.0", fakeExe(1000))

	status := r.updater.Status()
	time.Sleep(50 * time.Millisecond) // a timer or background check would have fired by now

	if r.github.requestCount() != 0 {
		t.Fatalf("%d requests were made without a click", r.github.requestCount())
	}
	if status.Phase != PhaseIdle || status.LastChecked != nil || status.Result != "" || status.Available != nil {
		t.Fatalf("a fresh updater must be idle and empty: %+v", status)
	}
	if status.CurrentVersion != installedVersion || !status.CanApply || status.CannotApplyMessage != "" {
		t.Fatalf("status = %+v", status)
	}
}

func TestACopyWithoutAnOwnerKeyRefusesToCheckAndAsksGitHubForNothing(t *testing.T) {
	r := newRig(t)
	r.publish("2.6.0", fakeExe(1000))
	r.publicKey = nil // the placeholder: PublicKey text is not a key
	r.build(r.paths.Current)
	r.updater.config.PublicKey = placeholderPublicKey

	_, err := r.check()
	if errorCode(err) != CodeNoPublicKey {
		t.Fatalf("error = %v, want code %s", err, CodeNoPublicKey)
	}
	if r.github.requestCount() != 0 {
		t.Fatal("without a key there is nothing to verify against; no request must be made")
	}
}

// ---------------------------------------------------------------- checking

func TestACheckSaysUpToDateWhenTheLatestReleaseIsTheRunningVersion(t *testing.T) {
	r := newRig(t)
	r.publish(installedVersion, fakeExe(1000))

	status, err := r.check()
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if status.Result != ResultUpToDate || status.Available != nil || status.Phase != PhaseIdle {
		t.Fatalf("status = %+v", status)
	}
	if status.LastChecked == nil || *status.LastChecked != "2026-10-20T12:30:00Z" {
		t.Fatalf("lastChecked = %v", status.LastChecked)
	}
}

func TestACheckOffersANewerReleaseWithItsNotesAndSize(t *testing.T) {
	r := newRig(t)
	published := r.publish("2.6.0", fakeExe(5000))

	status, err := r.check()
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	want := Release{
		Version:    "2.6.0",
		Released:   "2026-10-20",
		Notes:      published.Notes,
		SizeBytes:  5000,
		ReleaseURL: r.github.base() + "/releases/tag/v2.6.0",
	}
	if status.Result != ResultAvailable || status.Available == nil || *status.Available != want {
		t.Fatalf("available = %+v, want %+v", status.Available, want)
	}
}

func TestChecksThatEndInARefusalReportTheErrorAndOfferNothing(t *testing.T) {
	_, strangerKey := testKeys(t)
	tests := []struct {
		name     string
		prepare  func(*rig)
		wantCode string
		wantText string
	}{
		{"no release published yet", func(r *rig) {}, CodeNoRelease, "No release has been published yet."},
		{"a manifest signed by someone else", func(r *rig) {
			r.github.publish(strangerKey, "2.6.0", fakeExe(1000))
		}, CodeBadSignature, "This update isn't from the owner; not installed."},
		{"an older release", func(r *rig) { r.publish("2.4.0", fakeExe(1000)) }, CodeOlderVersion, "older"},
		{"GitHub down", func(r *rig) {
			r.publish("2.6.0", fakeExe(1000))
			r.github.status = http.StatusBadGateway
		}, CodeGitHubUnreachable, "Couldn't reach GitHub"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			r := newRig(t)
			test.prepare(r)

			status, err := r.check()
			if errorCode(err) != test.wantCode {
				t.Fatalf("error = %v, want code %s", err, test.wantCode)
			}
			if status.Error == nil || status.Error.Code != test.wantCode || !strings.Contains(status.Error.Message, test.wantText) {
				t.Fatalf("status error = %+v", status.Error)
			}
			if status.Result != "" || status.Available != nil || status.Phase != PhaseIdle {
				t.Fatalf("a refused check must offer nothing: %+v", status)
			}
			if status.LastChecked == nil {
				t.Fatal("a manual check that failed still counts as checked")
			}
		})
	}
}

func TestANewCheckClearsTheLastError(t *testing.T) {
	r := newRig(t)
	r.check() // no release: an error
	r.publish("2.6.0", fakeExe(1000))

	status, _ := r.check()
	if status.Error != nil || status.Result != ResultAvailable {
		t.Fatalf("status = %+v", status)
	}
}

// ---------------------------------------------------------------- download and install

func TestDownloadAndRestartFromCheckToTheNewCopyStarting(t *testing.T) {
	r := newRig(t)
	newExe := fakeExe(200_000)
	published := r.publish("2.6.0", newExe)
	r.check()

	started, err := r.updater.StartDownload("2.6.0")
	if err != nil {
		t.Fatalf("StartDownload: %v", err)
	}
	if started.Phase != PhaseDownloading || started.Download == nil || started.Download.BytesTotal != 200_000 {
		t.Fatalf("right after starting: %+v", started)
	}
	ready := r.waitForPhase(PhaseReady)
	if ready.Download == nil || ready.Download.BytesDone != 200_000 || ready.Error != nil {
		t.Fatalf("ready status: %+v", ready)
	}
	if r.fileText(r.paths.Download) != string(newExe) {
		t.Fatal("the verified download should sit next to the exe")
	}

	status, err := r.updater.Apply()
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}

	if status.Phase != PhaseApplying {
		t.Errorf("phase = %s, want %s", status.Phase, PhaseApplying)
	}
	if r.fileText(r.paths.Current) != string(newExe) || r.fileText(r.paths.Previous) != "old exe" {
		t.Error("the new exe must be in place and the old one kept as previous")
	}
	if _, err := os.Stat(r.paths.Download); !os.IsNotExist(err) {
		t.Error("the download file name is free again after the rename")
	}
	if len(r.backups) != 1 || r.backups[0] != "2.6.0" {
		t.Errorf("data backups = %v, want one for 2.6.0", r.backups)
	}
	wantStart := []string{r.paths.Current, "--updated-from=2.5.0"}
	if len(r.startedWith) != 1 || strings.Join(r.startedWith[0], " ") != strings.Join(wantStart, " ") {
		t.Errorf("started %v, want %v", r.startedWith, wantStart)
	}
	if !r.exitCalled {
		t.Error("the old copy must be asked to exit after the new one started")
	}

	// The new copy: started with --updated-from, it finds the notes the old one left.
	newCopy := New(Config{CurrentVersion: "2.6.0", UpdatedFrom: "2.5.0", NoticePath: filepath.Join(r.folder, "notice.json"), Files: OSFileOps()})
	notice := newCopy.Status().JustUpdated
	if notice == nil || notice.From != "2.5.0" || notice.To != "2.6.0" || notice.Notes != published.Notes || notice.Released != "2026-10-20" {
		t.Fatalf("notice = %+v", notice)
	}
	if seen := newCopy.MarkSeen(); seen.JustUpdated != nil {
		t.Fatal("after the page has seen it, the notice is gone")
	}
	if _, err := os.Stat(filepath.Join(r.folder, "notice.json")); !os.IsNotExist(err) {
		t.Fatal("the notice file is deleted once seen, so it shows once")
	}
	if New(Config{CurrentVersion: "2.6.0"}).Status().JustUpdated != nil {
		t.Fatal("a normal start has no notice")
	}
}

func TestUpdateStateChangesAreAnnouncedForTheLiveEvent(t *testing.T) {
	r := newRig(t)
	r.downloaded("2.6.0", fakeExe(300_000))

	r.mutex.Lock()
	defer r.mutex.Unlock()
	var phases []string
	for _, status := range r.statuses {
		if len(phases) == 0 || phases[len(phases)-1] != status.Phase {
			phases = append(phases, status.Phase)
		}
	}
	want := "checking idle downloading ready"
	if strings.Join(phases, " ") != want {
		t.Fatalf("announced phases = %v, want %s", phases, want)
	}
	// ~300 KB is five chunks: far fewer events than reads, never one per read.
	if len(r.statuses) > 12 {
		t.Fatalf("%d events for one small download", len(r.statuses))
	}
}

func TestApplyAnswersTheSameFailuresInEveryStepAndKeepsTheOldVersionRunning(t *testing.T) {
	boom := errors.New("access denied")
	tests := []struct {
		name         string
		setup        func(*rig)
		wantCode     string
		wantContains string
		wantPhase    string // after the failure
	}{
		{
			"the data backup fails: nothing is replaced",
			func(r *rig) { r.backupError = boom },
			CodeApplyFailed, "Couldn't back up your saved data", PhaseReady,
		},
		{
			"the folder became read-only",
			func(r *rig) { r.ops.notWritable = true },
			CodeFolderNotWritable, "Download it from GitHub instead", PhaseReady,
		},
		{
			"the current exe can't be set aside",
			func(r *rig) { r.ops.failRename["SquadTaskMap.exe -> SquadTaskMap.previous.exe"] = boom },
			CodeApplyFailed, "Nothing was changed", PhaseReady,
		},
		{
			"the new exe can't take its place: the old exe is put back",
			func(r *rig) { r.ops.failRename["SquadTaskMap.download.exe -> SquadTaskMap.exe"] = boom },
			CodeApplyFailed, "old version is still in place", PhaseReady,
		},
		{
			"the new exe can't be started: the swap is undone",
			func(r *rig) { r.startError = boom },
			CodeApplyFailed, "couldn't be started", PhaseReady,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			r := newRig(t)
			newExe := fakeExe(2000)
			r.downloaded("2.6.0", newExe)
			test.setup(r)

			status, err := r.updater.Apply()

			if errorCode(err) != test.wantCode || !strings.Contains(err.Error(), test.wantContains) {
				t.Fatalf("error = %v (%s), want %s containing %q", err, errorCode(err), test.wantCode, test.wantContains)
			}
			if r.fileText(r.paths.Current) != "old exe" {
				t.Fatalf("the old exe must still be the exe, found %q", r.fileText(r.paths.Current))
			}
			if r.exitCalled {
				t.Fatal("the app must not exit when the install failed")
			}
			if status.Phase != test.wantPhase || status.Error == nil || status.Error.Code != test.wantCode {
				t.Fatalf("status = phase %s, error %+v", status.Phase, status.Error)
			}
			if r.fileText(r.paths.Download) != string(newExe) {
				t.Fatal("the verified download is kept so the page can retry")
			}
		})
	}
}

func TestASecondUpdateThatFailsToStartKeepsTheFirstUpdatesPreviousExe(t *testing.T) {
	r := newRig(t)
	firstExe := fakeExe(1000)
	r.downloaded("2.6.0", firstExe)
	if _, err := r.updater.Apply(); err != nil {
		t.Fatalf("first update: %v", err)
	}
	// Now running "2.6.0" (a fresh Updater); "previous" holds the original exe.
	r.build(r.paths.Current)
	r.startError = errors.New("exec format error")
	r.downloaded("2.7.0", fakeExe(2000))

	_, err := r.updater.Apply()

	if errorCode(err) != CodeApplyFailed {
		t.Fatalf("error = %v", err)
	}
	if r.fileText(r.paths.Current) != string(firstExe) {
		t.Fatal("the running exe must be unchanged")
	}
	if r.fileText(r.paths.Previous) != "old exe" {
		t.Fatalf("the first update's previous.exe was lost: %q", r.fileText(r.paths.Previous))
	}
	if r.ops.Exists(r.paths.PreviousOld) {
		t.Fatal("no leftover previous.old.exe after the rollback")
	}
}

func TestAnUpdateThatStartsDeletesTheSetAsidePreviousExe(t *testing.T) {
	r := newRig(t)
	r.downloaded("2.6.0", fakeExe(1000))
	r.updater.Apply()
	r.build(r.paths.Current)
	r.downloaded("2.7.0", fakeExe(2000))

	if _, err := r.updater.Apply(); err != nil {
		t.Fatal(err)
	}

	if r.ops.Exists(r.paths.PreviousOld) {
		t.Fatal("once the new copy started, previous.old.exe is deleted")
	}
	if r.fileText(r.paths.Previous) != string(fakeExe(1000)) {
		t.Fatal("previous.exe is now the exe that was running")
	}
}

func TestADownloadChangedAfterVerificationIsNotInstalled(t *testing.T) {
	r := newRig(t)
	r.downloaded("2.6.0", fakeExe(2000))
	os.WriteFile(r.paths.Download, []byte("something else put here"), 0o644) // another program wrote to the folder

	status, err := r.updater.Apply()

	if errorCode(err) != CodeBadSize && errorCode(err) != CodeBadHash {
		t.Fatalf("error = %v", err)
	}
	if r.fileText(r.paths.Current) != "old exe" || r.exitCalled || len(r.startedWith) != 0 {
		t.Fatal("nothing may be replaced or started")
	}
	if _, statErr := os.Stat(r.paths.Download); !os.IsNotExist(statErr) {
		t.Fatal("the tampered file must be deleted")
	}
	if status.Phase != PhaseIdle {
		t.Fatalf("phase = %s: the download is gone, so check again", status.Phase)
	}
}

func TestInstallingNeedsAVerifiedDownload(t *testing.T) {
	r := newRig(t)
	if _, err := r.updater.Apply(); errorCode(err) != CodeNothingToApply {
		t.Fatalf("apply before any check: %v", err)
	}
	r.publish("2.6.0", fakeExe(1000))
	r.check()
	if _, err := r.updater.Apply(); errorCode(err) != CodeNothingToApply {
		t.Fatalf("apply before downloading: %v", err)
	}
}

func TestDownloadsThatFailVerificationLeaveNothingAndShowTheMessage(t *testing.T) {
	tests := []struct {
		name     string
		serve    func(exe []byte) []byte
		wantCode string
		wantText string
	}{
		{"a changed file", func(exe []byte) []byte { changed := append([]byte{}, exe...); changed[10] ^= 1; return changed }, CodeBadHash, "doesn't match what the owner published"},
		{"a file of another size", func(exe []byte) []byte { return exe[:len(exe)-1] }, CodeBadSize, "not the size"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			r := newRig(t)
			exe := fakeExe(4000)
			r.publish("2.6.0", exe)
			r.check()
			r.github.exe = test.serve(exe)

			r.updater.StartDownload("")
			status := r.waitForPhase(PhaseIdle)

			if status.Error == nil || status.Error.Code != test.wantCode || !strings.Contains(status.Error.Message, test.wantText) {
				t.Fatalf("error = %+v", status.Error)
			}
			if status.Download != nil {
				t.Fatalf("no download is left: %+v", status.Download)
			}
			if _, err := os.Stat(r.paths.Download); !os.IsNotExist(err) {
				t.Fatal("the bad file must be deleted")
			}
			if r.fileText(r.paths.Current) != "old exe" {
				t.Fatal("the exe must be untouched")
			}
		})
	}
}

// ---------------------------------------------------------------- what the page may ask

func TestRefusalsBeforeADownloadStarts(t *testing.T) {
	t.Run("the version on screen is not the checked one", func(t *testing.T) {
		r := newRig(t)
		r.publish("2.6.0", fakeExe(1000))
		r.check()
		if _, err := r.updater.StartDownload("2.7.0"); errorCode(err) != CodeStale {
			t.Fatalf("error = %v", err)
		}
	})
	t.Run("nothing was checked", func(t *testing.T) {
		r := newRig(t)
		if _, err := r.updater.StartDownload(""); errorCode(err) != CodeNothingToApply {
			t.Fatalf("error = %v", err)
		}
	})
	t.Run("up to date", func(t *testing.T) {
		r := newRig(t)
		r.publish(installedVersion, fakeExe(1000))
		r.check()
		if _, err := r.updater.StartDownload(""); errorCode(err) != CodeNothingToApply {
			t.Fatalf("error = %v", err)
		}
	})
	t.Run("running under go run: updates only apply to the built exe", func(t *testing.T) {
		r := newRig(t)
		r.build("")
		r.publish("2.6.0", fakeExe(1000))
		status, err := r.check()
		if err != nil || status.Result != ResultAvailable {
			t.Fatalf("checking must still work: %v %+v", err, status)
		}
		if status.CanApply || status.CannotApplyMessage != "Updates only apply to the built exe." {
			t.Fatalf("canApply=%v message=%q", status.CanApply, status.CannotApplyMessage)
		}
		if _, err := r.updater.StartDownload(""); errorCode(err) != CodeDevBuild {
			t.Fatalf("error = %v", err)
		}
	})
	t.Run("the exe's folder is not writable: download it from GitHub instead", func(t *testing.T) {
		r := newRig(t)
		r.publish("2.6.0", fakeExe(1000))
		r.check()
		r.ops.notWritable = true
		_, err := r.updater.StartDownload("")
		var updateError *Error
		if !errors.As(err, &updateError) || updateError.Code != CodeFolderNotWritable {
			t.Fatalf("error = %v", err)
		}
		if updateError.Message != "Couldn't update here. Download it from GitHub instead." {
			t.Fatalf("message = %q", updateError.Message)
		}
		if updateError.ReleaseURL != r.github.base()+"/releases/tag/v2.6.0" {
			t.Fatalf("release URL = %q", updateError.ReleaseURL)
		}
		if r.github.requestCount() != 3 { // only the check's three; nothing was downloaded
			t.Fatalf("%d requests: the download must not start", r.github.requestCount())
		}
	})
}

func TestCancellingADownloadStopsItAndKeepsTheCheckResult(t *testing.T) {
	r := newRig(t)
	exe := fakeExe(500_000)
	r.publish("2.6.0", exe)
	r.github.exeHandler = func(writer http.ResponseWriter, request *http.Request) {
		writer.Write(exe[:100_000])
		writer.(http.Flusher).Flush()
		<-request.Context().Done() // the rest never arrives
	}
	r.check()
	r.updater.StartDownload("")
	r.waitForPhase(PhaseDownloading)

	t.Run("another step can't start meanwhile", func(t *testing.T) {
		if _, err := r.updater.StartDownload(""); errorCode(err) != CodeBusy {
			t.Fatalf("second download: %v", err)
		}
		if _, err := r.check(); errorCode(err) != CodeBusy {
			t.Fatalf("check during download: %v", err)
		}
		if _, err := r.updater.Apply(); errorCode(err) != CodeBusy {
			t.Fatalf("apply during download: %v", err)
		}
	})

	status := r.updater.Cancel()

	if status.Phase != PhaseIdle || status.Download != nil || status.Error != nil {
		t.Fatalf("after cancel: %+v", status)
	}
	if status.Result != ResultAvailable || status.Available == nil {
		t.Fatal("the page can offer the download again")
	}
	if _, err := os.Stat(r.paths.Download); !os.IsNotExist(err) {
		t.Fatal("the partial file is deleted")
	}
}

func TestCancellingAFinishedDownloadDiscardsIt(t *testing.T) {
	r := newRig(t)
	r.downloaded("2.6.0", fakeExe(1000))

	status := r.updater.Cancel()

	if status.Phase != PhaseIdle || r.ops.Exists(r.paths.Download) {
		t.Fatalf("phase %s; download still there: %v", status.Phase, r.ops.Exists(r.paths.Download))
	}
}

func TestANewCheckAfterADownloadThrowsTheDownloadAway(t *testing.T) {
	r := newRig(t)
	r.downloaded("2.6.0", fakeExe(1000))
	r.publish("2.7.0", fakeExe(2000))

	status, _ := r.check()

	if status.Available == nil || status.Available.Version != "2.7.0" || status.Phase != PhaseIdle || status.Download != nil {
		t.Fatalf("status = %+v", status)
	}
	if r.ops.Exists(r.paths.Download) {
		t.Fatal("the old download must be deleted: it is for 2.6.0")
	}
}

func TestTheStatusIsPlainJSONWithTheDocumentedFields(t *testing.T) {
	r := newRig(t)
	r.publish("2.6.0", fakeExe(1000))
	status, _ := r.check()

	data, _ := json.Marshal(status)
	var fields map[string]any
	json.Unmarshal(data, &fields)

	for _, name := range []string{"currentVersion", "canApply", "cannotApplyMessage", "phase", "lastChecked", "result", "available", "download", "error", "justUpdated"} {
		if _, present := fields[name]; !present {
			t.Errorf("status JSON lacks %q: %s", name, data)
		}
	}
	if fields["download"] != nil || fields["error"] != nil || fields["justUpdated"] != nil {
		t.Errorf("unused fields must be null: %s", data)
	}
}

func TestTheNewCopyWaitsUntilThePortIsFree(t *testing.T) {
	attempts := 0
	isFree := func() bool { attempts++; return attempts >= 3 }
	if !waitUntilFree(isFree, time.Second, time.Millisecond) || attempts != 3 {
		t.Fatalf("attempts = %d: it should look until the port is free", attempts)
	}
	if waitUntilFree(func() bool { return false }, 20*time.Millisecond, time.Millisecond) {
		t.Fatal("a port that never frees up must time out")
	}
}
