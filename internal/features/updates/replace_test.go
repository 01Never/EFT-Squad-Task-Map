package updates

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// memoryFiles is a FileOps on an in-memory folder, so the swap and its rollback are tested
// without touching a disk. fail makes a named operation fail: "rename:<old>-><new>",
// "remove:<path>" or "writable".
type memoryFiles struct {
	contents map[string]string // path -> what the file holds ("old exe", "new exe")
	fail     map[string]error
	log      []string
}

func newMemoryFiles(contents map[string]string) *memoryFiles {
	return &memoryFiles{contents: contents, fail: map[string]error{}}
}

func (files *memoryFiles) Rename(oldPath, newPath string) error {
	files.log = append(files.log, "rename "+oldPath+" -> "+newPath)
	if err := files.fail["rename:"+oldPath+"->"+newPath]; err != nil {
		return err
	}
	text, exists := files.contents[oldPath]
	if !exists {
		return os.ErrNotExist
	}
	delete(files.contents, oldPath)
	files.contents[newPath] = text
	return nil
}

func (files *memoryFiles) Remove(path string) error {
	files.log = append(files.log, "remove "+path)
	if err := files.fail["remove:"+path]; err != nil {
		return err
	}
	delete(files.contents, path)
	return nil
}

func (files *memoryFiles) Exists(path string) bool {
	_, exists := files.contents[path]
	return exists
}

func (files *memoryFiles) CheckWritable(string) error { return files.fail["writable"] }

// folder shows what's in the folder, e.g. "SquadTaskMap.exe=new exe, SquadTaskMap.previous.exe=old exe".
func (files *memoryFiles) folder() string {
	var entries []string
	for path, text := range files.contents {
		entries = append(entries, filepath.Base(path)+"="+text)
	}
	sort.Strings(entries)
	return strings.Join(entries, ", ")
}

var testPaths = PathsBeside(filepath.Join("app", "SquadTaskMap.exe"))

func TestPathsSitNextToTheExe(t *testing.T) {
	paths := PathsBeside(filepath.Join("games", "tools", "SquadTaskMap.exe"))
	want := ExePaths{
		Current:     filepath.Join("games", "tools", "SquadTaskMap.exe"),
		Download:    filepath.Join("games", "tools", "SquadTaskMap.download.exe"),
		Previous:    filepath.Join("games", "tools", "SquadTaskMap.previous.exe"),
		PreviousOld: filepath.Join("games", "tools", "SquadTaskMap.previous.old.exe"),
	}
	if paths != want {
		t.Fatalf("paths = %+v, want %+v", paths, want)
	}
}

func TestTheNewExeTakesTheCurrentNameAndTheOldOneIsKeptAsPrevious(t *testing.T) {
	tests := []struct {
		name   string
		before map[string]string
		want   string
	}{
		{
			"the first update",
			map[string]string{testPaths.Current: "old exe", testPaths.Download: "new exe"},
			"SquadTaskMap.exe=new exe, SquadTaskMap.previous.exe=old exe",
		},
		{
			"an older previous copy is replaced",
			map[string]string{testPaths.Current: "old exe", testPaths.Download: "new exe", testPaths.Previous: "ancient exe"},
			"SquadTaskMap.exe=new exe, SquadTaskMap.previous.exe=old exe",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			files := newMemoryFiles(test.before)
			if err := SwapInNewExe(files, testPaths); err != nil {
				t.Fatalf("SwapInNewExe: %v", err)
			}
			FinishSwap(files, testPaths) // the new copy started: the older previous goes
			if got := files.folder(); got != test.want {
				t.Fatalf("folder = %s, want %s", got, test.want)
			}
		})
	}
}

func TestEachStepOfTheSwapRollsBackWhenItFails(t *testing.T) {
	boom := errors.New("access denied")
	tests := []struct {
		name         string
		failure      string
		wantFolder   string
		wantCode     string
		wantContains string
	}{
		{
			"no download to install",
			"",
			"SquadTaskMap.exe=old exe",
			CodeNothingToApply,
			"",
		},
		{
			"the old previous copy can't be set aside: nothing is changed",
			"rename:" + testPaths.Previous + "->" + testPaths.PreviousOld,
			"SquadTaskMap.download.exe=new exe, SquadTaskMap.exe=old exe, SquadTaskMap.previous.exe=ancient exe",
			CodeApplyFailed,
			"Nothing was changed",
		},
		{
			"the current exe can't be renamed: nothing is changed",
			"rename:" + testPaths.Current + "->" + testPaths.Previous,
			"SquadTaskMap.download.exe=new exe, SquadTaskMap.exe=old exe",
			CodeApplyFailed,
			"Nothing was changed",
		},
		{
			"the new exe can't take its place: the old one is put back",
			"rename:" + testPaths.Download + "->" + testPaths.Current,
			"SquadTaskMap.download.exe=new exe, SquadTaskMap.exe=old exe",
			CodeApplyFailed,
			"old version is still in place",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			contents := map[string]string{testPaths.Current: "old exe", testPaths.Download: "new exe"}
			if strings.HasPrefix(test.failure, "rename:"+testPaths.Previous) {
				contents[testPaths.Previous] = "ancient exe"
			}
			if test.name == "no download to install" {
				delete(contents, testPaths.Download)
			}
			files := newMemoryFiles(contents)
			if test.failure != "" {
				files.fail[test.failure] = boom
			}

			err := SwapInNewExe(files, testPaths)
			if errorCode(err) != test.wantCode {
				t.Fatalf("error = %v, want code %s", err, test.wantCode)
			}
			if test.wantContains != "" && !strings.Contains(err.Error(), test.wantContains) {
				t.Fatalf("message %q should contain %q", err.Error(), test.wantContains)
			}
			if got := files.folder(); got != test.wantFolder {
				t.Fatalf("folder = %s, want %s", got, test.wantFolder)
			}
		})
	}
}

func TestWhenTheRollbackFailsToo_TheMessageTellsWhatToRenameByHand(t *testing.T) {
	files := newMemoryFiles(map[string]string{testPaths.Current: "old exe", testPaths.Download: "new exe"})
	files.fail["rename:"+testPaths.Download+"->"+testPaths.Current] = errors.New("locked")
	files.fail["rename:"+testPaths.Previous+"->"+testPaths.Current] = errors.New("locked")

	err := SwapInNewExe(files, testPaths)
	if errorCode(err) != CodeApplyFailed {
		t.Fatalf("error = %v", err)
	}
	instruction := fmt.Sprintf("Rename %q to %q by hand", testPaths.Previous, testPaths.Current)
	if !strings.Contains(err.Error(), instruction) {
		t.Fatalf("message %q should say: %s", err.Error(), instruction)
	}
}

func TestUndoingASwapBringsTheOldExeBack(t *testing.T) {
	t.Run("the new exe goes back to its download name", func(t *testing.T) {
		files := newMemoryFiles(map[string]string{testPaths.Current: "new exe", testPaths.Previous: "old exe"})
		if err := UndoSwap(files, testPaths); err != nil {
			t.Fatalf("UndoSwap: %v", err)
		}
		want := "SquadTaskMap.download.exe=new exe, SquadTaskMap.exe=old exe"
		if got := files.folder(); got != want {
			t.Fatalf("folder = %s, want %s", got, want)
		}
	})
	t.Run("a new exe that can't be renamed is deleted instead", func(t *testing.T) {
		files := newMemoryFiles(map[string]string{testPaths.Current: "new exe", testPaths.Previous: "old exe"})
		files.fail["rename:"+testPaths.Current+"->"+testPaths.Download] = errors.New("locked")
		if err := UndoSwap(files, testPaths); err != nil {
			t.Fatalf("UndoSwap: %v", err)
		}
		if got := files.folder(); got != "SquadTaskMap.exe=old exe" {
			t.Fatalf("folder = %s", got)
		}
	})
	t.Run("when the old exe can't be restored, the message says how to do it by hand", func(t *testing.T) {
		files := newMemoryFiles(map[string]string{testPaths.Current: "new exe", testPaths.Previous: "old exe"})
		files.fail["rename:"+testPaths.Previous+"->"+testPaths.Current] = errors.New("locked")
		err := UndoSwap(files, testPaths)
		if errorCode(err) != CodeApplyFailed || !strings.Contains(err.Error(), "by hand") {
			t.Fatalf("error = %v", err)
		}
	})
}

func TestAFailedSecondUpdateKeepsTheFirstUpdatesPreviousExe(t *testing.T) {
	// The first update left "previous" (v1). A second update (v2 -> v3) fails to start.
	files := newMemoryFiles(map[string]string{
		testPaths.Current: "v2 exe", testPaths.Download: "v3 exe", testPaths.Previous: "v1 exe",
	})
	if err := SwapInNewExe(files, testPaths); err != nil {
		t.Fatal(err)
	}
	during := "SquadTaskMap.exe=v3 exe, SquadTaskMap.previous.exe=v2 exe, SquadTaskMap.previous.old.exe=v1 exe"
	if got := files.folder(); got != during {
		t.Fatalf("during the swap the older previous is set aside, not deleted: %s", got)
	}

	if err := UndoSwap(files, testPaths); err != nil {
		t.Fatal(err)
	}

	want := "SquadTaskMap.download.exe=v3 exe, SquadTaskMap.exe=v2 exe, SquadTaskMap.previous.exe=v1 exe"
	if got := files.folder(); got != want {
		t.Fatalf("folder = %s, want %s", got, want)
	}
}

func TestAFailedSwapStepBringsTheOlderPreviousBack(t *testing.T) {
	files := newMemoryFiles(map[string]string{
		testPaths.Current: "v2 exe", testPaths.Download: "v3 exe", testPaths.Previous: "v1 exe",
	})
	files.fail["rename:"+testPaths.Download+"->"+testPaths.Current] = errors.New("locked")

	if err := SwapInNewExe(files, testPaths); err == nil {
		t.Fatal("expected a failure")
	}

	want := "SquadTaskMap.download.exe=v3 exe, SquadTaskMap.exe=v2 exe, SquadTaskMap.previous.exe=v1 exe"
	if got := files.folder(); got != want {
		t.Fatalf("folder = %s, want %s", got, want)
	}
}

func TestTheRealFileOperationsSwapFilesOnDisk(t *testing.T) {
	folder := t.TempDir()
	paths := PathsBeside(filepath.Join(folder, "SquadTaskMap.exe"))
	os.WriteFile(paths.Current, []byte("old"), 0o644)
	os.WriteFile(paths.Download, []byte("new"), 0o644)
	os.WriteFile(paths.Previous, []byte("ancient"), 0o644)
	ops := OSFileOps()

	if err := ops.CheckWritable(folder); err != nil {
		t.Fatalf("a normal folder is writable: %v", err)
	}
	if err := SwapInNewExe(ops, paths); err != nil {
		t.Fatalf("SwapInNewExe: %v", err)
	}
	current, _ := os.ReadFile(paths.Current)
	previous, _ := os.ReadFile(paths.Previous)
	if string(current) != "new" || string(previous) != "old" || ops.Exists(paths.Download) {
		t.Fatalf("current=%q previous=%q downloadStillThere=%v", current, previous, ops.Exists(paths.Download))
	}
	if err := ops.Remove(filepath.Join(folder, "not there")); err != nil {
		t.Fatalf("removing a missing file is not an error: %v", err)
	}
	if err := ops.CheckWritable(filepath.Join(folder, "missing folder")); err == nil {
		t.Fatal("a folder that can't be written to must be reported")
	}
}
