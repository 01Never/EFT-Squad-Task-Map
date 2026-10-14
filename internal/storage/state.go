package storage

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
)

// The page owns the saved data (tasks, categories, ticks, drawings…). The server stores it as
// text and never looks inside, except to check it's JSON and which version it is
// (for the one-time v1 and v2 backups).

// ReadStateText returns the saved data, or "null" when there's none yet (the page then starts fresh).
func ReadStateText(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return "null"
	}
	return string(data)
}

// WriteStateText saves the page's data. The previous file is kept as .bak first, and anything
// that isn't JSON is refused, so a broken request can't wipe the data.
func WriteStateText(path string, text []byte) error {
	if !json.Valid(text) {
		return errors.New("the saved data isn't valid JSON")
	}
	if FileExists(path) {
		if err := copyFile(path, path+".bak"); err != nil {
			return fmt.Errorf("keeping a backup of %s: %w", path, err)
		}
	}
	if err := WriteFileAtomic(path, text); err != nil {
		return fmt.Errorf("writing %s: %w", path, err)
	}
	return nil
}

// BackupV1IfNeeded keeps one untouched copy of v1 data before the page migrates it to v2.
// v1 data has no "version" (or version 1); v2 and later files are never copied here, so a file the
// page has already moved to v3 doesn't land in the v1 backup either.
func BackupV1IfNeeded(files Files) {
	if FileExists(files.V1Backup) {
		return
	}
	version, hasData := savedDataVersion(files.State)
	if !hasData || version >= 2 {
		return
	}
	_ = copyFile(files.State, files.V1Backup)
}

// BackupV2IfNeeded keeps one untouched copy of v2 data before the page migrates it to v3 (one
// task list per game mode, issue #22). Only a file that says "version": 2 is copied, and only
// while there's no v2 backup yet.
func BackupV2IfNeeded(files Files) {
	if FileExists(files.V2Backup) {
		return
	}
	version, hasData := savedDataVersion(files.State)
	if !hasData || version != 2 {
		return
	}
	_ = copyFile(files.State, files.V2Backup)
}

// savedDataVersion reads the "version" of the page's saved data. hasData is false when there's
// no file, it isn't JSON, or it's null (nothing saved yet). Data without a version number (v1)
// reads as version 0.
func savedDataVersion(path string) (version float64, hasData bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	var saved any
	if json.Unmarshal(data, &saved) != nil || saved == nil {
		return 0, false
	}
	object, isObject := saved.(map[string]any)
	if !isObject {
		return 0, true
	}
	number, isNumber := object["version"].(float64)
	if !isNumber {
		return 0, true
	}
	return number, true
}

func copyFile(from, to string) error {
	data, err := os.ReadFile(from)
	if err != nil {
		return err
	}
	return os.WriteFile(to, data, 0o644)
}
