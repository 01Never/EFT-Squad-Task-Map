package app

import (
	"testing"

	"squadtaskmap/internal/features/gamelog"
)

// Issue #21, first acceptance check, spelled out: the game is stuck in "raid" in the menus, so a
// scan shot has a position in its name. The profile-select line that follows must not end a raid
// (no raidEnd event waits for the page, so no "Raid over" toast) and the file stays.
func TestAProfileLineAfterACapturedPositionShotQueuesNoRaidEnd(t *testing.T) {
	rig := newScreenshotRig(t)
	rig.startCapture()

	rig.takeShot(positionShotName)
	rig.logEvent(gamelog.KindProfileSelected)

	for _, event := range queuedEvents(t, rig.app.files) {
		if event["type"] == "raidEnd" {
			t.Errorf("a raidEnd was queued after the profile line: %v", event)
		}
	}
	if !rig.fileExists(positionShotName) {
		t.Error("the captured shot must still exist")
	}
}

// Control for the test above: without a scan the same shot is a GPS shot, so the profile line
// does end a "raid" (EndsOnMenuReturn) and deletes it, as in 2.8.1.
func TestAProfileLineAfterAnUncapturedPositionShotEndsTheRaid(t *testing.T) {
	rig := newScreenshotRig(t)

	rig.takeShot(positionShotName)
	rig.logEvent(gamelog.KindProfileSelected)

	raidEnds := 0
	for _, event := range queuedEvents(t, rig.app.files) {
		if event["type"] == "raidEnd" {
			raidEnds++
		}
	}
	if raidEnds != 1 {
		t.Errorf("queued %d raidEnd events, want 1", raidEnds)
	}
	if rig.fileExists(positionShotName) {
		t.Error("the GPS shot should be deleted at that raid end")
	}
}
