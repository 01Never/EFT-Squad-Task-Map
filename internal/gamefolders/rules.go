package gamefolders

import (
	"sort"
	"strings"
	"time"
)

// The rules for choosing between folders. Plain functions over names and times; the lookups that
// read the disk are in gamefolders.go.

// Tarkov makes one folder per game session inside Logs, named log_<date>_<time>_<version>, for
// example "log_2026.10.04_22-11-56_1.1.5.1.47510". The date comes first, so the newest sorts last.
const sessionFolderPrefix = "log_"

// IsSessionFolderName: is this the name of one game session's log folder?
func IsSessionFolderName(name string) bool {
	return strings.HasPrefix(strings.ToLower(name), sessionFolderPrefix)
}

// NewestSessionFolderName picks the folder to follow among a Logs folder's subfolders: the session
// folder whose name sorts last. Other folders (anything not named log_…) are ignored, so a stray
// folder whose name sorts after "log_…" can't hide the real session. When there's no session
// folder at all, the name that sorts last is used, as before. "" when there are no folders.
func NewestSessionFolderName(folderNames []string) string {
	var sessions []string
	for _, name := range folderNames {
		if IsSessionFolderName(name) {
			sessions = append(sessions, name)
		}
	}
	if len(sessions) == 0 {
		sessions = append(sessions, folderNames...)
	}
	if len(sessions) == 0 {
		return ""
	}
	sort.Slice(sessions, func(a, b int) bool { return sortsBefore(sessions[a], sessions[b]) })
	return sessions[len(sessions)-1]
}

// sortsBefore compares folder names the way Explorer lists them: upper and lower case alike.
func sortsBefore(first, second string) bool {
	firstLower, secondLower := strings.ToLower(first), strings.ToLower(second)
	if firstLower != secondLower {
		return firstLower < secondLower
	}
	return first < second
}

// LogsCandidate is one Logs folder found on this PC, with the name of its newest session folder
// ("" when it has none).
type LogsCandidate struct {
	Dir           string
	NewestSession string
}

// MostRecentlyUsedLogs picks the Logs folder the game wrote to last. A PC can have more than one
// install (the launcher's and Steam's, or an old install the uninstall entry still points at), and
// the first one found isn't always the one being played. Session names start with the date, so
// they compare across installs. Ties, and folders without sessions, keep the lookup order.
// "" when there are no candidates.
func MostRecentlyUsedLogs(candidates []LogsCandidate) string {
	if len(candidates) == 0 {
		return ""
	}
	var best *LogsCandidate
	for index := range candidates {
		candidate := &candidates[index]
		if !IsSessionFolderName(candidate.NewestSession) {
			continue
		}
		if best == nil || sortsBefore(best.NewestSession, candidate.NewestSession) {
			best = candidate
		}
	}
	if best == nil {
		return candidates[0].Dir
	}
	return best.Dir
}

// ScreenshotsCandidate is one place the screenshots folder could be: <Documents>\Escape From
// Tarkov\Screenshots for each Documents folder this PC might use.
type ScreenshotsCandidate struct {
	Dir      string
	Exists   bool
	Modified time.Time // the folder's last change: a new screenshot updates it
}

// ChooseScreenshotsFolder picks where the game saves screenshots. The first candidate is the
// Documents folder Windows reports; with OneDrive there can be a second Documents folder (the old
// %USERPROFILE%\Documents, or OneDrive's), and only the game knows which one it writes to. So:
// of the folders that exist, the one changed most recently (ties keep the order); when none
// exists yet, the first candidate (the folder appears after the first screenshot).
func ChooseScreenshotsFolder(candidates []ScreenshotsCandidate) string {
	var best *ScreenshotsCandidate
	for index := range candidates {
		candidate := &candidates[index]
		if !candidate.Exists {
			continue
		}
		if best == nil || candidate.Modified.After(best.Modified) {
			best = candidate
		}
	}
	if best != nil {
		return best.Dir
	}
	if len(candidates) > 0 {
		return candidates[0].Dir
	}
	return ""
}
