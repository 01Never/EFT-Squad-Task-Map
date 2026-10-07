package squad

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

var (
	mike     = Player{ID: "0123456789abcdef", Name: "Mike", Color: "#4dabf7"}
	sam      = Player{ID: "fedcba9876543210", Name: "Sam", Color: "#ff922b"}
	noon     = time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	oneLine  = Stroke{Color: "#ff4d4d", Width: 2.5, Points: [][]float64{{10, 20}, {30, 40}}}
	twoTicks = TaskProgress{Ticks: map[string]Tick{"objectiveA": {IsDone: true}, "objectiveB": {Count: 3}}, Percent: 40}
)

func someParts() ShareParts {
	return ShareParts{
		Draw:  map[string][]Stroke{"customs": {oneLine}},
		Tasks: map[string]TaskProgress{"657315ddab5a49b71f098853": twoTicks},
	}
}

func TestRevStamping(t *testing.T) {
	first, _ := StampShare(nil, mike, someParts(), true, noon)
	movedLine := someParts()
	movedLine.Draw["customs"][0].Points = [][]float64{{11, 20}, {30, 40}}
	renamed := mike
	renamed.Name = "Mikey"

	cases := []struct {
		name        string
		previous    *Share
		player      Player
		parts       ShareParts
		wantRev     int64
		wantChanged bool
	}{
		{"the first share starts at rev 1", nil, mike, someParts(), 1, true},
		{"the same drawings and tasks keep the rev", &first, mike, someParts(), 1, false},
		{"a moved line raises the rev by one", &first, mike, movedLine, 2, true},
		{"a new name raises the rev by one", &first, renamed, someParts(), 2, true},
		{"undoing every drawing raises the rev", &first, mike, ShareParts{Tasks: someParts().Tasks}, 2, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			later := noon.Add(time.Minute)
			got, changed := StampShare(tc.previous, tc.player, tc.parts, true, later)
			if got.Rev != tc.wantRev || changed != tc.wantChanged {
				t.Errorf("rev %d changed %v, want rev %d changed %v", got.Rev, changed, tc.wantRev, tc.wantChanged)
			}
			wantUpdatedAt := noon.UnixMilli()
			if tc.wantChanged {
				wantUpdatedAt = later.UnixMilli()
			}
			if got.UpdatedAt != wantUpdatedAt {
				t.Errorf("updatedAt %d, want %d (only a change moves it)", got.UpdatedAt, wantUpdatedAt)
			}
			if got.Version != ShareFormatVersion || got.Player != tc.player {
				t.Errorf("stamped v=%d player=%v", got.Version, got.Player)
			}
		})
	}
}

func TestTasksAreStrippedWhenSharingIsOff(t *testing.T) {
	cases := []struct {
		name          string
		shareTasks    bool
		wantTaskCount int
		wantNullTasks bool
	}{
		{"sharing on keeps the tasks", true, 1, false},
		{"sharing off drops the tasks, whatever the page sent", false, 0, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			share, _ := StampShare(nil, mike, someParts(), tc.shareTasks, noon)
			if len(share.Tasks) != tc.wantTaskCount {
				t.Errorf("%d tasks, want %d", len(share.Tasks), tc.wantTaskCount)
			}
			encoded, _ := json.Marshal(share)
			hasNull := strings.Contains(string(encoded), `"tasks":null`)
			if hasNull != tc.wantNullTasks {
				t.Errorf("JSON %s: tasks null = %v, want %v", encoded, hasNull, tc.wantNullTasks)
			}
		})
	}

	t.Run("turning sharing off raises the rev, so friends drop the tasks at once", func(t *testing.T) {
		shared, _ := StampShare(nil, mike, someParts(), true, noon)
		hidden, changed := StampShare(&shared, mike, someParts(), false, noon.Add(time.Second))
		if !changed || hidden.Rev != 2 || hidden.Tasks != nil {
			t.Errorf("changed %v rev %d tasks %v", changed, hidden.Rev, hidden.Tasks)
		}
	})
}

// validShareJSON is a friend's share as it arrives, with one field replaced when asked.
func validShareJSON(replace map[string]any) []byte {
	share := map[string]any{
		"v":         1,
		"player":    map[string]any{"id": sam.ID, "name": sam.Name, "color": sam.Color},
		"rev":       7,
		"updatedAt": noon.UnixMilli(),
		"draw":      map[string]any{"customs": []any{map[string]any{"c": "#ff4d4d", "w": 2, "pts": []any{[]any{1, 2}, []any{3, 4}}}}},
		"tasks":     map[string]any{"657315ddab5a49b71f098853": map[string]any{"ticks": map[string]any{"a1": true, "b2": 3}, "pct": 40}},
	}
	for key, value := range replace {
		share[key] = value
	}
	data, _ := json.Marshal(share)
	return data
}

func withPlayer(id, name, color string) map[string]any {
	return map[string]any{"player": map[string]any{"id": id, "name": name, "color": color}}
}

func TestValidationRejectsBadPeerData(t *testing.T) {
	oneStroke := func(stroke map[string]any) map[string]any {
		return map[string]any{"draw": map[string]any{"customs": []any{stroke}}}
	}
	oneTask := func(progress any) map[string]any {
		return map[string]any{"tasks": map[string]any{"657315ddab5a49b71f098853": progress}}
	}
	hugeName := strings.Repeat("x", MaxNameRunes+1)
	cases := []struct {
		name     string
		data     []byte
		wantOkay bool
	}{
		{"a well-formed share is accepted", validShareJSON(nil), true},
		{"tasks may be null (sharing off)", validShareJSON(map[string]any{"tasks": nil}), true},
		{"a 32-character name is accepted", validShareJSON(withPlayer(sam.ID, strings.Repeat("x", 32), sam.Color)), true},
		{"not JSON is dropped", []byte("<html>"), false},
		{"another format version is dropped", validShareJSON(map[string]any{"v": 2}), false},
		{"a 33-character name is dropped", validShareJSON(withPlayer(sam.ID, hugeName, sam.Color)), false},
		{"an empty name is dropped", validShareJSON(withPlayer(sam.ID, "", sam.Color)), false},
		{"a name with a control character is dropped", validShareJSON(withPlayer(sam.ID, "Sam\u0007", sam.Color)), false},
		{"a colour that isn't #rrggbb is dropped", validShareJSON(withPlayer(sam.ID, "Sam", "red")), false},
		{"a colour with CSS in it is dropped", validShareJSON(withPlayer(sam.ID, "Sam", "#fff;background:url(x)")), false},
		{"a player id that isn't 16 hex characters is dropped", validShareJSON(withPlayer("../../etc", "Sam", sam.Color)), false},
		{"rev 0 is dropped", validShareJSON(map[string]any{"rev": 0}), false},
		{"drawings that aren't by map are dropped", validShareJSON(map[string]any{"draw": []any{1, 2}}), false},
		{"a map key with odd characters is dropped", validShareJSON(map[string]any{"draw": map[string]any{"<b>": []any{}}}), false},
		{"a stroke point with three numbers is dropped", validShareJSON(oneStroke(map[string]any{"c": "#fff", "w": 1, "pts": []any{[]any{1, 2, 3}}})), false},
		{"a stroke without points is dropped", validShareJSON(oneStroke(map[string]any{"c": "#fff", "w": 1, "pts": []any{}})), false},
		{"a stroke colour that isn't a colour is dropped", validShareJSON(oneStroke(map[string]any{"c": "url(x)", "w": 1, "pts": []any{[]any{1, 2}}})), false},
		{"a stroke of width 0 is dropped", validShareJSON(oneStroke(map[string]any{"c": "#fff", "w": 0, "pts": []any{[]any{1, 2}}})), false},
		{"a tick that is false is dropped", validShareJSON(oneTask(map[string]any{"ticks": map[string]any{"a1": false}, "pct": 0})), false},
		{"a tick that is text is dropped", validShareJSON(oneTask(map[string]any{"ticks": map[string]any{"a1": "3"}, "pct": 0})), false},
		{"a negative tick count is dropped", validShareJSON(oneTask(map[string]any{"ticks": map[string]any{"a1": -1}, "pct": 0})), false},
		{"pct over 100 is dropped", validShareJSON(oneTask(map[string]any{"ticks": map[string]any{}, "pct": 101})), false},
		{"a share over 2 MB is dropped", append(validShareJSON(nil), make([]byte, MaxShareBytes)...), false},
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

func TestTicksReadAndWriteLikeThePageSavesThem(t *testing.T) {
	var ticks map[string]Tick
	if err := json.Unmarshal([]byte(`{"a":true,"b":3}`), &ticks); err != nil {
		t.Fatal(err)
	}
	if !ticks["a"].IsDone || ticks["b"].Count != 3 {
		t.Errorf("read %+v", ticks)
	}
	encoded, _ := json.Marshal(ticks)
	if string(encoded) != `{"a":true,"b":3}` {
		t.Errorf("wrote %s", encoded)
	}
}

func TestBackoffSchedule(t *testing.T) {
	cases := []struct {
		name     string
		failures int
		want     time.Duration
	}{
		{"the first retry waits one second", 1, time.Second},
		{"the second waits two", 2, 2 * time.Second},
		{"the third waits four", 3, 4 * time.Second},
		{"the sixth waits 32", 6, 32 * time.Second},
		{"the seventh is capped at a minute", 7, time.Minute},
		{"it never goes over a minute", 50, time.Minute},
		{"no failures yet still waits a second", 0, time.Second},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := RetryDelay(tc.failures); got != tc.want {
				t.Errorf("RetryDelay(%d) = %v, want %v", tc.failures, got, tc.want)
			}
		})
	}
}

func TestCallerChecks(t *testing.T) {
	t.Run("the dev transport answers this PC only", func(t *testing.T) {
		cases := []struct {
			remoteAddr string
			want       bool
		}{
			{"127.0.0.1:50123", true},
			{"[::1]:50123", true},
			{"127.8.9.10:1", true},
			{"192.168.1.20:50123", false},
			{"100.64.0.7:50123", false},
			{"[fd7a:115c:a1e0::1]:7777", false},
			{"not an address", false},
		}
		for _, tc := range cases {
			if got := IsLoopbackCaller(tc.remoteAddr); got != tc.want {
				t.Errorf("IsLoopbackCaller(%q) = %v, want %v", tc.remoteAddr, got, tc.want)
			}
		}
	})

	t.Run("the tailnet listener answers tag:stm nodes only", func(t *testing.T) {
		cases := []struct {
			tags []string
			want bool
		}{
			{[]string{"tag:stm"}, true},
			{[]string{"tag:server", "tag:stm"}, true},
			{nil, false},
			{[]string{"tag:stmx"}, false},
			{[]string{"TAG:STM"}, false},
		}
		for _, tc := range cases {
			if got := HasSquadTag(tc.tags); got != tc.want {
				t.Errorf("HasSquadTag(%v) = %v, want %v", tc.tags, got, tc.want)
			}
		}
	})

	t.Run("browser requests are refused on the peer API", func(t *testing.T) {
		cases := []struct {
			name   string
			header http.Header
			want   bool
		}{
			{"a friend's copy sends neither", http.Header{}, false},
			{"a page sends Origin", http.Header{"Origin": {"http://evil.example"}}, true},
			{"a browser sends Sec-Fetch-Site", http.Header{"Sec-Fetch-Site": {"cross-site"}}, true},
		}
		for _, tc := range cases {
			if got := IsBrowserRequest(tc.header); got != tc.want {
				t.Errorf("%s: IsBrowserRequest = %v, want %v", tc.name, got, tc.want)
			}
		}
	})
}

func TestAShareMustCarryTheIdItsNodeIsNamedAfter(t *testing.T) {
	share := Share{Player: sam}
	cases := []struct {
		name     string
		expected string
		want     bool
	}{
		{"the node's own id fits", sam.ID, true},
		{"another player's id doesn't", mike.ID, false},
		{"the dev transport has no names, so any id fits", "", true},
	}
	for _, tc := range cases {
		if got := ShareFitsPeer(share, tc.expected); got != tc.want {
			t.Errorf("%s: ShareFitsPeer = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestAFriendsShareIsNewWhenRevOrUpdatedAtDiffer(t *testing.T) {
	known := Share{Rev: 5, UpdatedAt: 100}
	cases := []struct {
		name     string
		known    *Share
		received Share
		want     bool
	}{
		{"the first share from a friend is new", nil, known, true},
		{"the same rev and time is not new", &known, Share{Rev: 5, UpdatedAt: 100}, false},
		{"a higher rev is new", &known, Share{Rev: 6, UpdatedAt: 200}, true},
		{"a friend who reset their data (rev 1 again) is new", &known, Share{Rev: 1, UpdatedAt: 300}, true},
	}
	for _, tc := range cases {
		if got := HasChanged(tc.known, tc.received); got != tc.want {
			t.Errorf("%s: HasChanged = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestProfileRules(t *testing.T) {
	cases := []struct {
		name      string
		check     func() bool
		wantValid bool
	}{
		{"a name is trimmed", func() bool { name, ok := NormalizeName("  Mike "); return ok && name == "Mike" }, true},
		{"a blank name is refused", func() bool { _, ok := NormalizeName("   "); return ok }, false},
		{"a 32-character name with accents is fine", func() bool { _, ok := NormalizeName(strings.Repeat("é", 32)); return ok }, true},
		{"a colour is lower-cased", func() bool { color, ok := NormalizeColor("#4DABF7"); return ok && color == "#4dabf7" }, true},
		{"a three-digit colour is refused", func() bool { _, ok := NormalizeColor("#fff"); return ok }, false},
		{"a new player id has the right shape", func() bool { return IsValidPlayerID(NewPlayerID()) }, true},
		{"the hostname carries the player id", func() bool { return Hostname(mike.ID) == "stm-"+mike.ID }, true},
		{"an invite code starts with tskey-", func() bool { return IsPlausibleAuthKey("tskey-auth-kAbc123-XYZ") }, true},
		{"a pasted code with a space is refused", func() bool { return IsPlausibleAuthKey("tskey-auth- x") }, false},
	}
	for _, tc := range cases {
		if got := tc.check(); got != tc.wantValid {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.wantValid)
		}
	}
}

func TestStatusLine(t *testing.T) {
	cases := []struct {
		name    string
		state   string
		online  int
		known   int
		problem string
		want    string
	}{
		{"connected with friends", StateConnected, 3, 4, "", "Connected · 3 of 4 friends online"},
		{"connected before any friend was seen", StateConnected, 0, 0, "", "Connected · no friends seen yet"},
		{"not in a squad", StateOff, 0, 2, "", "Not in a squad"},
		{"starting", StateStarting, 0, 0, "", "Connecting…"},
		{"failed", StateError, 0, 0, "no network", "Squad connection failed: no network"},
	}
	for _, tc := range cases {
		if got := StatusText(tc.state, tc.online, tc.known, tc.problem); got != tc.want {
			t.Errorf("%s: %q, want %q", tc.name, got, tc.want)
		}
	}
}
