package squad

// Ticket 17: my last GPS position in my share. The rules: included only while "Share my position"
// is on, part of the content (a new position raises rev), checked like every other field, and
// cleared when a raid on another map is reported.

import (
	"encoding/json"
	"sort"
	"strings"
	"testing"
	"time"
)

// atTheGasStation is a position on Customs, as SetMyPosition gets it from a screenshot.
var atTheGasStation = Position{Map: "customs", X: -67.89, Y: 7.79, Z: -153.62, Yaw: 92.5, T: noon.UnixMilli()}

func TestThePositionIsSharedOnlyWhileSharingIsOn(t *testing.T) {
	cases := []struct {
		name         string
		position     *Position
		sharing      Sharing
		wantPosition bool
	}{
		{"sharing on with a position shares it", &atTheGasStation, Sharing{Position: true}, true},
		{"sharing off drops it, whatever the server holds", &atTheGasStation, Sharing{Position: false}, false},
		{"sharing on with no position shares none", nil, Sharing{Position: true}, false},
		{"the tasks switch doesn't share the position", &atTheGasStation, Sharing{Tasks: true}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			share, _ := StampShare(nil, mike, someParts(), tc.position, tc.sharing, noon)
			if (share.Pos != nil) != tc.wantPosition {
				t.Fatalf("pos %+v, want a position: %v", share.Pos, tc.wantPosition)
			}
			encoded, _ := json.Marshal(share)
			if hasPosKey := strings.Contains(string(encoded), `"pos"`); hasPosKey != tc.wantPosition {
				t.Errorf("JSON %s: has \"pos\" = %v, want %v", encoded, hasPosKey, tc.wantPosition)
			}
		})
	}
}

func TestTheSharedPositionIsACopy(t *testing.T) {
	held := atTheGasStation
	share, _ := StampShare(nil, mike, someParts(), &held, shareEverything, noon)
	held.X = 999
	if share.Pos.X != atTheGasStation.X {
		t.Errorf("changing the held position changed the share: x = %v", share.Pos.X)
	}
}

func TestSwitchingPositionSharingOffAndOnStampsTheShareAgain(t *testing.T) {
	steps := []struct {
		name         string
		sharing      Sharing
		wantRev      int64
		wantPosition bool
	}{
		{"shared at first", Sharing{Position: true}, 1, true},
		{"switched off: rev + 1, friends drop it at once", Sharing{Position: false}, 2, false},
		{"still off: nothing new", Sharing{Position: false}, 2, false},
		{"switched on again: rev + 1 with the position held", Sharing{Position: true}, 3, true},
	}
	var previous *Share
	for index, step := range steps {
		now := noon.Add(time.Duration(index) * time.Second)
		share, _ := StampShare(previous, mike, someParts(), &atTheGasStation, step.sharing, now)
		if share.Rev != step.wantRev || (share.Pos != nil) != step.wantPosition {
			t.Errorf("%s: rev %d pos %v, want rev %d pos %v", step.name, share.Rev, share.Pos != nil, step.wantRev, step.wantPosition)
		}
		previous = &share
	}
}

func TestRevGoesUpForANewPositionAndNotForTheSameOne(t *testing.T) {
	first, _ := StampShare(nil, mike, someParts(), &atTheGasStation, shareEverything, noon)
	sameSpotLater := atTheGasStation
	sameSpotLater.T += 60_000
	moved := atTheGasStation
	moved.X += 25
	turned := atTheGasStation
	turned.Yaw = -10

	cases := []struct {
		name        string
		position    *Position
		wantRev     int64
		wantChanged bool
	}{
		{"the same position again keeps the rev", &atTheGasStation, 1, false},
		{"a new screenshot at the same spot is new (its time differs)", &sameSpotLater, 2, true},
		{"a moved position raises the rev", &moved, 2, true},
		{"a new heading raises the rev", &turned, 2, true},
		{"no position any more raises the rev", nil, 2, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, changed := StampShare(&first, mike, someParts(), tc.position, shareEverything, noon.Add(time.Minute))
			if got.Rev != tc.wantRev || changed != tc.wantChanged {
				t.Errorf("rev %d changed %v, want rev %d changed %v", got.Rev, changed, tc.wantRev, tc.wantChanged)
			}
		})
	}
}

// shareBeforeTicket17 is the share as copies up to 2.8.x read it: no "pos".
type shareBeforeTicket17 struct {
	Version   int                     `json:"v"`
	Player    Player                  `json:"player"`
	Rev       int64                   `json:"rev"`
	UpdatedAt int64                   `json:"updatedAt"`
	Draw      map[string][]Stroke     `json:"draw"`
	Tasks     map[string]TaskProgress `json:"tasks"`
}

func TestAShareWithAPositionStaysFormatVersion1(t *testing.T) {
	if ShareFormatVersion != 1 {
		t.Fatalf("ShareFormatVersion is %d: friends on 2.8.x would drop every share", ShareFormatVersion)
	}
	withPosition, _ := StampShare(nil, mike, someParts(), &atTheGasStation, shareEverything, noon)
	encoded, _ := json.Marshal(withPosition)

	t.Run("this copy accepts it", func(t *testing.T) {
		decoded, err := DecodeShare(encoded)
		if err != nil || decoded.Pos == nil || *decoded.Pos != atTheGasStation {
			t.Errorf("DecodeShare: %+v, %v", decoded.Pos, err)
		}
	})
	t.Run("a 2.8.x copy reads it the way it always did and ignores pos", func(t *testing.T) {
		var old shareBeforeTicket17
		if err := json.Unmarshal(encoded, &old); err != nil {
			t.Fatal(err)
		}
		if old.Version != 1 || old.Rev != 1 || len(old.Draw["customs"]) != 1 || len(old.Tasks) != 1 {
			t.Errorf("read as %+v", old)
		}
	})
	t.Run("a share without a position has exactly the 2.8.x fields", func(t *testing.T) {
		withoutPosition, _ := StampShare(nil, mike, someParts(), nil, shareEverything, noon)
		data, _ := json.Marshal(withoutPosition)
		var fields map[string]json.RawMessage
		json.Unmarshal(data, &fields)
		var names []string
		for name := range fields {
			names = append(names, name)
		}
		sort.Strings(names)
		if got := strings.Join(names, ","); got != "draw,player,rev,tasks,updatedAt,v" {
			t.Errorf("fields %s", got)
		}
	})
}

func TestPositionValidationDropsBadFriendData(t *testing.T) {
	withPos := func(position map[string]any) []byte {
		return validShareJSON(map[string]any{"pos": position})
	}
	good := func(change map[string]any) map[string]any {
		position := map[string]any{"map": "customs", "x": -67.89, "y": 7.79, "z": -153.62, "yaw": 92.5, "t": noon.UnixMilli()}
		for key, value := range change {
			position[key] = value
		}
		return position
	}
	without := func(field string) map[string]any {
		position := good(nil)
		delete(position, field)
		return position
	}
	cases := []struct {
		name     string
		data     []byte
		wantOkay bool
	}{
		{"a well-formed position is accepted", withPos(good(nil)), true},
		{"no position is accepted (2.8.x copies, sharing off)", validShareJSON(nil), true},
		{"a null position is accepted", validShareJSON(map[string]any{"pos": nil}), true},
		{"a map key with a dash is accepted", withPos(good(map[string]any{"map": "streets-of-tarkov"})), true},
		{"x, y and z at ±1e6 are accepted", withPos(good(map[string]any{"x": 1e6, "y": -1e6, "z": 1e6})), true},
		{"a heading of 359.9 is accepted", withPos(good(map[string]any{"yaw": 359.9})), true},
		{"a heading of -360 is accepted", withPos(good(map[string]any{"yaw": -360})), true},
		{"a map key named __proto__ is dropped", withPos(good(map[string]any{"map": "__proto__"})), false},
		{"a map key named constructor is dropped", withPos(good(map[string]any{"map": "constructor"})), false},
		{"a map key named toString is dropped", withPos(good(map[string]any{"map": "toString"})), false},
		{"a map key with markup is dropped", withPos(good(map[string]any{"map": "<b>"})), false},
		{"an empty map key is dropped", withPos(good(map[string]any{"map": ""})), false},
		{"a missing map key is dropped", withPos(without("map")), false},
		{"a 65-character map key is dropped", withPos(good(map[string]any{"map": strings.Repeat("a", 65)})), false},
		{"a map key that isn't text is dropped", withPos(good(map[string]any{"map": 7})), false},
		{"x over 1e6 is dropped", withPos(good(map[string]any{"x": 1e6 + 1})), false},
		{"y under -1e6 is dropped", withPos(good(map[string]any{"y": -2e6})), false},
		{"z over 1e6 is dropped", withPos(good(map[string]any{"z": 5e9})), false},
		{"x as text is dropped", withPos(good(map[string]any{"x": "12"})), false},
		{"a heading over 360 is dropped", withPos(good(map[string]any{"yaw": 361})), false},
		{"a heading under -360 is dropped", withPos(good(map[string]any{"yaw": -720})), false},
		{"a time of 0 is dropped", withPos(good(map[string]any{"t": 0})), false},
		{"a missing time is dropped", withPos(without("t")), false},
		{"a negative time is dropped", withPos(good(map[string]any{"t": -5})), false},
		{"a time with a fraction is dropped", withPos(good(map[string]any{"t": 1.5})), false},
		{"a position that isn't an object is dropped", validShareJSON(map[string]any{"pos": []any{1, 2}}), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := DecodeShare(tc.data)
			if (err == nil) != tc.wantOkay {
				t.Errorf("DecodeShare error = %v, want accepted = %v", err, tc.wantOkay)
			}
		})
	}
}

func TestAPositionIsFromAnotherMapUnlessTheRaidIsOnItsMap(t *testing.T) {
	cases := []struct {
		name    string
		raidMap string
		want    bool
	}{
		{"a raid on the same map keeps it", "customs", false},
		{"a raid on another map clears it", "woods", true},
		{"a raid on a map the log couldn't name clears it", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsFromAnotherMap(atTheGasStation, tc.raidMap); got != tc.want {
				t.Errorf("IsFromAnotherMap(customs, %q) = %v, want %v", tc.raidMap, got, tc.want)
			}
		})
	}
}
