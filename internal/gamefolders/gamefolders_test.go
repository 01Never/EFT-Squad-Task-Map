package gamefolders

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func makeDirs(t *testing.T, paths ...string) {
	t.Helper()
	for _, path := range paths {
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatal(err)
		}
	}
}

func writeFile(t *testing.T, path, text string) {
	t.Helper()
	makeDirs(t, filepath.Dir(path))
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

// vdfPath writes a path the way Steam does in its .vdf files: with every backslash doubled.
func vdfPath(path string) string { return strings.ReplaceAll(path, `\`, `\\`) }

func TestTheLogsAreInTheInstallFolderOrItsBuildFolder(t *testing.T) {
	cases := []struct {
		name    string
		folders []string // made inside the install folder
		want    string   // "" = not found
	}{
		{"Logs next to the game", []string{"Logs"}, "Logs"},
		{"Logs inside build", []string{filepath.Join("build", "Logs")}, filepath.Join("build", "Logs")},
		{"both: the install folder's own Logs first", []string{"Logs", filepath.Join("build", "Logs")}, "Logs"},
		{"no Logs folder", []string{"build"}, ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			install := t.TempDir()
			for _, folder := range testCase.folders {
				makeDirs(t, filepath.Join(install, folder))
			}
			want := ""
			if testCase.want != "" {
				want = filepath.Join(install, testCase.want)
			}
			if got := logsIn(install); got != want {
				t.Errorf("got %q, want %q", got, want)
			}
		})
	}
}

func TestALogsFileIsNotALogsFolder(t *testing.T) {
	install := t.TempDir()
	writeFile(t, filepath.Join(install, "Logs"), "not a folder")
	if got := logsIn(install); got != "" {
		t.Errorf("got %q, want nothing", got)
	}
}

func TestSteamLibrariesAreSearchedForTheGame(t *testing.T) {
	cases := []struct {
		name    string
		setUp   func(t *testing.T, steamRoot, library string)
		wantDir func(steamRoot, library string) string // "" = not found
	}{
		{
			"the game in Steam's own library under its usual name",
			func(t *testing.T, steamRoot, _ string) {
				makeDirs(t, filepath.Join(steamRoot, "steamapps", "common", "Escape from Tarkov", "build", "Logs"))
			},
			func(steamRoot, _ string) string {
				return filepath.Join(steamRoot, "steamapps", "common", "Escape from Tarkov", "build", "Logs")
			},
		},
		{
			"a second library from libraryfolders.vdf, with the folder named in the app manifest",
			func(t *testing.T, steamRoot, library string) {
				writeFile(t, filepath.Join(steamRoot, "steamapps", "libraryfolders.vdf"), `"libraryfolders"
{
	"0"
	{
		"path"		"`+vdfPath(steamRoot)+`"
		"label"		""
	}
	"1"
	{
		"path"		"`+vdfPath(library)+`"
		"apps"
		{
			"3932890"		"60000000000"
		}
	}
}`)
				writeFile(t, filepath.Join(library, "steamapps", "appmanifest_3932890.acf"), `"AppState"
{
	"appid"		"3932890"
	"name"		"Escape from Tarkov"
	"installdir"		"EFT Steam"
}`)
				makeDirs(t, filepath.Join(library, "steamapps", "common", "EFT Steam", "Logs"))
			},
			func(_, library string) string {
				return filepath.Join(library, "steamapps", "common", "EFT Steam", "Logs")
			},
		},
		{
			"a manifest naming a folder that doesn't exist falls back to the usual name",
			func(t *testing.T, steamRoot, _ string) {
				writeFile(t, filepath.Join(steamRoot, "steamapps", "appmanifest_3932890.acf"), `"AppState" { "installdir"		"Gone" }`)
				makeDirs(t, filepath.Join(steamRoot, "steamapps", "common", "Escape from Tarkov", "Logs"))
			},
			func(steamRoot, _ string) string {
				return filepath.Join(steamRoot, "steamapps", "common", "Escape from Tarkov", "Logs")
			},
		},
		{
			"another game's manifest isn't read",
			func(t *testing.T, steamRoot, _ string) {
				writeFile(t, filepath.Join(steamRoot, "steamapps", "appmanifest_730.acf"), `"AppState" { "installdir"		"Other" }`)
				makeDirs(t, filepath.Join(steamRoot, "steamapps", "common", "Other", "Logs"))
			},
			func(string, string) string { return "" },
		},
		{
			"no game anywhere",
			func(*testing.T, string, string) {},
			func(string, string) string { return "" },
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			root := t.TempDir()
			steamRoot, library := filepath.Join(root, "Steam"), filepath.Join(root, "SteamLibrary")
			makeDirs(t, steamRoot, library)
			testCase.setUp(t, steamRoot, library)
			if got, want := logsInSteam(steamRoot), testCase.wantDir(steamRoot, library); got != want {
				t.Errorf("got %q, want %q", got, want)
			}
		})
	}
}

func TestTheEnvironmentOverridesTheFoundFolders(t *testing.T) {
	logs, shots := t.TempDir(), t.TempDir()
	t.Setenv("STM_LOGS_DIR", logs)
	t.Setenv("STM_SCREENSHOTS_DIR", shots)
	if got := LogsDir(); got != logs {
		t.Errorf("LogsDir = %q, want %q", got, logs)
	}
	if got := ScreenshotsDir(); got != shots {
		t.Errorf("ScreenshotsDir = %q, want %q", got, shots)
	}
}

func TestTheScreenshotsFolderIsInDocuments(t *testing.T) {
	t.Setenv("STM_SCREENSHOTS_DIR", "")
	documents := DocumentsDir()
	if documents == "" {
		t.Skip("no Documents folder on this machine")
	}
	if got, want := ScreenshotsDir(), filepath.Join(documents, "Escape From Tarkov", "Screenshots"); got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestOnlyAnExistingFolderCountsAsAFolder(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "file.txt")
	writeFile(t, file, "x")
	cases := []struct {
		name string
		path string
		want bool
	}{
		{"a folder", dir, true},
		{"a file", file, false},
		{"nothing there", filepath.Join(dir, "missing"), false},
		{"an empty path", "", false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := IsDir(testCase.path); got != testCase.want {
				t.Errorf("got %v, want %v", got, testCase.want)
			}
		})
	}
}
