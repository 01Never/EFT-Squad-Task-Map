package raid

// The raid rules, as plain functions. raid.go keeps the state and calls these.

// TaskEventMode decides which game mode's task list a task event from the log (or a raid end)
// belongs to. Each mode is a separate character with its own tasks, so no event is dropped for its
// mode any more: it goes to the game's latest session mode. While the session mode is unknown
// (the app started after the game wrote it), it goes to the mode chosen in Settings. That gap is
// one suspect for the "phantom tasks" squadmates reported (HANDOFF §11).
func TaskEventMode(sessionMode, settingMode string) string {
	if sessionMode == "" {
		return settingMode
	}
	return sessionMode
}

// EndsOnMenuReturn decides what "back in the menus" means (a profile-select line, or the server's
// UserMatchOver): a raid end, but only if a raid was active or GPS shots were taken. The same
// profile line also appears right after the game starts, before any raid.
func EndsOnMenuReturn(isRaidActive bool, gpsShotsTaken int) bool {
	return isRaidActive || gpsShotsTaken > 0
}
