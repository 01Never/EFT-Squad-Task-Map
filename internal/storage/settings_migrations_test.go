package storage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMigrateSettings(t *testing.T) {
	tests := []struct {
		name        string
		in          Settings
		wantModel   string
		wantEffort  string
		wantVersion int
		wantChanged bool
	}{
		{"an old default model moves to the new default", Settings{OpenAIModel: "gpt-5.4-mini"}, "gpt-6-luna", "", 3, true},
		{"a file with an explicit version 1 moves too", Settings{SettingsVersion: 1, OpenAIModel: "gpt-5.4-mini"}, "gpt-6-luna", "", 3, true},
		{"a custom model stays", Settings{OpenAIModel: "gpt-5.5"}, "gpt-5.5", "", 3, false},
		{"gpt-5.4-mini with an effort stays", Settings{OpenAIModel: "gpt-5.4-mini", OpenAIEffort: "low"}, "gpt-5.4-mini", "low", 3, false},
		{"no model stays empty", Settings{}, "", "", 3, false},
		{"a file already at version 2 skips the model step", Settings{SettingsVersion: 2, OpenAIModel: "gpt-5.4-mini"}, "gpt-5.4-mini", "", 3, false},
		{"a file at the current version is untouched", Settings{SettingsVersion: 3, OpenAIModel: "gpt-5.4-mini"}, "gpt-5.4-mini", "", 3, false},
		{"a newer version is untouched and keeps its number", Settings{SettingsVersion: 9, OpenAIModel: "gpt-5.4-mini"}, "gpt-5.4-mini", "", 9, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, changes := MigrateSettings(test.in)
			if got.OpenAIModel != test.wantModel || got.OpenAIEffort != test.wantEffort || got.SettingsVersion != test.wantVersion {
				t.Errorf("got model %q effort %q version %d", got.OpenAIModel, got.OpenAIEffort, got.SettingsVersion)
			}
			if (len(changes) > 0) != test.wantChanged {
				t.Errorf("changes = %v, want changed=%v", changes, test.wantChanged)
			}
		})
	}
}

func TestReadSettingsMigratesOnceAndWritesBack(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	old := `{"openaiKey":"sk-x","openaiModel":"gpt-5.4-mini","futureField":{"a":1}}`
	if err := os.WriteFile(path, []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	settings := ReadSettings(path)
	if settings.OpenAIModel != "gpt-6-luna" || settings.SettingsVersion != 3 {
		t.Fatalf("not migrated: %+v", settings)
	}
	saved, _ := os.ReadFile(path)
	text := string(saved)
	for _, want := range []string{`"gpt-6-luna"`, `"settingsVersion": 3`, `"futureField"`} {
		if !strings.Contains(text, want) {
			t.Errorf("saved file lacks %s:\n%s", want, text)
		}
	}
}

func TestReadSettingsLeavesANewerFileAlone(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	old := `{"settingsVersion":7,"openaiModel":"gpt-5.4-mini"}`
	_ = os.WriteFile(path, []byte(old), 0o600)
	settings := ReadSettings(path)
	if settings.OpenAIModel != "gpt-5.4-mini" || settings.SettingsVersion != 7 {
		t.Errorf("changed a newer file: %+v", settings)
	}
	if saved, _ := os.ReadFile(path); string(saved) != old {
		t.Errorf("file was rewritten: %s", saved)
	}
}

func TestAFreshSettingsFileStartsAtTheCurrentVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	fresh := ReadSettings(path)
	if fresh.SettingsVersion != CurrentSettingsVersion {
		t.Errorf("fresh version = %d", fresh.SettingsVersion)
	}
	fresh.OpenAIModel = "gpt-5.4-mini" // chosen on purpose; an old migration must not touch it
	if err := WriteSettings(path, fresh); err != nil {
		t.Fatal(err)
	}
	again := ReadSettings(path)
	if again.OpenAIModel != "gpt-5.4-mini" || again.SettingsVersion != CurrentSettingsVersion {
		t.Errorf("fresh file was migrated: %+v", again)
	}
}

func TestSettingsWrittenFromScratchCarryTheCurrentVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.json")
	_ = WriteSettings(path, Settings{GameMode: "pve"})
	if data, _ := os.ReadFile(path); !strings.Contains(string(data), `"settingsVersion": 3`) {
		t.Errorf("written file has no version:\n%s", data)
	}
}

func TestEveryVersionHasItsMigrationStep(t *testing.T) {
	// Raising CurrentSettingsVersion without appending a step would panic at start-up.
	if len(settingsMigrations) != CurrentSettingsVersion-1 {
		t.Errorf("%d migration steps for version %d; want %d (one per version after 1)",
			len(settingsMigrations), CurrentSettingsVersion, CurrentSettingsVersion-1)
	}
}

func TestTheSharingSwitchesAreTurnedOnOnceFromVersion2(t *testing.T) {
	on, off := true, false
	const id = "0123456789abcdef"
	cases := []struct {
		name           string
		in             Settings
		wantTasksOn    bool
		wantPositionOn bool
		wantChangeLine bool
		wantSquadBlock bool
	}{
		{"a squad block that never switched tasks on gets both on",
			Settings{SettingsVersion: 2, Squad: &SquadSettings{PlayerID: id}}, true, true, true, true},
		{"a squad block sharing tasks gets the position on too",
			Settings{SettingsVersion: 2, Squad: &SquadSettings{PlayerID: id, ShareTasks: &on}}, true, true, true, true},
		{"an old file can't say 'off on purpose', so tasks are turned on once",
			Settings{SettingsVersion: 2, Squad: &SquadSettings{PlayerID: id, ShareTasks: &off}}, true, true, true, true},
		{"a version 1 file with a squad block gets both on too",
			Settings{Squad: &SquadSettings{PlayerID: id}}, true, true, true, true},
		{"without a squad block nothing changes (missing means on)",
			Settings{SettingsVersion: 2}, true, true, false, false},
		{"a version 3 file keeps the player's off",
			Settings{SettingsVersion: 3, Squad: &SquadSettings{PlayerID: id, ShareTasks: &off, SharePosition: &off}},
			false, false, false, true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			got, changes := MigrateSettings(test.in)
			squad := got.SquadOrEmpty()
			if squad.IsShareTasksOn() != test.wantTasksOn || squad.IsSharePositionOn() != test.wantPositionOn {
				t.Errorf("tasks %v position %v, want %v %v",
					squad.IsShareTasksOn(), squad.IsSharePositionOn(), test.wantTasksOn, test.wantPositionOn)
			}
			if (len(changes) > 0) != test.wantChangeLine {
				t.Errorf("changes = %v, want a console line: %v", changes, test.wantChangeLine)
			}
			if (got.Squad != nil) != test.wantSquadBlock {
				t.Errorf("squad block present = %v, want %v", got.Squad != nil, test.wantSquadBlock)
			}
			if got.SettingsVersion != CurrentSettingsVersion {
				t.Errorf("version %d, want %d", got.SettingsVersion, CurrentSettingsVersion)
			}
		})
	}
}

func TestTheVersion2StepWritesBothSwitchesAndKeepsUnknownSquadFields(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	old := `{"settingsVersion":2,"squad":{"playerId":"0123456789abcdef","name":"Mike","joined":true,` +
		`"futureSquadSetting":{"a":1}}}`
	if err := os.WriteFile(path, []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	ReadSettings(path)
	saved, _ := os.ReadFile(path)
	text := string(saved)
	wanted := []string{`"shareTasks": true`, `"sharePosition": true`, `"futureSquadSetting"`,
		`"joined": true`, `"name": "Mike"`, `"settingsVersion": 3`}
	for _, want := range wanted {
		if !strings.Contains(text, want) {
			t.Errorf("saved file lacks %s:\n%s", want, text)
		}
	}
}

func TestTheVersion2StepDoesntChangeTheSettingsItWasGiven(t *testing.T) {
	original := Settings{SettingsVersion: 2, Squad: &SquadSettings{PlayerID: "0123456789abcdef"}}
	MigrateSettings(original)
	if original.Squad.ShareTasks != nil || original.Squad.SharePosition != nil {
		t.Errorf("the input's squad block was changed: %+v", *original.Squad)
	}
}
