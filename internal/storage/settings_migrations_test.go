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
		{"an old default model moves to the new default", Settings{OpenAIModel: "gpt-5.4-mini"}, "gpt-6-luna", "", 2, true},
		{"a file with an explicit version 1 moves too", Settings{SettingsVersion: 1, OpenAIModel: "gpt-5.4-mini"}, "gpt-6-luna", "", 2, true},
		{"a custom model stays", Settings{OpenAIModel: "gpt-5.5"}, "gpt-5.5", "", 2, false},
		{"gpt-5.4-mini with an effort stays", Settings{OpenAIModel: "gpt-5.4-mini", OpenAIEffort: "low"}, "gpt-5.4-mini", "low", 2, false},
		{"no model stays empty", Settings{}, "", "", 2, false},
		{"a file at the current version is untouched", Settings{SettingsVersion: 2, OpenAIModel: "gpt-5.4-mini"}, "gpt-5.4-mini", "", 2, false},
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
	if settings.OpenAIModel != "gpt-6-luna" || settings.SettingsVersion != 2 {
		t.Fatalf("not migrated: %+v", settings)
	}
	saved, _ := os.ReadFile(path)
	text := string(saved)
	for _, want := range []string{`"gpt-6-luna"`, `"settingsVersion": 2`, `"futureField"`} {
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
	if data, _ := os.ReadFile(path); !strings.Contains(string(data), `"settingsVersion": 2`) {
		t.Errorf("written file has no version:\n%s", data)
	}
}
