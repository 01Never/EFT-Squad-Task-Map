package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// How many pre-update backups are kept (the newest ones).
const updateBackupsToKeep = 3

// The backup of the saved data made before a new version's first start:
// squad-task-map-data.before-<version>.json, next to the data file.
const (
	updateBackupPrefix = "squad-task-map-data.before-"
	updateBackupSuffix = ".json"
)

// BackupStateBeforeUpdate copies the saved data to squad-task-map-data.before-<version>.json and
// deletes the oldest of these backups so only the newest 3 remain (ticket 04c). With no saved
// data there is nothing to back up. The saved data itself is never modified.
func BackupStateBeforeUpdate(files Files, version string) error {
	if strings.ContainsAny(version, `/\`) || version == "" {
		return fmt.Errorf("not a usable version: %q", version)
	}
	if !FileExists(files.State) {
		return nil
	}
	backupPath := filepath.Join(files.Dir, updateBackupPrefix+version+updateBackupSuffix)
	if err := copyFile(files.State, backupPath); err != nil {
		return fmt.Errorf("backing up %s: %w", files.State, err)
	}
	return deleteOldUpdateBackups(files.Dir, updateBackupsToKeep)
}

// deleteOldUpdateBackups keeps the newest `keep` backups (by modification time, then name) and
// deletes the rest. Only files named like our backups are ever looked at.
func deleteOldUpdateBackups(folder string, keep int) error {
	matches, err := filepath.Glob(filepath.Join(folder, updateBackupPrefix+"*"+updateBackupSuffix))
	if err != nil {
		return err
	}
	type backup struct {
		path     string
		modified int64
	}
	var backups []backup
	for _, path := range matches {
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		backups = append(backups, backup{path, info.ModTime().UnixNano()})
	}
	sort.Slice(backups, func(a, b int) bool {
		if backups[a].modified != backups[b].modified {
			return backups[a].modified > backups[b].modified // newest first
		}
		return backups[a].path > backups[b].path
	})
	for index := keep; index < len(backups); index++ {
		if err := os.Remove(backups[index].path); err != nil {
			return fmt.Errorf("removing the old backup %s: %w", backups[index].path, err)
		}
	}
	return nil
}
