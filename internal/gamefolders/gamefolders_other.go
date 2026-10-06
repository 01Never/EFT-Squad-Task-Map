//go:build !windows

package gamefolders

import (
	"os"
	"path/filepath"
)

// DocumentsDir is ~/Documents on systems other than Windows (development only; the game is Windows-only).
func DocumentsDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, "Documents")
}

func launcherInstallFolders() []string { return nil }
func steamRoots() []string             { return nil }
