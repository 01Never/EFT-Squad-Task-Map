package raid

// The raid rules, as plain functions. raid.go keeps the state and calls these.

// ModeMatches decides whether a task event from the log counts: only when the game's session mode
// is the mode the user picked in Settings. While the session mode is unknown (the app started after
// the game wrote it), events count. That gap is one suspect for the "phantom tasks" squadmates
// reported (HANDOFF §11); it's kept as v2 had it, pending the owner's decision.
func ModeMatches(sessionMode, settingMode string) bool {
	return sessionMode == "" || sessionMode == settingMode
}

// EndsOnMenuReturn decides what "back in the menus" means (a profile-select line, or the server's
// UserMatchOver): a raid end, but only if a raid was active or GPS shots were taken. The same
// profile line also appears right after the game starts, before any raid.
func EndsOnMenuReturn(isRaidActive bool, gpsShotsTaken int) bool {
	return isRaidActive || gpsShotsTaken > 0
}
