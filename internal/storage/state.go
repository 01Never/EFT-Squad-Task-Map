package storage

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
)

// The page owns the saved data (tasks, categories, ticks, drawings…). The server stores it as
// text and never looks inside, except to check it's JSON and whether it's still v1.

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
func BackupV1IfNeeded(files Files) {
	if !FileExists(files.State) || FileExists(files.V1Backup) {
		return
	}
	data, err := os.ReadFile(files.State)
	if err != nil {
		return
	}
	var saved any
	if json.Unmarshal(data, &saved) != nil || saved == nil {
		return
	}
	if object, isObject := saved.(map[string]any); isObject {
		if version, isNumber := object["version"].(float64); isNumber && version == 2 {
			return
		}
	}
	_ = copyFile(files.State, files.V1Backup)
}

func copyFile(from, to string) error {
	data, err := os.ReadFile(from)
	if err != nil {
		return err
	}
	return os.WriteFile(to, data, 0o644)
}
