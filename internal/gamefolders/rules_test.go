package gamefolders

import (
	"path/filepath"
	"testing"
	"time"
)

func TestTheNewestSessionFolderIsFollowedAndOtherFoldersAreIgnored(t *testing.T) {
	cases := []struct {
		name    string
		folders []string
		want    string
	}{
		{
			"the session folder whose date is latest",
			[]string{"log_2026.10.01_10-00-00_1.1.5.1.47510", "log_2026.10.04_22-11-56_1.1.5.1.47510"},
			"log_2026.10.04_22-11-56_1.1.5.1.47510",
		},
		{
			"a newer game version on the same day still sorts by time first",
			[]string{"log_2026.10.04_22-11-56_1.1.5.1.47510", "log_2026.10.04_09-00-00_1.1.6.0.48000"},
			"log_2026.10.04_22-11-56_1.1.5.1.47510",
		},
		{
			"a stray folder that sorts after log_ is not a session",
			[]string{"log_2026.10.04_22-11-56_1.1.5.1.47510", "old logs", "traces"},
			"log_2026.10.04_22-11-56_1.1.5.1.47510",
		},
		{
			"an upper-case Log_ prefix is still a session",
			[]string{"Log_2026.10.05_08-00-00_1.1.5.1.47510", "log_2026.10.04_22-11-56_1.1.5.1.47510"},
			"Log_2026.10.05_08-00-00_1.1.5.1.47510",
		},
		{"no session folder at all: the last name, as before", []string{"a", "b"}, "b"},
		{"no folders", nil, ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := NewestSessionFolderName(testCase.folders); got != testCase.want {
				t.Errorf("got %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestTheLogsFolderTheGameWroteToLastWins(t *testing.T) {
	launcher := LogsCandidate{Dir: `C:\Battlestate Games\EFT\Logs`, NewestSession: "log_2025.06.01_20-00-00_0.16.0.0.36000"}
	steam := LogsCandidate{Dir: `D:\SteamLibrary\steamapps\common\Escape from Tarkov\build\Logs`, NewestSession: "log_2026.10.04_22-11-56_1.1.5.1.47510"}
	empty := LogsCandidate{Dir: `E:\EFT\Logs`}
	cases := []struct {
		name       string
		candidates []LogsCandidate
		want       string
	}{
		{"an old launcher install and the Steam install played now: Steam", []LogsCandidate{launcher, steam}, steam.Dir},
		{"the launcher install played now: the launcher", []LogsCandidate{steam, launcher}, steam.Dir},
		{"a Logs folder without sessions doesn't win", []LogsCandidate{empty, launcher}, launcher.Dir},
		{"a stray folder doesn't count as a session", []LogsCandidate{{Dir: `F:\Logs`, NewestSession: "traces"}, launcher}, launcher.Dir},
		{"none has sessions: the first found, as before", []LogsCandidate{empty, {Dir: `F:\Logs`}}, empty.Dir},
		{"only one", []LogsCandidate{launcher}, launcher.Dir},
		{"nothing found", nil, ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := MostRecentlyUsedLogs(testCase.candidates); got != testCase.want {
				t.Errorf("got %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestTheScreenshotsFolderIsTheOneTheGameUses(t *testing.T) {
	oneDrive := `C:\Users\Jürgen\OneDrive - Personal\Dokumente\Escape From Tarkov\Screenshots`
	local := `C:\Users\Jürgen\Documents\Escape From Tarkov\Screenshots`
	earlier := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	later := earlier.Add(48 * time.Hour)
	cases := []struct {
		name       string
		candidates []ScreenshotsCandidate
		want       string
	}{
		{
			"only the OneDrive one exists",
			[]ScreenshotsCandidate{{Dir: oneDrive, Exists: true, Modified: earlier}, {Dir: local}},
			oneDrive,
		},
		{
			"only the old local one exists: the game writes there",
			[]ScreenshotsCandidate{{Dir: oneDrive}, {Dir: local, Exists: true, Modified: earlier}},
			local,
		},
		{
			"both exist: the one with the latest screenshot",
			[]ScreenshotsCandidate{{Dir: oneDrive, Exists: true, Modified: earlier}, {Dir: local, Exists: true, Modified: later}},
			local,
		},
		{
			"both exist, same time: the one Windows reports",
			[]ScreenshotsCandidate{{Dir: oneDrive, Exists: true, Modified: later}, {Dir: local, Exists: true, Modified: later}},
			oneDrive,
		},
		{
			"none exists yet: the one Windows reports",
			[]ScreenshotsCandidate{{Dir: oneDrive}, {Dir: local}},
			oneDrive,
		},
		{"no Documents folder known", nil, ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := ChooseScreenshotsFolder(testCase.candidates); got != testCase.want {
				t.Errorf("got %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestAFolderPastedInSettingsBecomesTheLogsFolder(t *testing.T) {
	install := t.TempDir()
	logs := filepath.Join(install, "build", "Logs")
	session := filepath.Join(logs, "log_2026.10.04_22-11-56_1.1.5.1.47510")
	makeDirs(t, session)
	writeFile(t, filepath.Join(session, "2026.10.04_22-11-56_1.1.5.1.47510 application_000.log"), "")
	other := t.TempDir()

	cases := []struct {
		name  string
		given string
		want  string
	}{
		{"the Logs folder itself", logs, logs},
		{"one session folder: its Logs folder", session, logs},
		{"the install folder: the Logs folder inside", install, logs},
		{"an unrelated folder stays as it is", other, other},
		{"a folder that isn't there stays as it is", filepath.Join(other, "missing"), filepath.Join(other, "missing")},
		{"nothing set", "", ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := LogsRoot(testCase.given); got != testCase.want {
				t.Errorf("got %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestEverySteamLibraryWithTheGameIsACandidate(t *testing.T) {
	root := t.TempDir()
	steamRoot, library := filepath.Join(root, "Steam"), filepath.Join(root, "SteamLibrary")
	first := filepath.Join(steamRoot, "steamapps", "common", "Escape from Tarkov", "Logs")
	second := filepath.Join(library, "steamapps", "common", "Escape from Tarkov", "build", "Logs")
	makeDirs(t, first, second)
	writeFile(t, filepath.Join(steamRoot, "steamapps", "libraryfolders.vdf"),
		`"libraryfolders" { "0" { "path" "`+vdfPath(steamRoot)+`" } "1" { "path" "`+vdfPath(library)+`" } }`)

	got := logsFoldersInSteam(steamRoot)
	if len(got) != 2 || got[0] != first || got[1] != second {
		t.Errorf("got %q, want both libraries' Logs folders (Steam's own library listed once)", got)
	}
}
