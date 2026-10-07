package squad

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// ---------------------------------------------------------------- helpers

// testCopy is one copy of the app's squad, with its own data folder.
type testCopy struct {
	t        *testing.T
	dir      string
	listen   string
	peers    []string
	squad    *Squad
	mutex    sync.Mutex
	settings Settings // as last saved
}

func newTestCopy(t *testing.T, dir, listen string, peers []string, settings Settings) *testCopy {
	t.Helper()
	copy := &testCopy{t: t, dir: dir, listen: listen, peers: peers}
	copy.squad = New(Config{
		CacheFile:     filepath.Join(dir, "squad-task-map-squad.json"),
		StateDir:      filepath.Join(dir, StateFolderName),
		TransportName: "dev",
		Settings:      settings,
		SaveSettings: func(saved Settings) {
			copy.mutex.Lock()
			copy.settings = saved
			copy.mutex.Unlock()
		},
		RetryDelay: func(int) time.Duration { return 20 * time.Millisecond },
	})
	t.Cleanup(copy.squad.Stop)
	return copy
}

func (copy *testCopy) savedSettings() Settings {
	copy.mutex.Lock()
	defer copy.mutex.Unlock()
	return copy.settings
}

func (copy *testCopy) join() {
	copy.t.Helper()
	if err := copy.squad.Join(context.Background(), NewDevTransport(copy.listen, copy.peers)); err != nil {
		copy.t.Fatalf("join: %v", err)
	}
}

func (copy *testCopy) friend(playerID string) (FriendView, bool) {
	for _, friend := range copy.squad.View().Friends {
		if friend.PlayerID == playerID {
			return friend, true
		}
	}
	return FriendView{}, false
}

// eventually waits up to 5 s for a condition that another copy makes true over the network.
func eventually(t *testing.T, what string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting until %s", what)
}

// freeAddresses reserves n 127.0.0.1 ports (closed again so the copies can listen on them).
func freeAddresses(t *testing.T, n int) []string {
	t.Helper()
	var addresses []string
	for range n {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		addresses = append(addresses, listener.Addr().String())
		listener.Close()
	}
	return addresses
}

func drawingAt(x float64) ShareParts {
	return ShareParts{
		Draw:  map[string][]Stroke{"customs": {{Color: "#ff4d4d", Width: 2, Points: [][]float64{{x, 0}, {x + 10, 5}}}}},
		Tasks: map[string]TaskProgress{"657315ddab5a49b71f098853": twoTicks},
	}
}

// ---------------------------------------------------------------- the end-to-end test

func TestThreeCopiesShareOverTheDevTransport(t *testing.T) {
	addresses := freeAddresses(t, 3)
	dirs := []string{t.TempDir(), t.TempDir(), t.TempDir()}
	alice := newTestCopy(t, dirs[0], addresses[0], addresses, Settings{PlayerID: mike.ID, Name: "Alice", Color: "#4dabf7", ShareTasks: true})
	bob := newTestCopy(t, dirs[1], addresses[1], addresses, Settings{PlayerID: sam.ID, Name: "Bob", Color: "#ff922b"})
	carolSettings := Settings{PlayerID: "00000000000000cc", Name: "Carol", Color: "#40c057", ShareTasks: true}
	carol := newTestCopy(t, dirs[2], addresses[2], addresses, carolSettings)
	for _, copy := range []*testCopy{alice, bob, carol} {
		copy.join()
	}

	t.Run("a share from A reaches B and C", func(t *testing.T) {
		if _, err := alice.squad.SetMyShare(drawingAt(1)); err != nil {
			t.Fatal(err)
		}
		for _, other := range []*testCopy{bob, carol} {
			eventually(t, "Alice's first share arrives", func() bool {
				friend, known := other.friend(mike.ID)
				return known && friend.Online && friend.Share.Rev == 1 && friend.Name == "Alice"
			})
		}
		friend, _ := bob.friend(mike.ID)
		if len(friend.Share.Tasks) != 1 || friend.Share.Draw["customs"][0].Points[0][0] != 1 {
			t.Errorf("Bob got %+v", friend.Share)
		}
	})

	t.Run("an update propagates", func(t *testing.T) {
		alice.squad.SetMyShare(drawingAt(2))
		for _, other := range []*testCopy{bob, carol} {
			eventually(t, "Alice's update arrives", func() bool {
				friend, _ := other.friend(mike.ID)
				return friend.Share.Rev == 2 && friend.Share.Draw["customs"][0].Points[0][0] == 2
			})
		}
	})

	t.Run("a friend who doesn't share tasks sends none", func(t *testing.T) {
		bob.squad.SetMyShare(drawingAt(5)) // the page sent tasks; sharing is off for Bob
		eventually(t, "Bob's share arrives", func() bool {
			friend, known := alice.friend(sam.ID)
			return known && friend.Share.Rev == 1
		})
		friend, _ := alice.friend(sam.ID)
		if friend.Share.Tasks != nil {
			t.Errorf("Alice sees Bob's tasks %v; Bob doesn't share them", friend.Share.Tasks)
		}
		if status := alice.squad.View().Status; status.Text != "Connected · 1 of 1 friends online" {
			t.Errorf("status %q", status.Text)
		}
	})

	t.Run("C goes offline and A keeps C's last share with when it was seen", func(t *testing.T) {
		carol.squad.SetMyShare(drawingAt(7))
		eventually(t, "Carol's share arrives", func() bool {
			friend, known := alice.friend(carolSettings.PlayerID)
			return known && friend.Online
		})
		carol.squad.Stop()
		eventually(t, "Alice sees Carol offline", func() bool {
			friend, _ := alice.friend(carolSettings.PlayerID)
			return !friend.Online
		})
		friend, _ := alice.friend(carolSettings.PlayerID)
		if friend.Share.Rev != 1 || friend.LastSeen == 0 || friend.Name != "Carol" {
			t.Errorf("Alice's copy of Carol: %+v", friend)
		}
		if status := alice.squad.View().Status; status.Text != "Connected · 1 of 2 friends online" {
			t.Errorf("status %q", status.Text)
		}
		eventually(t, "Carol is in Alice's cache file with lastSeen (written within a second)", func() bool {
			_, cachedFriends := readCache(filepath.Join(dirs[0], "squad-task-map-squad.json"))
			return cachedFriends[carolSettings.PlayerID].LastSeen != 0
		})
	})

	t.Run("C comes back and refreshes", func(t *testing.T) {
		carolSettings.Joined = true
		carolAgain := newTestCopy(t, dirs[2], addresses[2], addresses, carolSettings)
		carolAgain.squad.Resume(NewDevTransport(addresses[2], addresses))
		eventually(t, "Alice sees Carol online again", func() bool {
			friend, _ := alice.friend(carolSettings.PlayerID)
			return friend.Online
		})
		carolAgain.squad.SetMyShare(drawingAt(8))
		eventually(t, "Carol's new share reaches Alice", func() bool {
			friend, _ := alice.friend(carolSettings.PlayerID)
			return friend.Share.Rev == 2 && friend.Share.Draw["customs"][0].Points[0][0] == 8
		})
	})
}

// ---------------------------------------------------------------- the cache

func TestTheCacheKeepsMyShareAndFriendsAcrossARestart(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "squad-task-map-squad.json")
	mine, _ := StampShare(nil, mike, someParts(), true, noon)
	friendShare, _ := StampShare(nil, sam, someParts(), false, noon)
	bad := friendShare
	bad.Player.Color = "red"

	cases := []struct {
		name        string
		write       func()
		wantMine    bool
		wantFriends int
	}{
		{"a missing file is an empty cache", func() {}, false, 0},
		{"my share and a friend's are read back", func() {
			writeCache(path, &mine, map[string]CachedFriend{sam.ID: {LastSeen: 42, Share: friendShare}})
		}, true, 1},
		{"a friend whose share no longer passes the checks is left out", func() {
			writeCache(path, &mine, map[string]CachedFriend{sam.ID: {LastSeen: 42, Share: bad}})
		}, true, 0},
		{"a friend filed under another player's id is left out", func() {
			writeCache(path, nil, map[string]CachedFriend{mike.ID: {LastSeen: 42, Share: friendShare}})
		}, false, 0},
		{"a broken file is an empty cache", func() { os.WriteFile(path, []byte("{nope"), 0o644) }, false, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			os.Remove(path)
			tc.write()
			gotMine, gotFriends := readCache(path)
			if (gotMine != nil) != tc.wantMine || len(gotFriends) != tc.wantFriends {
				t.Errorf("mine %v, %d friends; want mine %v, %d friends", gotMine != nil, len(gotFriends), tc.wantMine, tc.wantFriends)
			}
			if tc.wantFriends == 1 && gotFriends[sam.ID].LastSeen != 42 {
				t.Errorf("lastSeen %d, want 42", gotFriends[sam.ID].LastSeen)
			}
		})
	}
}

func TestMyShareKeepsItsRevAfterARestart(t *testing.T) {
	dir := t.TempDir()
	settings := Settings{PlayerID: mike.ID, Name: "Mike", Color: "#4dabf7", ShareTasks: true}
	first := newTestCopy(t, dir, "", nil, settings)
	first.squad.SetMyShare(drawingAt(1))
	first.squad.SetMyShare(drawingAt(2))
	first.squad.Stop() // the app closing: the waiting cache write is done now

	again := newTestCopy(t, dir, "", nil, settings)
	if rev := again.squad.View().Me.Rev; rev != 2 {
		t.Fatalf("after a restart rev = %d, want 2", rev)
	}
	result, _ := again.squad.SetMyShare(drawingAt(2))
	if result.Changed || result.Rev != 2 {
		t.Errorf("sending the same share after a restart: %+v, want unchanged rev 2", result)
	}
}

func TestANewCopyGetsAPlayerIdOnceAndDefaults(t *testing.T) {
	copy := newTestCopy(t, t.TempDir(), "", nil, Settings{})
	saved := copy.savedSettings()
	if !IsValidPlayerID(saved.PlayerID) || saved.Name != DefaultName || saved.Color != DefaultColor || saved.ShareTasks || saved.Joined {
		t.Errorf("saved %+v", saved)
	}
	again := newTestCopy(t, t.TempDir(), "", nil, saved)
	if again.squad.Settings().PlayerID != saved.PlayerID {
		t.Error("the player id changed on the next start")
	}
}

func TestTurningTaskSharingOffDropsTasksFromTheStoredShare(t *testing.T) {
	copy := newTestCopy(t, t.TempDir(), "", nil, Settings{PlayerID: mike.ID, Name: "Mike", Color: "#4dabf7", ShareTasks: true})
	copy.squad.SetMyShare(drawingAt(1))
	if err := copy.squad.SetProfile("Mike", "#4DABF7", false); err != nil {
		t.Fatal(err)
	}
	var shared Share
	if err := json.Unmarshal(copy.squad.feed.current(), &shared); err != nil {
		t.Fatal(err)
	}
	if shared.Tasks != nil || shared.Rev != 2 || shared.Player.Color != "#4dabf7" {
		t.Errorf("friends would get rev %d tasks %v colour %s", shared.Rev, shared.Tasks, shared.Player.Color)
	}
	result, _ := copy.squad.SetMyShare(drawingAt(1))
	if result.TasksShared {
		t.Errorf("tasks still shared: %+v", result)
	}
}

// ---------------------------------------------------------------- leaving

func TestLeaveDeletesTheNetworkStateAndForgetsFriends(t *testing.T) {
	dir := t.TempDir()
	addresses := freeAddresses(t, 1)
	copy := newTestCopy(t, dir, addresses[0], nil, Settings{PlayerID: mike.ID, Name: "Mike", Color: "#4dabf7"})
	stateDir := filepath.Join(dir, StateFolderName)
	os.MkdirAll(stateDir, 0o700)
	os.WriteFile(filepath.Join(stateDir, "tailscaled.state"), []byte("node key"), 0o600)
	copy.join()
	copy.squad.SetMyShare(drawingAt(1))
	friendShare, _ := StampShare(nil, sam, someParts(), false, noon)
	copy.squad.onFriendShare(PeerAddress{Key: "x"}, friendShare, false)
	if len(copy.squad.View().Friends) != 1 {
		t.Fatal("setup: the friend wasn't added")
	}

	copy.squad.Leave(context.Background())

	if _, err := os.Stat(stateDir); !os.IsNotExist(err) {
		t.Errorf("%s still exists after Leave (err %v)", StateFolderName, err)
	}
	view := copy.squad.View()
	if len(view.Friends) != 0 || view.Settings.Joined || view.Status.State != StateOff {
		t.Errorf("after Leave: %+v", view)
	}
	mine, cachedFriends := readCache(filepath.Join(dir, "squad-task-map-squad.json"))
	if len(cachedFriends) != 0 || mine == nil {
		t.Errorf("cache after Leave: mine %v, friends %v; want my share kept, no friends", mine != nil, cachedFriends)
	}
	if copy.savedSettings().Joined {
		t.Error("the settings still say joined")
	}
	if listener, err := net.Listen("tcp", addresses[0]); err != nil {
		t.Errorf("the peer API still listens after Leave: %v", err)
	} else {
		listener.Close()
	}
}

func TestLeavingGivesAFreshPlayerIDSoRejoiningIsANewMachine(t *testing.T) {
	dir := t.TempDir()
	addresses := freeAddresses(t, 1)
	copy := newTestCopy(t, dir, addresses[0], nil, Settings{PlayerID: mike.ID, Name: "Mike", Color: "#4dabf7"})
	copy.join()
	copy.squad.SetMyShare(drawingAt(1))
	before := copy.squad.View().Me

	copy.squad.Leave(context.Background())

	after := copy.squad.View().Me
	if after.PlayerID == mike.ID || !IsValidPlayerID(after.PlayerID) {
		t.Fatalf("player id after Leave: %q (was %q)", after.PlayerID, mike.ID)
	}
	if saved := copy.savedSettings().PlayerID; saved != after.PlayerID {
		t.Errorf("saved player id %q, view says %q", saved, after.PlayerID)
	}
	mine, _ := readCache(filepath.Join(dir, "squad-task-map-squad.json"))
	if mine == nil || mine.Player.ID != after.PlayerID {
		t.Fatalf("my cached share doesn't carry the new id: %+v", mine)
	}
	if mine.Rev != before.Rev+1 || len(mine.Draw) == 0 {
		t.Errorf("my share after Leave: rev %d (was %d), drawings %d; want the same drawings, rev+1", mine.Rev, before.Rev, len(mine.Draw))
	}
}

func TestLeavingWhenNotInASquadKeepsThePlayerID(t *testing.T) {
	dir := t.TempDir()
	squad := New(Config{CacheFile: filepath.Join(dir, "squad.json"), StateDir: filepath.Join(dir, StateFolderName),
		Settings: Settings{PlayerID: mike.ID}})
	squad.Leave(context.Background())
	if squad.Settings().PlayerID != mike.ID {
		t.Errorf("player id changed to %q without being in a squad", squad.Settings().PlayerID)
	}
}

func TestFriendsNotSeenFor30DaysAreDroppedWhenTheCacheIsLoaded(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "squad-task-map-squad.json")
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	samShare, _ := StampShare(nil, sam, someParts(), false, now)
	writeCache(path, nil, map[string]CachedFriend{
		sam.ID: {LastSeen: now.Add(-31 * 24 * time.Hour).UnixMilli(), Share: samShare},
	})
	squad := New(Config{CacheFile: path, StateDir: filepath.Join(dir, StateFolderName),
		Settings: Settings{PlayerID: mike.ID}, Now: func() time.Time { return now }})
	if friends := squad.View().Friends; len(friends) != 0 {
		t.Errorf("a friend last seen 31 days ago is still shown: %+v", friends)
	}
	squad.Stop() // the pruned cache is written (flushed) before the app closes
	if _, cached := readCache(path); len(cached) != 0 {
		t.Errorf("and still in the file: %+v", cached)
	}
}

func TestLeaveOnlyDeletesAFolderWithTheStateFolderName(t *testing.T) {
	dir := t.TempDir()
	precious := filepath.Join(dir, "my-documents")
	os.MkdirAll(precious, 0o700)
	squad := New(Config{CacheFile: filepath.Join(dir, "squad.json"), StateDir: precious})
	squad.Leave(context.Background())
	if _, err := os.Stat(precious); err != nil {
		t.Errorf("a folder not named %s was deleted: %v", StateFolderName, err)
	}
}

// ---------------------------------------------------------------- the peer API

func TestThePeerAPIAnswersOnlyAllowedCallers(t *testing.T) {
	feed := newShareFeed()
	feed.publish([]byte(`{"v":1}`))
	dev := NewDevTransport("127.0.0.1:7901", nil)
	server := newPeerServer(feed, dev)
	const ownHost, local = "127.0.0.1:7901", "127.0.0.1:50000"

	cases := []struct {
		name       string
		method     string
		path       string
		host       string
		remoteAddr string
		header     http.Header
		wantStatus int
	}{
		{"a copy on this PC gets the share", "GET", "/squad/v1/share", ownHost, local, nil, http.StatusOK},
		{"a caller on the LAN is refused", "GET", "/squad/v1/share", ownHost, "192.168.1.5:50000", nil, http.StatusForbidden},
		{"a tailnet address is refused by the dev transport", "GET", "/squad/v1/stream", ownHost, "100.64.0.9:50000", nil, http.StatusForbidden},
		{"a browser page on this PC is refused", "GET", "/squad/v1/share", ownHost, local, http.Header{"Origin": {"http://evil.example"}}, http.StatusForbidden},
		{"a same-origin fetch from a rebinding domain (no browser headers) is refused", "GET", "/squad/v1/share", "rebind.example:7901", local, nil, http.StatusMisdirectedRequest},
		{"localhost by name is refused", "GET", "/squad/v1/share", "localhost:7901", local, nil, http.StatusMisdirectedRequest},
		{"nothing can be written", "PUT", "/squad/v1/share", ownHost, local, nil, http.StatusNotFound},
		{"the page's API isn't here", "GET", "/api/state", ownHost, local, nil, http.StatusNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, tc.path, nil)
			request.Host = tc.host
			request.RemoteAddr = tc.remoteAddr
			for key, values := range tc.header {
				request.Header[key] = values
			}
			recorder := httptest.NewRecorder()
			server.Handler.ServeHTTP(recorder, request)
			if recorder.Code != tc.wantStatus {
				t.Errorf("status %d, want %d", recorder.Code, tc.wantStatus)
			}
		})
	}
}

func TestAShareIsNotServedBeforeThePageSentOne(t *testing.T) {
	server := newPeerServer(newShareFeed(), NewDevTransport("127.0.0.1:7901", nil))
	request := httptest.NewRequest("GET", "/squad/v1/share", nil)
	request.Host, request.RemoteAddr = "127.0.0.1:7901", "127.0.0.1:50000"
	recorder := httptest.NewRecorder()
	server.Handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNotFound {
		t.Errorf("status %d, want 404", recorder.Code)
	}
}

func TestOneCallerCantHoldEveryStream(t *testing.T) {
	feed := newShareFeed()
	steps := []struct {
		name   string
		caller string
		wantOK bool
	}{
		{"a friend opens a stream", "node:A", true},
		{"and a second one (a reconnect overlapping)", "node:A", true},
		{"but not a third", "node:A", false},
		{"another friend still gets one", "node:B", true},
	}
	for _, step := range steps {
		if _, ok := feed.subscribe(step.caller, tailnetStreamsPerCaller); ok != step.wantOK {
			t.Errorf("%s: ok = %v, want %v", step.name, ok, step.wantOK)
		}
	}
}

func TestThePeerAPIRefusesAStreamOverTheCallersCap(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	dev := NewDevTransport(listener.Addr().String(), nil)
	feed := newShareFeed()
	server := newPeerServer(feed, dev)
	go server.Serve(listener)
	t.Cleanup(func() { server.Close() })

	var statuses []int
	for range devStreamsPerCaller + 1 {
		response, err := http.Get("http://" + listener.Addr().String() + "/squad/v1/stream")
		if err != nil {
			t.Fatal(err)
		}
		statuses = append(statuses, response.StatusCode)
		t.Cleanup(func() { response.Body.Close() })
	}
	last := statuses[len(statuses)-1]
	if statuses[0] != http.StatusOK || last != http.StatusServiceUnavailable {
		t.Errorf("statuses %v: want %d streams, then 503", statuses, devStreamsPerCaller)
	}
}

func TestThePeerServerDropsIdleAndStuckConnections(t *testing.T) {
	server := newPeerServer(newShareFeed(), NewDevTransport("127.0.0.1:7901", nil))
	if server.IdleTimeout != peerIdleTimeout || server.ReadHeaderTimeout != peerHeaderTimeout {
		t.Errorf("idle %v, header %v; want %v and %v", server.IdleTimeout, server.ReadHeaderTimeout, peerIdleTimeout, peerHeaderTimeout)
	}
	if peerIdleTimeout > time.Minute || peerWriteTimeout > 10*time.Second {
		t.Errorf("idle %v / write %v are longer than QA's limits", peerIdleTimeout, peerWriteTimeout)
	}
}

// floodingFriend serves a stream that sends `count` shares (rev 1..count) as fast as it can.
func floodingFriend(t *testing.T, count int) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/squad/v1/share" {
			http.Error(writer, "Nothing shared yet", http.StatusNotFound)
			return
		}
		writer.Header().Set("Content-Type", "text/event-stream")
		for rev := 1; rev <= count; rev++ {
			writer.Write(shareEvent(validShareJSON(map[string]any{"rev": rev, "updatedAt": rev})))
		}
		writer.(http.Flusher).Flush()
	}))
	t.Cleanup(server.Close)
	return server
}

func TestAFriendSendingABurstIsTakenAboutOnceASecondAndTheLastShareWins(t *testing.T) {
	friend := floodingFriend(t, 1000)
	var mutex sync.Mutex
	var accepted []int64
	links := newFriendLinks(newPeerHTTPClient(nil), friendEvents{
		onShare: func(_ PeerAddress, share Share, _ bool) {
			mutex.Lock()
			accepted = append(accepted, share.Rev)
			mutex.Unlock()
		},
		onStreamClosed: func(PeerAddress) {},
	}, RetryDelay)

	links.connectOnce(context.Background(), PeerAddress{Key: "flood", BaseURL: friend.URL})

	if len(accepted) == 0 || len(accepted) > 3 || accepted[len(accepted)-1] != 1000 {
		t.Errorf("accepted revs %v from 1000 sent: want a handful, the last one 1000", accepted)
	}
}

func TestABurstOfFriendSharesMakesAHandfulOfPageEventsAndFileWrites(t *testing.T) {
	var pageEvents atomic.Int64
	dir := t.TempDir()
	squad := New(Config{
		CacheFile: filepath.Join(dir, "squad-task-map-squad.json"),
		Settings:  Settings{PlayerID: mike.ID, Name: "Mike", Color: "#4dabf7"},
		OnChange:  func() { pageEvents.Add(1) },
	})
	t.Cleanup(squad.Stop)
	time.Sleep(50 * time.Millisecond) // let start-up's own write and event happen
	eventsBefore, writesBefore := pageEvents.Load(), squad.writeCount.Load()

	for rev := 1; rev <= 1000; rev++ {
		share, err := DecodeShare(validShareJSON(map[string]any{"rev": rev, "updatedAt": rev}))
		if err != nil {
			t.Fatal(err)
		}
		squad.onFriendShare(PeerAddress{Key: "flood"}, share, true)
	}
	time.Sleep(ChangeInterval + 500*time.Millisecond)

	events := pageEvents.Load() - eventsBefore
	writes := squad.writeCount.Load() - writesBefore
	if events < 1 || events > 3 || writes < 1 || writes > 3 {
		t.Errorf("1000 shares made %d page events and %d file writes; want 1 to 3 of each", events, writes)
	}
	friend, _ := (&testCopy{squad: squad}).friend(sam.ID)
	_, cached := readCache(filepath.Join(dir, "squad-task-map-squad.json"))
	if friend.Share.Rev != 1000 || cached[sam.ID].Share.Rev != 1000 {
		t.Errorf("the page has rev %d and the file rev %d; the last share (1000) must win",
			friend.Share.Rev, cached[sam.ID].Share.Rev)
	}
}

func TestSharesAreReadFromTheStreamOneEventAtATime(t *testing.T) {
	stream := ": squad\n\nevent: share\ndata: {\"a\":1}\n\nevent: share\ndata: {\"a\":2}\n\n"
	var received []string
	err := readShareEvents(strings.NewReader(stream), func(data []byte) { received = append(received, string(data)) })
	if err != nil || len(received) != 2 || received[0] != `{"a":1}` || received[1] != `{"a":2}` {
		t.Errorf("received %q, err %v", received, err)
	}
}
