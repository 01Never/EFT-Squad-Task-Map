// Package storage owns the app's own files next to the exe: settings, the page's saved data
// (stored as opaque text: the page owns its format), backups, and the folder they live in.
// It never touches the game's files.
package storage

import (
	"os"
	"path/filepath"
	"strings"
)

// Files lists every file the app keeps in its data folder.
type Files struct {
	Dir          string // the data folder (next to the exe, or STM_DATA_DIR)
	State        string // squad-task-map-data.json: the page's saved data
	V1Backup     string // squad-task-map-data.v1-backup.json: untouched copy before the v1 → v2 migration
	Settings     string // squad-task-map-settings.json
	Pending      string // squad-task-map-pending.json: game events waiting for the page to acknowledge them
	WikiCache    string // squad-task-map-wikicache.json
	Instance     string // squad-task-map-instance.json: which port the running copy listens on
	UpdateNotice string // squad-task-map-update-notice.json: release notes handed to the copy an update starts
	SquadCache   string // squad-task-map-squad.json: my last share and friends' last shares (ticket 05)
	SquadNetwork string // squad-task-map-tailscale/: tsnet's state folder with the node key; secret (ticket 05)
	gameDataFn   func(mode string) string
}

// GameDataCache is the cached game data for one game mode.
func (f Files) GameDataCache(mode string) string { return f.gameDataFn(mode) }

// FilesIn returns the file layout for a data folder.
func FilesIn(dir string) Files {
	join := func(name string) string { return filepath.Join(dir, name) }
	return Files{
		Dir:          dir,
		State:        join("squad-task-map-data.json"),
		V1Backup:     join("squad-task-map-data.v1-backup.json"),
		Settings:     join("squad-task-map-settings.json"),
		Pending:      join("squad-task-map-pending.json"),
		WikiCache:    join("squad-task-map-wikicache.json"),
		Instance:     join("squad-task-map-instance.json"),
		UpdateNotice: join("squad-task-map-update-notice.json"),
		SquadCache:   join("squad-task-map-squad.json"),
		SquadNetwork: join("squad-task-map-tailscale"),
		gameDataFn:   func(mode string) string { return join("squad-task-map-gamedata-" + mode + ".json") },
	}
}

// DataDir decides where the data files live:
//   - STM_DATA_DIR when set (development and tests use a scratch folder);
//   - next to the exe for a built exe;
//   - the current folder under `go run` (the exe is then a temporary build file).
func DataDir() string {
	if dir := os.Getenv("STM_DATA_DIR"); dir != "" {
		return dir
	}
	exe, err := os.Executable()
	if err != nil || isTemporaryGoBuild(exe) {
		cwd, _ := os.Getwd()
		return cwd
	}
	return filepath.Dir(exe)
}

// isTemporaryGoBuild: `go run` builds the exe in a go-build folder. Only that counts: a real exe kept
// in any folder (even one named Temp) keeps its data next to itself.
func isTemporaryGoBuild(exePath string) bool {
	return strings.Contains(strings.ToLower(exePath), "go-build")
}

// WriteFileAtomic writes the whole file or nothing: it writes a temporary file first, then renames
// it over the old one, so a crash mid-write never leaves half a file.
func WriteFileAtomic(path string, data []byte) error {
	temp := path + ".tmp"
	if err := os.WriteFile(temp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(temp, path)
}

// FileExists reports whether a regular file exists.
func FileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
