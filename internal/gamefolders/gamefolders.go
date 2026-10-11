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

// ScreenshotsDir is <Documents>\Escape From Tarkov\Screenshots ("" when Documents is unknown).
// With OneDrive there can be two Documents folders; ChooseScreenshotsFolder (rules.go) picks the
// one the game uses.
func ScreenshotsDir() string {
	if dir := os.Getenv("STM_SCREENSHOTS_DIR"); dir != "" {
		return dir
	}
	var candidates []ScreenshotsCandidate
	for _, documents := range withoutDuplicates(documentsCandidates()) {
		dir := filepath.Join(documents, "Escape From Tarkov", "Screenshots")
		candidate := ScreenshotsCandidate{Dir: dir}
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			candidate.Exists = true
			candidate.Modified = info.ModTime()
		}
		candidates = append(candidates, candidate)
	}
	return ChooseScreenshotsFolder(candidates)
}

// LogsDir finds Tarkov's Logs folder: the launcher's uninstall entry in the registry
// (InstallLocation), then Steam's libraries. When more than one exists, the one the game wrote to
// last wins (MostRecentlyUsedLogs in rules.go). "" when not found (the user can paste it in
// Settings).
func LogsDir() string {
	if dir := os.Getenv("STM_LOGS_DIR"); dir != "" {
		return dir
	}
	var found []string
	for _, install := range launcherInstallFolders() {
		if logs := logsIn(install); logs != "" {
			found = append(found, logs)
		}
	}
	for _, steamRoot := range steamRoots() {
		found = append(found, logsFoldersInSteam(steamRoot)...)
	}
	var candidates []LogsCandidate
	for _, logs := range withoutDuplicates(found) {
		candidates = append(candidates, LogsCandidate{Dir: logs, NewestSession: NewestSessionFolder(logs)})
	}
	return MostRecentlyUsedLogs(candidates)
}

// LogsRoot turns the folder set in Settings into the Logs folder to watch. People paste what
// Explorer shows, which isn't always the Logs folder itself:
//   - the Logs folder (it holds log_… session folders): used as it is;
//   - one session folder (log_…, inside Logs): its parent, so the next game session is followed;
//   - the game's install folder: the Logs folder inside it (Logs or build\Logs).
//
// Anything else is used as it is (Settings then says what's wrong).
func LogsRoot(dir string) string {
	if dir == "" || hasSessionFolders(dir) {
		return dir
	}
	parent := filepath.Dir(dir)
	if IsSessionFolderName(filepath.Base(dir)) && hasSessionFolders(parent) {
		return parent
	}
	if logs := logsIn(dir); logs != "" {
		return logs
	}
	return dir
}

// NewestSessionFolder is the name of the session folder to follow inside a Logs folder ("" when
// there is none). The choice is NewestSessionFolderName in rules.go.
func NewestSessionFolder(logsDir string) string {
	return NewestSessionFolderName(subfolderNames(logsDir))
}

func hasSessionFolders(dir string) bool {
	for _, name := range subfolderNames(dir) {
		if IsSessionFolderName(name) {
			return true
		}
	}
	return false
}

func subfolderNames(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var names []string
	for _, entry := range entries {
		if entry.IsDir() {
			names = append(names, entry.Name())
		}
	}
	return names
}

// withoutDuplicates drops repeated folders (Windows paths aren't case-sensitive), keeping order.
func withoutDuplicates(folders []string) []string {
	var kept []string
	for _, folder := range folders {
		if folder == "" {
			continue
		}
		isRepeat := false
		for _, seen := range kept {
			if strings.EqualFold(filepath.Clean(seen), filepath.Clean(folder)) {
				isRepeat = true
				break
			}
		}
		if !isRepeat {
			kept = append(kept, folder)
		}
	}
	return kept
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

// logsInSteam is the first Logs folder of the game in Steam's libraries ("" when none).
func logsInSteam(steamRoot string) string {
	if found := logsFoldersInSteam(steamRoot); len(found) > 0 {
		return found[0]
	}
	return ""
}

// logsFoldersInSteam looks through Steam's library folders (libraryfolders.vdf) for EFT's install
// folder (named in appmanifest_3932890.acf) and returns its Logs folder in each library that has it.
func logsFoldersInSteam(steamRoot string) []string {
	libraries := []string{steamRoot}
	if vdf, err := os.ReadFile(filepath.Join(steamRoot, "steamapps", "libraryfolders.vdf")); err == nil {
		for _, match := range libraryPath.FindAllStringSubmatch(string(vdf), -1) {
			libraries = append(libraries, strings.ReplaceAll(match[1], `\\`, `\`))
		}
	}
	var found []string
	for _, library := range withoutDuplicates(libraries) {
		if logs := logsInSteamLibrary(library); logs != "" {
			found = append(found, logs)
		}
	}
	return found
}

// logsInSteamLibrary: the folder the app manifest names, else the usual "Escape from Tarkov".
func logsInSteamLibrary(library string) string {
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
