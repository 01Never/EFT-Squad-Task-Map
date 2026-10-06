package storage

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

// backupNames lists the pre-update backups in a data folder, sorted.
func backupNames(t *testing.T, folder string) []string {
	t.Helper()
	matches, _ := filepath.Glob(filepath.Join(folder, "squad-task-map-data.before-*.json"))
	var names []string
	for _, match := range matches {
		names = append(names, filepath.Base(match))
	}
	sort.Strings(names)
	return names
}

func TestTheSavedDataIsCopiedBeforeTheNewVersionFirstStarts(t *testing.T) {
	files := FilesIn(t.TempDir())
	writeText(t, files.State, `{"version":2,"tasks":[1]}`)

	if err := BackupStateBeforeUpdate(files, "2.6.0"); err != nil {
		t.Fatalf("BackupStateBeforeUpdate: %v", err)
	}

	backup := filepath.Join(files.Dir, "squad-task-map-data.before-2.6.0.json")
	if got := readText(t, backup); got != `{"version":2,"tasks":[1]}` {
		t.Fatalf("backup holds %q", got)
	}
	if got := readText(t, files.State); got != `{"version":2,"tasks":[1]}` {
		t.Fatalf("the saved data itself must not change, found %q", got)
	}
}

func TestWithNoSavedDataThereIsNothingToBackUp(t *testing.T) {
	files := FilesIn(t.TempDir())
	if err := BackupStateBeforeUpdate(files, "2.6.0"); err != nil {
		t.Fatalf("BackupStateBeforeUpdate: %v", err)
	}
	if names := backupNames(t, files.Dir); len(names) != 0 {
		t.Fatalf("unexpected backups %v", names)
	}
}

func TestOnlyTheNewestThreeUpdateBackupsAreKept(t *testing.T) {
	files := FilesIn(t.TempDir())
	writeText(t, files.State, `{}`)
	other := filepath.Join(files.Dir, "squad-task-map-data.v1-backup.json")
	writeText(t, other, `{"keep":"me"}`)

	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for index, version := range []string{"2.5.0", "2.6.0", "2.7.0", "2.8.0", "2.9.0"} {
		if err := BackupStateBeforeUpdate(files, version); err != nil {
			t.Fatal(err)
		}
		// Make each backup clearly newer than the last, whatever the file system's clock resolution.
		path := filepath.Join(files.Dir, "squad-task-map-data.before-"+version+".json")
		modified := start.Add(time.Duration(index) * time.Hour)
		if err := os.Chtimes(path, modified, modified); err != nil {
			t.Fatal(err)
		}
	}
	// One more update: the oldest of the four that remain goes.
	if err := BackupStateBeforeUpdate(files, "2.10.0"); err != nil {
		t.Fatal(err)
	}

	got := strings.Join(backupNames(t, files.Dir), " ")
	want := "squad-task-map-data.before-2.10.0.json squad-task-map-data.before-2.8.0.json squad-task-map-data.before-2.9.0.json"
	if got != want {
		t.Fatalf("backups kept:\n got  %s\n want %s", got, want)
	}
	if readText(t, other) != `{"keep":"me"}` {
		t.Fatal("other backup files must never be touched")
	}
}

func TestAVersionThatCouldEscapeTheFolderIsRefused(t *testing.T) {
	files := FilesIn(t.TempDir())
	writeText(t, files.State, `{}`)
	for _, version := range []string{"", "../x", `..\x`, "a/b"} {
		if err := BackupStateBeforeUpdate(files, version); err == nil {
			t.Errorf("version %q must be refused", version)
		}
	}
}
