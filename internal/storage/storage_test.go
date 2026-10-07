package storage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func readText(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func writeText(t *testing.T, path, text string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestAnAtomicWriteReplacesTheWholeFileAndLeavesNoTempFile(t *testing.T) {
	cases := []struct {
		name     string
		previous *string // nil: no file yet
		write    string
	}{
		{"a new file", nil, `{"a":1}`},
		{"a longer file replaces a shorter one", ptr(`{}`), `{"tasks":[1,2,3]}`},
		{"a shorter file leaves nothing of the longer one behind", ptr(`{"tasks":[1,2,3,4,5,6]}`), `{}`},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "file.json")
			if testCase.previous != nil {
				writeText(t, path, *testCase.previous)
			}
			if err := WriteFileAtomic(path, []byte(testCase.write)); err != nil {
				t.Fatal(err)
			}
			if got := readText(t, path); got != testCase.write {
				t.Errorf("file = %q, want %q", got, testCase.write)
			}
			if FileExists(path + ".tmp") {
				t.Error("the .tmp file was left behind")
			}
		})
	}
}

func TestAFailedAtomicWriteLeavesTheOldFileUntouched(t *testing.T) {
	path := filepath.Join(t.TempDir(), "file.json")
	writeText(t, path, `{"old":true}`)
	// A folder where the temporary file should go makes the first step fail.
	if err := os.Mkdir(path+".tmp", 0o755); err != nil {
		t.Fatal(err)
	}
	if err := WriteFileAtomic(path, []byte(`{"new":true}`)); err == nil {
		t.Fatal("the write should have failed")
	}
	if got := readText(t, path); got != `{"old":true}` {
		t.Errorf("file = %q, want the old content", got)
	}
}

func TestSavingThePagesDataRefusesAnythingButJSONAndKeepsABackup(t *testing.T) {
	cases := []struct {
		name       string
		previous   *string
		write      string
		wantErr    bool
		wantFile   string
		wantBackup *string // nil: no .bak
	}{
		{"the first save makes no backup", nil, `{"version":2}`, false, `{"version":2}`, nil},
		{"a later save keeps the previous file as .bak", ptr(`{"version":2,"n":1}`), `{"version":2,"n":2}`, false, `{"version":2,"n":2}`, ptr(`{"version":2,"n":1}`)},
		{"broken JSON is refused and the data stays", ptr(`{"version":2}`), `{"version":`, true, `{"version":2}`, nil},
		{"an empty body is refused", ptr(`{"version":2}`), ``, true, `{"version":2}`, nil},
		{"null is JSON, so it's saved (as v2 did)", ptr(`{"version":2}`), `null`, false, `null`, ptr(`{"version":2}`)},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "squad-task-map-data.json")
			if testCase.previous != nil {
				writeText(t, path, *testCase.previous)
			}
			err := WriteStateText(path, []byte(testCase.write))
			if (err != nil) != testCase.wantErr {
				t.Fatalf("err = %v, want error: %v", err, testCase.wantErr)
			}
			if got := readText(t, path); got != testCase.wantFile {
				t.Errorf("file = %q, want %q", got, testCase.wantFile)
			}
			switch {
			case testCase.wantBackup == nil && FileExists(path+".bak"):
				t.Errorf("unexpected .bak: %q", readText(t, path+".bak"))
			case testCase.wantBackup != nil:
				if got := readText(t, path+".bak"); got != *testCase.wantBackup {
					t.Errorf(".bak = %q, want %q", got, *testCase.wantBackup)
				}
			}
		})
	}
}

func TestReadingThePagesDataGivesNullWhenThereIsNone(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "squad-task-map-data.json")
	if got := ReadStateText(path); got != "null" {
		t.Errorf("no file: got %q, want null", got)
	}
	writeText(t, path, `{"version":2}`)
	if got := ReadStateText(path); got != `{"version":2}` {
		t.Errorf("got %q, want the file as it is", got)
	}
}

func TestTheV1DataIsCopiedOnceBeforeTheMigration(t *testing.T) {
	cases := []struct {
		name       string
		saved      *string // nil: no data file
		backup     *string // an existing backup
		wantBackup *string // nil: no backup afterwards
	}{
		{"v1 data (no version) is copied", ptr(`{"tasks":[]}`), nil, ptr(`{"tasks":[]}`)},
		{"version 1 is copied", ptr(`{"version":1}`), nil, ptr(`{"version":1}`)},
		{"version 2 is never copied", ptr(`{"version":2}`), nil, nil},
		{"null (nothing saved yet) is never copied", ptr(`null`), nil, nil},
		{"broken JSON is never copied", ptr(`{"tasks":`), nil, nil},
		{"no data file, no backup", nil, nil, nil},
		{"an existing backup is never overwritten", ptr(`{"version":1,"newer":true}`), ptr(`{"version":1}`), ptr(`{"version":1}`)},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			files := FilesIn(t.TempDir())
			if testCase.saved != nil {
				writeText(t, files.State, *testCase.saved)
			}
			if testCase.backup != nil {
				writeText(t, files.V1Backup, *testCase.backup)
			}
			BackupV1IfNeeded(files)
			if testCase.wantBackup == nil {
				if FileExists(files.V1Backup) {
					t.Errorf("unexpected backup: %q", readText(t, files.V1Backup))
				}
				return
			}
			if got := readText(t, files.V1Backup); got != *testCase.wantBackup {
				t.Errorf("backup = %q, want %q", got, *testCase.wantBackup)
			}
		})
	}
}

func TestTheV1BackupIsMadeOnlyOnce(t *testing.T) {
	files := FilesIn(t.TempDir())
	writeText(t, files.State, `{"tasks":["first"]}`)
	BackupV1IfNeeded(files)
	writeText(t, files.State, `{"tasks":["second"]}`)
	BackupV1IfNeeded(files)
	if got := readText(t, files.V1Backup); got != `{"tasks":["first"]}` {
		t.Errorf("backup = %q, want the first copy", got)
	}
}

func TestSettingsKeepUnknownFieldsThroughASave(t *testing.T) {
	path := filepath.Join(t.TempDir(), "squad-task-map-settings.json")
	writeText(t, path, `{"gameMode":"pve","futureSetting":{"a":[1,2]},"zoom":3}`)
	settings := ReadSettings(path)
	if settings.GameMode != "pve" {
		t.Fatalf("gameMode = %q, want pve", settings.GameMode)
	}
	settings.LogsPath = `D:\Games\EFT\Logs`
	if err := WriteSettings(path, settings); err != nil {
		t.Fatal(err)
	}
	var saved map[string]any
	if err := json.Unmarshal([]byte(readText(t, path)), &saved); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"gameMode": "pve", "logsPath": `D:\Games\EFT\Logs`, "futureSetting": map[string]any{"a": []any{1.0, 2.0}}, "zoom": 3.0}
	if gotJSON, wantJSON := mustJSON(saved), mustJSON(want); gotJSON != wantJSON {
		t.Errorf("saved %s, want %s", gotJSON, wantJSON)
	}
}

func TestTheSquadBlockKeepsUnknownFieldsThroughASave(t *testing.T) {
	path := filepath.Join(t.TempDir(), "squad-task-map-settings.json")
	writeText(t, path, `{"gameMode":"pve","squad":{"playerId":"0123456789abcdef","name":"Mike","futureSquadSetting":7}}`)
	settings := ReadSettings(path)
	squad := settings.SquadOrEmpty()
	if squad.PlayerID != "0123456789abcdef" || squad.Name != "Mike" || squad.ShareTasks || squad.Joined {
		t.Fatalf("read %+v", squad)
	}
	squad.Joined = true
	settings.Squad = &squad
	if err := WriteSettings(path, settings); err != nil {
		t.Fatal(err)
	}
	var saved map[string]any
	if err := json.Unmarshal([]byte(readText(t, path)), &saved); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"gameMode": "pve", "squad": map[string]any{
		"playerId": "0123456789abcdef", "name": "Mike", "joined": true, "futureSquadSetting": 7.0,
	}}
	if gotJSON, wantJSON := mustJSON(saved), mustJSON(want); gotJSON != wantJSON {
		t.Errorf("saved %s, want %s", gotJSON, wantJSON)
	}
}

func TestSettingsWithoutASquadBlockReadAsNotInASquad(t *testing.T) {
	path := filepath.Join(t.TempDir(), "squad-task-map-settings.json")
	writeText(t, path, `{"gameMode":"pve"}`)
	squad := ReadSettings(path).SquadOrEmpty()
	if squad.Joined || squad.ShareTasks || squad.PlayerID != "" {
		t.Errorf("read %+v, want the empty defaults", squad)
	}
}

func TestTarkovTrackerFieldsAreDroppedAndTheFileRewritten(t *testing.T) {
	cases := []struct {
		name        string
		file        string
		wantFields  []string
		wantRewrite bool
	}{
		{"tt… fields are dropped, the rest stays", `{"ttToken":"abc","ttTeam":"x","gameMode":"pve","other":1}`, []string{"gameMode", "other"}, true},
		{"without tt… fields the file isn't touched", `{"gameMode":"pve","other":1}`, []string{"gameMode", "other"}, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "squad-task-map-settings.json")
			writeText(t, path, testCase.file)
			settings := ReadSettings(path)
			var inMemory map[string]any
			json.Unmarshal([]byte(mustJSON(settings)), &inMemory)
			if got := sortedKeys(inMemory); strings.Join(got, ",") != strings.Join(testCase.wantFields, ",") {
				t.Errorf("settings fields = %v, want %v", got, testCase.wantFields)
			}
			onDisk := readText(t, path)
			if rewritten := onDisk != testCase.file; rewritten != testCase.wantRewrite {
				t.Errorf("rewritten = %v, want %v (file: %s)", rewritten, testCase.wantRewrite, onDisk)
			}
			if strings.Contains(onDisk, `"tt`) {
				t.Errorf("a tt… field is still in the file: %s", onDisk)
			}
		})
	}
}

func TestAMissingOrBrokenSettingsFileGivesEmptySettings(t *testing.T) {
	dir := t.TempDir()
	broken := filepath.Join(dir, "broken.json")
	writeText(t, broken, `{"gameMode":`)
	for name, path := range map[string]string{"missing": filepath.Join(dir, "none.json"), "broken": broken} {
		t.Run(name, func(t *testing.T) {
			settings := ReadSettings(path)
			if got := mustJSON(settings); got != "{}" {
				t.Errorf("got %s, want {}", got)
			}
			if settings.GameModeOrDefault() != "regular" {
				t.Errorf("game mode = %q, want regular", settings.GameModeOrDefault())
			}
		})
	}
}

func TestFollowPositionIsOnAndAutoCenterOffUntilTheUserChangesThem(t *testing.T) {
	yes, no := true, false
	cases := []struct {
		name                   string
		follow, center         *bool
		wantFollow, wantCenter bool
	}{
		{"never set", nil, nil, true, false},
		{"turned the other way", &no, &yes, false, true},
		{"set to the defaults", &yes, &no, true, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			settings := Settings{FollowPosition: testCase.follow, AutoCenter: testCase.center}
			if got := settings.IsFollowPositionOn(); got != testCase.wantFollow {
				t.Errorf("follow position = %v, want %v", got, testCase.wantFollow)
			}
			if got := settings.IsAutoCenterOn(); got != testCase.wantCenter {
				t.Errorf("auto-center = %v, want %v", got, testCase.wantCenter)
			}
		})
	}
}

func TestTheKeyIsShownOnlyByItsFirstAndLastFourCharacters(t *testing.T) {
	cases := []struct {
		name string
		key  string
		want *string
	}{
		{"a normal key", "sk-proj-abcdefghijklmnop1234", ptr("sk-p…1234")},
		{"no key is null", "", nil},
		{"a short key shows what there is (as v2's slice did)", "abc", ptr("abc…abc")},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := MaskKey(testCase.key)
			switch {
			case testCase.want == nil && got != nil:
				t.Errorf("got %q, want nil", *got)
			case testCase.want != nil && (got == nil || *got != *testCase.want):
				t.Errorf("got %v, want %q", got, *testCase.want)
			}
		})
	}
}

func TestOnlyAGoBuildFolderCountsAsGoRun(t *testing.T) {
	cases := []struct {
		name string
		exe  string
		want bool
	}{
		{"go run's temporary exe", `C:\Users\me\AppData\Local\Temp\go-build1234\b001\exe\main.exe`, true},
		{"an exe kept in a Temp folder keeps its data next to itself", `C:\Users\me\AppData\Local\Temp\SquadTaskMap.exe`, false},
		{"an exe on the desktop", `C:\Users\me\Desktop\SquadTaskMap.exe`, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := isTemporaryGoBuild(testCase.exe); got != testCase.want {
				t.Errorf("got %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestSTMDataDirOverridesTheDataFolder(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("STM_DATA_DIR", dir)
	if got := DataDir(); got != dir {
		t.Errorf("got %q, want %q", got, dir)
	}
	if got := FilesIn(dir).GameDataCache("pve"); got != filepath.Join(dir, "squad-task-map-gamedata-pve.json") {
		t.Errorf("game data cache = %q", got)
	}
}

// ---------------------------------------------------------------- helpers

func ptr(s string) *string { return &s }

func mustJSON(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(data)
}

func sortedKeys(object map[string]any) []string {
	var keys []string
	for key := range object {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
