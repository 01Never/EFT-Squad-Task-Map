package storage

// CurrentSettingsVersion is the settings-file format this copy writes ("settingsVersion").
// A file without the field is version 1 (every file up to 2.8.1).
// To add a step: raise this number, write a function `settingsFrom<N>To<N+1>`, and append it to
// settingsMigrations. Nothing else needs to change.
const CurrentSettingsVersion = 2

// settingsMigration is one step. It is a pure function: it gets the settings and returns the
// changed settings plus one plain sentence per change (printed on the console).
type settingsMigration func(Settings) (Settings, []string)

// settingsMigrations[i] moves a file from version i+1 to version i+2.
var settingsMigrations = []settingsMigration{
	settingsFrom1To2,
}

// MigrateSettings runs the steps from the settings' own version up to the current one and
// returns the result with what changed. A newer version than this copy knows is returned as is.
// The version number is raised even when no field changed.
func MigrateSettings(settings Settings) (Settings, []string) {
	if settings.SettingsVersion < 1 {
		settings.SettingsVersion = 1
	}
	var changes []string
	for settings.SettingsVersion < CurrentSettingsVersion {
		step := settingsMigrations[settings.SettingsVersion-1]
		var stepChanges []string
		settings, stepChanges = step(settings)
		changes = append(changes, stepChanges...)
		settings.SettingsVersion++
	}
	return settings, changes
}

// settingsFrom1To2: the default AI model became gpt-6-luna. Saving a key used to write the old
// default (gpt-5.4-mini) into the file, so a file with that model and no chosen effort is moved.
// A different model, or gpt-5.4-mini with an effort, was a deliberate choice and stays.
func settingsFrom1To2(settings Settings) (Settings, []string) {
	if settings.OpenAIModel != "gpt-5.4-mini" || settings.OpenAIEffort != "" {
		return settings, nil
	}
	settings.OpenAIModel = "gpt-6-luna"
	return settings, []string{"AI model gpt-5.4-mini → gpt-6-luna (the new default)"}
}
