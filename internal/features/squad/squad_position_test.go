package squad

// Ticket 17 through the Squad: my position is set from a GPS screenshot (only while in a squad),
// shared only while "Share my position" is on, cleared at raid end, on a raid on another map, on
// Leave and by a restart, and reaches friends over the dev transport.

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
)

// mikeInASquad shares everything and is in a squad (no session runs: none is needed to stamp).
var mikeInASquad = Settings{PlayerID: mike.ID, Name: "Mike", Color: "#4dabf7", ShareTasks: true, SharePosition: true, Joined: true}

// sharedNow is the share friends would get now (ok = false when there is none yet).
func (copy *testCopy) sharedNow() (Share, bool) {
	copy.t.Helper()
	encoded := copy.squad.feed.current()
	if encoded == nil {
		return Share{}, false
	}
	var share Share
	if err := json.Unmarshal(encoded, &share); err != nil {
		copy.t.Fatal(err)
	}
	return share, true
}

// expectShared checks the rev friends would get and whether it carries a position.
func (copy *testCopy) expectShared(step string, wantRev int64, wantPosition bool) {
	copy.t.Helper()
	share, _ := copy.sharedNow()
	if share.Rev != wantRev || (share.Pos != nil) != wantPosition {
		copy.t.Errorf("%s: friends get rev %d with a position %v; want rev %d, position %v",
			step, share.Rev, share.Pos != nil, wantRev, wantPosition)
	}
	if view := copy.squad.View(); view.Me.Rev != share.Rev {
		copy.t.Errorf("%s: the page's view says rev %d, friends get %d", step, view.Me.Rev, share.Rev)
	}
}

func TestMyPositionIsKeptOnlyWhileInASquad(t *testing.T) {
	cases := []struct {
		name         string
		isInSquad    bool
		wantRev      int64
		wantPosition bool
	}{
		{"in a squad, a new position goes into my share", true, 2, true},
		{"not in a squad, nothing happens", false, 1, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			settings := mikeInASquad
			settings.Joined = tc.isInSquad
			copy := newTestCopy(t, t.TempDir(), "", nil, settings)
			copy.squad.SetMyShare(drawingAt(1))
			if err := copy.squad.SetMyPosition(atTheGasStation); err != nil {
				t.Fatal(err)
			}
			copy.expectShared("after the screenshot", tc.wantRev, tc.wantPosition)
		})
	}
}

func TestAPositionSharedNowIsTheOneFromTheScreenshot(t *testing.T) {
	copy := newTestCopy(t, t.TempDir(), "", nil, mikeInASquad)
	copy.squad.SetMyShare(drawingAt(1))
	copy.squad.SetMyPosition(atTheGasStation)
	share, _ := copy.sharedNow()
	if share.Pos == nil || *share.Pos != atTheGasStation {
		t.Errorf("friends get %+v, want %+v", share.Pos, atTheGasStation)
	}
	if len(share.Draw["customs"]) != 1 || len(share.Tasks) != 1 {
		t.Errorf("the drawings and tasks didn't stay: %+v", share)
	}
}

func TestSwitchingShareMyPositionStampsTheShareAgainAtOnce(t *testing.T) {
	settings := mikeInASquad
	settings.SharePosition = false
	copy := newTestCopy(t, t.TempDir(), "", nil, settings)
	copy.squad.SetMyShare(drawingAt(1))
	copy.expectShared("the page's share", 1, false)

	copy.squad.SetMyPosition(atTheGasStation)
	copy.expectShared("a screenshot while sharing is off: held, not sent", 1, false)

	profile := Profile{Name: "Mike", Color: "#4dabf7", ShareTasks: true, SharePosition: true}
	if err := copy.squad.SetProfile(profile); err != nil {
		t.Fatal(err)
	}
	copy.expectShared("switched on: the held position is shared at once", 2, true)
	if !copy.squad.View().Settings.SharePosition || !copy.savedSettings().SharePosition {
		t.Error("the view or the saved settings don't say sharePosition: true")
	}

	profile.SharePosition = false
	copy.squad.SetProfile(profile)
	copy.expectShared("switched off: friends drop it at once", 3, false)
	if copy.squad.View().Settings.SharePosition || copy.savedSettings().SharePosition {
		t.Error("the view or the saved settings still say sharePosition: true")
	}
}

func TestMyPositionIsClearedAtRaidEnd(t *testing.T) {
	copy := newTestCopy(t, t.TempDir(), "", nil, mikeInASquad)
	copy.squad.SetMyShare(drawingAt(1))
	copy.squad.SetMyPosition(atTheGasStation)
	copy.expectShared("in the raid", 2, true)

	copy.squad.ClearMyPosition()
	copy.expectShared("the raid ended: rev + 1, no position", 3, false)

	copy.squad.ClearMyPosition()
	copy.expectShared("a second raid end changes nothing", 3, false)
}

func TestARaidEndWithSharingOffChangesNothing(t *testing.T) {
	settings := mikeInASquad
	settings.SharePosition = false
	copy := newTestCopy(t, t.TempDir(), "", nil, settings)
	copy.squad.SetMyShare(drawingAt(1))
	copy.squad.SetMyPosition(atTheGasStation)
	copy.squad.ClearMyPosition()
	copy.expectShared("the position was never sent, so nothing to take back", 1, false)

	copy.squad.SetProfile(Profile{Name: "Mike", Color: "#4dabf7", ShareTasks: true, SharePosition: true})
	copy.expectShared("switched on after the raid: no position to share", 1, false)
}

func TestMyPositionIsClearedWhenARaidOnAnotherMapIsReported(t *testing.T) {
	cases := []struct {
		name         string
		raidMap      string
		wantRev      int64
		wantPosition bool
	}{
		{"a raid on the same map keeps it", "customs", 2, true},
		{"a raid on another map clears it", "woods", 3, false},
		{"a raid on a map the log couldn't name clears it", "", 3, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			copy := newTestCopy(t, t.TempDir(), "", nil, mikeInASquad)
			copy.squad.SetMyShare(drawingAt(1))
			copy.squad.SetMyPosition(atTheGasStation)
			copy.squad.ClearMyPositionIfFromAnotherMap(tc.raidMap)
			copy.expectShared("after the log named the raid's map", tc.wantRev, tc.wantPosition)
		})
	}
}

func TestMyPositionIsNotRememberedAcrossARestart(t *testing.T) {
	dir := t.TempDir()
	first := newTestCopy(t, dir, "", nil, mikeInASquad)
	first.squad.SetMyShare(drawingAt(1))
	first.squad.SetMyPosition(atTheGasStation)
	first.squad.Stop() // the app closing: the cache file is written now
	cacheFile := filepath.Join(dir, "squad-task-map-squad.json")
	if cached, _ := readCache(cacheFile); cached == nil || cached.Pos == nil {
		t.Fatalf("setup: the cache file should hold the share with its position: %+v", cached)
	}

	again := newTestCopy(t, dir, "", nil, mikeInASquad)
	again.expectShared("after a restart: dropped, rev + 1 so friends drop it too", 3, false)
	again.squad.Stop()
	if cached, _ := readCache(cacheFile); cached == nil || cached.Pos != nil || cached.Rev != 3 {
		t.Errorf("the cache file after the restart: %+v", cached)
	}
}

func TestAPositionMakesAShareBeforeThePageSentOne(t *testing.T) {
	cases := []struct {
		name          string
		sharePosition bool
		wantShare     bool
	}{
		{"sharing on: a share with only the position", true, true},
		{"sharing off: still nothing to share", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			settings := mikeInASquad
			settings.SharePosition = tc.sharePosition
			copy := newTestCopy(t, t.TempDir(), "", nil, settings)
			copy.squad.SetMyPosition(atTheGasStation)
			share, hasShare := copy.sharedNow()
			if hasShare != tc.wantShare {
				t.Fatalf("a share for friends: %v, want %v", hasShare, tc.wantShare)
			}
			if tc.wantShare && (share.Rev != 1 || share.Pos == nil || len(share.Draw) != 0 || share.Tasks != nil) {
				t.Errorf("friends get %+v; want rev 1, the position, no drawings, no tasks", share)
			}
		})
	}
}

func TestAPositionFriendsWouldRefuseIsNotShared(t *testing.T) {
	copy := newTestCopy(t, t.TempDir(), "", nil, mikeInASquad)
	copy.squad.SetMyShare(drawingAt(1))
	bad := atTheGasStation
	bad.Map = "__proto__"
	if err := copy.squad.SetMyPosition(bad); err == nil {
		t.Error("a position on map __proto__ was taken; friends would drop my whole share")
	}
	copy.expectShared("after the refused position", 1, false)
}

func TestLeavingForgetsMyPosition(t *testing.T) {
	copy := newTestCopy(t, t.TempDir(), "", nil, mikeInASquad)
	copy.squad.SetMyShare(drawingAt(1))
	copy.squad.SetMyPosition(atTheGasStation)
	copy.squad.Leave(context.Background())
	share, _ := copy.sharedNow()
	if share.Pos != nil {
		t.Errorf("my share kept the position after Leave: %+v", share.Pos)
	}
}

func TestAPositionReachesAFriendAndIsGoneAfterTheRaid(t *testing.T) {
	addresses := freeAddresses(t, 2)
	alice := newTestCopy(t, t.TempDir(), addresses[0], addresses,
		Settings{PlayerID: mike.ID, Name: "Alice", Color: "#e03131", ShareTasks: true, SharePosition: true})
	bob := newTestCopy(t, t.TempDir(), addresses[1], addresses,
		Settings{PlayerID: sam.ID, Name: "Bob", Color: "#ff922b", ShareTasks: true, SharePosition: true})
	alice.join()
	bob.join()
	alice.squad.SetMyShare(drawingAt(1))

	alice.squad.SetMyPosition(atTheGasStation)
	eventually(t, "Bob sees Alice's position", func() bool {
		friend, known := bob.friend(mike.ID)
		return known && friend.Share.Pos != nil && *friend.Share.Pos == atTheGasStation
	})

	moved := atTheGasStation
	moved.X, moved.T = 120.5, atTheGasStation.T+90_000
	alice.squad.SetMyPosition(moved)
	// Bob takes at most one share a second from Alice; the last one always arrives.
	eventually(t, "Bob sees Alice's new position", func() bool {
		friend, _ := bob.friend(mike.ID)
		return friend.Share.Pos != nil && friend.Share.Pos.X == 120.5
	})

	alice.squad.ClearMyPosition()
	eventually(t, "Bob no longer sees a position after Alice's raid ended", func() bool {
		friend, _ := bob.friend(mike.ID)
		return friend.Share.Pos == nil && len(friend.Share.Draw["customs"]) == 1
	})
}
