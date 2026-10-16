package storage

// CurrentSettingsVersion is the settings-file format this copy writes ("settingsVersion").
// A file without the field is version 1 (every file up to 2.8.1).
// To add a step: raise this number, write a function `settingsFrom<N>To<N+1>`, and append it to
// settingsMigrations. Nothing else needs to change.
const CurrentSettingsVersion = 3

// settingsMigration is one step. It is a pure function: it gets the settings and returns the
// changed settings plus one plain sentence per change (printed on the console).
type settingsMigration func(Settings) (Settings, []string)

// settingsMigrations[i] moves a file from version i+1 to version i+2.
var settingsMigrations = []settingsMigration{
	settingsFrom1To2,
	settingsFrom2To3,
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

// settingsFrom2To3 (ticket 17): "Share my tasks" and the new "Share my position" are on by
// default. Up to 2.8.x "Share my tasks" was written only when on, so a file can't tell "switched
// off on purpose" from "never switched on": as the issue says, both are turned on once (the
// release notes say so). From now on both are always written, so an "off" sticks.
// A file without a squad block needs nothing: a missing field already means on.
// Unknown fields inside "squad" are kept.
func settingsFrom2To3(settings Settings) (Settings, []string) {
	if settings.Squad == nil {
		return settings, nil
	}
	block := *settings.Squad
	shareTasks, sharePosition := true, true
	block.ShareTasks, block.SharePosition = &shareTasks, &sharePosition
	settings.Squad = &block
	return settings, []string{`squad "Share my tasks" and "Share my position" are on ` +
		`(new default; switch them off in Settings → Squad)`}
}
