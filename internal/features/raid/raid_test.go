package raid

import (
	"errors"
	"testing"
)

func text(s string) *string { return &s }

func TestTaskEventsCountOnlyInTheChosenGameMode(t *testing.T) {
	cases := []struct {
		name                     string
		sessionMode, settingMode string
		want                     bool
	}{
		{"same mode", "pvp-season", "pvp-season", true},
		{"PvE events don't touch the PvP Season list", "pve", "pvp-season", false},
		{"unknown session mode (app started after the game): counts, as in v2", "", "regular", true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := ModeMatches(testCase.sessionMode, testCase.settingMode); got != testCase.want {
				t.Errorf("got %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestARaidTakesTheLoadingMapAndEndsBackInTheMenus(t *testing.T) {
	var tracker Tracker
	if tracker.ShouldEndOnMenuReturn() {
		t.Fatal("the profile line right after the game starts must not end a raid")
	}
	tracker.MapLoading(text("customs"))
	tracker.MapLoaded(text("woods")) // the scene path already named the map
	if got := tracker.Start(); got == nil || *got != "customs" {
		t.Fatalf("raid map = %v, want customs", got)
	}
	if !tracker.ShouldEndOnMenuReturn() {
		t.Fatal("back in the menus after a raid should end it")
	}
	mapKey, _ := tracker.End(func(string) bool { return true }, func(string) error { return nil })
	if mapKey == nil || *mapKey != "customs" || tracker.Status().Active {
		t.Errorf("after End: map=%v status=%+v", mapKey, tracker.Status())
	}
}

func TestCancelledMatchmakingForgetsTheLoadingMap(t *testing.T) {
	var tracker Tracker
	tracker.MapLoading(text("lighthouse"))
	tracker.MatchingAborted()
	if tracker.Status().Map != nil {
		t.Errorf("map = %v, want none", *tracker.Status().Map)
	}
}

func TestRaidEndDeletesOnlyThatRaidsGPSShots(t *testing.T) {
	var tracker Tracker
	tracker.Start()
	tracker.NoteGPSShot("2026-10-01[14-05]_1.00, 2.00, 3.00_0.0, 0.0, 0.0, 1.0 (0).png")
	tracker.NoteGPSShot("2026-10-01[14-05]_1.00, 2.00, 3.00_0.0, 0.0, 0.0, 1.0 (0).png") // seen twice
	tracker.NoteGPSShot("not-a-gps-name.png")
	var deletedNames []string
	isGPS := func(name string) bool { return name != "not-a-gps-name.png" }
	_, deleted := tracker.End(isGPS, func(name string) error { deletedNames = append(deletedNames, name); return nil })
	if deleted != 1 || len(deletedNames) != 1 {
		t.Errorf("deleted %v (%d), want only the one GPS shot", deletedNames, deleted)
	}
	// The next raid starts with an empty list.
	_, deleted = tracker.End(isGPS, func(string) error { return errors.New("must not be called") })
	if deleted != 0 {
		t.Errorf("a second End deleted %d files", deleted)
	}
}
