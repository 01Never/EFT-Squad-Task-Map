// Package gamefolders finds Tarkov's Logs folder and the screenshots folder on this PC.
// Settings can override both; STM_LOGS_DIR and STM_SCREENSHOTS_DIR override them in tests.
package gamefolders

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// The Steam app id of Escape from Tarkov.
const steamEFTAppID = "3932890"

// ScreenshotsDir is Documents\Escape From Tarkov\Screenshots ("" when Documents is unknown).
func ScreenshotsDir() string {
	if dir := os.Getenv("STM_SCREENSHOTS_DIR"); dir != "" {
		return dir
	}
	documents := DocumentsDir()
	if documents == "" {
		return ""
	}
	return filepath.Join(documents, "Escape From Tarkov", "Screenshots")
}

// LogsDir finds Tarkov's Logs folder: the launcher's uninstall entry in the registry
// (InstallLocation), then Steam's libraries. "" when not found (the user can paste it in Settings).
func LogsDir() string {
	if dir := os.Getenv("STM_LOGS_DIR"); dir != "" {
		return dir
	}
	for _, install := range launcherInstallFolders() {
		if logs := logsIn(install); logs != "" {
			return logs
		}
	}
	for _, steamRoot := range steamRoots() {
		if logs := logsInSteam(steamRoot); logs != "" {
			return logs
		}
	}
	return ""
}

// logsIn: the logs live in <install>\Logs or, on some installs, <install>\build\Logs.
func logsIn(install string) string {
	for _, candidate := range []string{filepath.Join(install, "Logs"), filepath.Join(install, "build", "Logs")} {
		if IsDir(candidate) {
			return candidate
		}
	}
	return ""
}

var (
	libraryPath = regexp.MustCompile(`"path"\s+"([^"]+)"`)
	installDir  = regexp.MustCompile(`"installdir"\s+"([^"]+)"`)
)

// logsInSteam looks through Steam's library folders (libraryfolders.vdf) for EFT's install folder
// (named in appmanifest_3932890.acf).
func logsInSteam(steamRoot string) string {
	libraries := []string{steamRoot}
	if vdf, err := os.ReadFile(filepath.Join(steamRoot, "steamapps", "libraryfolders.vdf")); err == nil {
		for _, match := range libraryPath.FindAllStringSubmatch(string(vdf), -1) {
			libraries = append(libraries, strings.ReplaceAll(match[1], `\\`, `\`))
		}
	}
	for _, library := range libraries {
		folders := []string{"Escape from Tarkov"}
		if acf, err := os.ReadFile(filepath.Join(library, "steamapps", "appmanifest_"+steamEFTAppID+".acf")); err == nil {
			if match := installDir.FindStringSubmatch(string(acf)); match != nil {
				folders = append([]string{match[1]}, folders...)
			}
		}
		for _, folder := range folders {
			if logs := logsIn(filepath.Join(library, "steamapps", "common", folder)); logs != "" {
				return logs
			}
		}
	}
	return ""
}

// IsDir reports whether a path is an existing folder.
func IsDir(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}
