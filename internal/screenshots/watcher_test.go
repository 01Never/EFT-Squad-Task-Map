package screenshots

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// A settled file must arrive within this long (it normally takes 2–3 × settleDelay).
const arrivalTimeout = 5 * time.Second

func isPNG(name string) bool { return strings.HasSuffix(strings.ToLower(name), ".png") }

// newTestWatcher makes a watcher whose settled files land in a channel.
func newTestWatcher(t *testing.T) (*Watcher, chan File) {
	t.Helper()
	settled := make(chan File, 16)
	watcher := NewWatcher(isPNG, func(file File) { settled <- file })
	t.Cleanup(watcher.Stop)
	return watcher, settled
}

func nextFile(t *testing.T, settled chan File) File {
	t.Helper()
	select {
	case file := <-settled:
		return file
	case <-time.After(arrivalTimeout):
		t.Fatal("no file settled")
	}
	return File{}
}

func expectNothingMore(t *testing.T, settled chan File) {
	t.Helper()
	select {
	case file := <-settled:
		t.Errorf("an extra file was handed on: %+v", file)
	case <-time.After(3 * settleDelay):
	}
}

func appendFile(t *testing.T, path string, data []byte) {
	t.Helper()
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if _, err := file.Write(data); err != nil {
		t.Fatal(err)
	}
}

func TestANewPictureIsHandedOnOnceWhenItHasBeenQuietEvenIfWrittenInTwoSteps(t *testing.T) {
	dir := t.TempDir()
	watcher, settled := newTestWatcher(t)
	watcher.Start(dir)
	if status := watcher.Status(); !status.OK || status.Message != "Watching" {
		t.Fatalf("status = %+v", status)
	}

	picture := []byte(strings.Repeat("png-bytes ", 1000))
	half := len(picture) / 2
	shot := filepath.Join(dir, "2026-10-01[14-06]_1 (0).png")
	appendFile(t, shot, picture[:half])
	appendFile(t, filepath.Join(dir, "notes.txt"), []byte("not a picture")) // isImage rejects it
	time.Sleep(settleDelay + 100*time.Millisecond)                          // longer than the quiet period
	appendFile(t, shot, picture[half:])

	file := nextFile(t, settled)
	if file.Name != filepath.Base(shot) || !file.Exists || file.Size != int64(len(picture)) {
		t.Errorf("got %+v, want the whole picture (%d bytes)", file, len(picture))
	}
	if file.Modified.IsZero() {
		t.Error("the file time is missing")
	}
	expectNothingMore(t, settled)
}

func TestAPictureIsHandedOnOnlyWhenItsSizeStoppedChanging(t *testing.T) {
	cases := []struct {
		name          string
		growMeanwhile bool
		minimumWait   time.Duration
	}{
		{"an unchanged picture after two quiet checks", false, 2 * settleDelay},
		{"a picture that grew between the checks after one more check", true, 3 * settleDelay},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			dir := t.TempDir()
			watcher, settled := newTestWatcher(t)
			watcher.mutex.Lock()
			watcher.dir = dir // no OS notifications: only the timers and the size checks run
			watcher.mutex.Unlock()
			path := filepath.Join(dir, "shot.png")
			appendFile(t, path, []byte("first half "))

			started := time.Now()
			watcher.scheduleSettle("shot.png")
			if testCase.growMeanwhile {
				time.Sleep(settleDelay + settleDelay/2) // after the first check, before the second
				appendFile(t, path, []byte("second half"))
			}
			file := nextFile(t, settled)
			if waited := time.Since(started); waited < testCase.minimumWait {
				t.Errorf("handed on after %v, want at least %v", waited, testCase.minimumWait)
			}
			wantSize := int64(len("first half "))
			if testCase.growMeanwhile {
				wantSize += int64(len("second half"))
			}
			if !file.Exists || file.Size != wantSize {
				t.Errorf("got %+v, want size %d", file, wantSize)
			}
		})
	}
}

func TestARemovedPictureIsReportedAsGone(t *testing.T) {
	dir := t.TempDir()
	shot := filepath.Join(dir, "old.png")
	appendFile(t, shot, []byte("png"))
	watcher, settled := newTestWatcher(t)
	watcher.Start(dir)
	if err := os.Remove(shot); err != nil {
		t.Fatal(err)
	}
	file := nextFile(t, settled)
	if file.Name != "old.png" || file.Exists {
		t.Errorf("got %+v, want old.png with Exists=false", file)
	}
}

func TestReadAndDeleteTakeOnlyAPlainFileNameInsideTheFolder(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "Screenshots")
	os.Mkdir(dir, 0o755)
	os.Mkdir(filepath.Join(dir, "sub"), 0o755)
	victim := filepath.Join(root, "victim.png") // outside the folder
	appendFile(t, victim, []byte("keep me"))
	appendFile(t, filepath.Join(dir, "sub", "shot.png"), []byte("keep me too"))

	watcher, _ := newTestWatcher(t)
	watcher.Start(dir)
	cases := []struct{ name, fileName string }{
		{"empty", ""},
		{"dot", "."},
		{"dot dot", ".."},
		{"up and out with /", "../victim.png"},
		{`up and out with \`, `..\victim.png`},
		{"into a subfolder with /", "sub/shot.png"},
		{`into a subfolder with \`, `sub\shot.png`},
		{"an absolute path", victim},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := watcher.ReadFile(testCase.fileName); err == nil {
				t.Error("ReadFile accepted it")
			}
			if err := watcher.DeleteFile(testCase.fileName); err == nil {
				t.Error("DeleteFile accepted it")
			}
		})
	}
	for _, kept := range []string{victim, filepath.Join(dir, "sub", "shot.png")} {
		if _, err := os.Stat(kept); err != nil {
			t.Errorf("%s was deleted", kept)
		}
	}
}

func TestNamesThatWindowsReadsAsTheFolderItselfAreRefused(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("a Windows path rule")
	}
	dir := filepath.Join(t.TempDir(), "Screenshots")
	os.Mkdir(dir, 0o755)
	watcher, _ := newTestWatcher(t)
	watcher.Start(dir)
	for _, name := range []string{"...", ". .", ".. "} {
		if _, err := watcher.ReadFile(name); err == nil {
			t.Errorf("ReadFile(%q) accepted it", name)
		}
		if err := watcher.DeleteFile(name); err == nil {
			t.Errorf("DeleteFile(%q) accepted it", name)
		}
	}
	if _, err := os.Stat(dir); err != nil {
		t.Error("the Screenshots folder itself was deleted")
	}
}

func TestReadAndDeleteWorkForAPictureInTheFolder(t *testing.T) {
	dir := t.TempDir()
	appendFile(t, filepath.Join(dir, "shot (0).png"), []byte("png"))
	watcher, _ := newTestWatcher(t)

	if _, err := watcher.ReadFile("shot (0).png"); err == nil {
		t.Error("with no folder known, ReadFile should refuse")
	}
	watcher.Start(dir)
	data, err := watcher.ReadFile("shot (0).png")
	if err != nil || string(data) != "png" {
		t.Errorf("ReadFile = %q, %v", data, err)
	}
	if err := watcher.DeleteFile("shot (0).png"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "shot (0).png")); !os.IsNotExist(err) {
		t.Error("the picture is still there")
	}
}

func TestStartingOnAFolderThatIsNotThereSaysWhy(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "Screenshots")
	cases := []struct {
		name        string
		dir         string
		wantMessage string
		wantDir     *string
	}{
		{"no folder known", "", "Screenshots folder unknown — set it in Settings", nil},
		{"a folder that doesn't exist yet", missing, "Screenshots folder not found yet (it appears after your first screenshot)", &missing},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			watcher, _ := newTestWatcher(t)
			watcher.Start(testCase.dir)
			status := watcher.Status()
			if status.OK || status.Message != testCase.wantMessage {
				t.Errorf("status = %+v, want not OK with %q", status, testCase.wantMessage)
			}
			switch {
			case testCase.wantDir == nil && status.Dir != nil:
				t.Errorf("dir = %q, want null", *status.Dir)
			case testCase.wantDir != nil && (status.Dir == nil || *status.Dir != *testCase.wantDir):
				t.Errorf("dir = %v, want %q", status.Dir, *testCase.wantDir)
			}
		})
	}
}

func TestTheRetryForAMissingFolderOnlyStartsTheWatchStillWanted(t *testing.T) {
	cases := []struct {
		name         string
		meanwhile    func(watcher *Watcher, otherDir string)
		wantWatching bool
		wantOtherDir bool // the folder chosen meanwhile is still the one watched
	}{
		{"the folder appears: it's watched", func(*Watcher, string) {}, true, false},
		{"a new folder in Settings wins", func(watcher *Watcher, otherDir string) { watcher.Start(otherDir) }, true, true},
		{"after Stop nothing starts again", func(watcher *Watcher, _ string) { watcher.Stop() }, false, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			root := t.TempDir()
			missing, otherDir := filepath.Join(root, "Screenshots"), filepath.Join(root, "Other")
			os.Mkdir(otherDir, 0o755)
			watcher, _ := newTestWatcher(t)
			watcher.Start(missing)
			watcher.mutex.Lock()
			retryStop := watcher.stop // the retry goroutine's watch
			watcher.mutex.Unlock()

			testCase.meanwhile(watcher, otherDir)
			os.Mkdir(missing, 0o755)
			watcher.restartIfStillCurrent(retryStop, missing) // what the retry does once the folder exists

			status := watcher.Status()
			if status.OK != testCase.wantWatching {
				t.Errorf("status = %+v, want watching: %v", status, testCase.wantWatching)
			}
			wantDir := missing
			if testCase.wantOtherDir {
				wantDir = otherDir
			}
			if testCase.wantWatching && watcher.Dir() != wantDir {
				t.Errorf("watching %q, want %q", watcher.Dir(), wantDir)
			}
		})
	}
}
