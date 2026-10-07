package squad

// The tsnet transport on a fake tailnet: Tailscale's own in-process control server (testcontrol)
// and a DERP relay on 127.0.0.1, so real tsnet nodes join, find each other on the IPN bus and talk
// through WireGuard without touching the internet. (Test-only imports: none of this is in the exe.)

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"tailscale.com/net/netns"
	"tailscale.com/tsnet"
	"tailscale.com/tstest/integration"
	"tailscale.com/tstest/integration/testcontrol"
	"tailscale.com/types/logger"
)

const testInviteCode = "tskey-auth-squad-test"

// fakeTailnet starts a control server that tags nodes as they ask. With requiredInviteCode set it
// takes only that code; note that this fake then wants it on every log-in, even a known node coming
// back after a restart (the real Tailscale doesn't), so only the wrong-code test uses it.
func fakeTailnet(t *testing.T, requiredInviteCode string) *testcontrol.Server {
	t.Helper()
	netns.SetEnabled(false)
	t.Cleanup(func() { netns.SetEnabled(true) })
	control := &testcontrol.Server{
		DERPMap:        integration.RunDERPAndSTUN(t, logger.Discard, "127.0.0.1"),
		MagicDNSDomain: "squad-test.ts.net",
		RequireAuthKey: requiredInviteCode,
		TagOwners:      map[string][]string{SquadTag: {}},
		AllOnline:      true,
		Logf:           logger.Discard,
	}
	control.HTTPTestServer = httptest.NewUnstartedServer(control)
	control.HTTPTestServer.Start()
	t.Cleanup(control.HTTPTestServer.Close)
	return control
}

func tsnetTransportFor(controlURL, dir, playerID, inviteCode string) *TsnetTransport {
	return NewTsnetTransport(TsnetConfig{
		StateDir:      filepath.Join(dir, StateFolderName),
		PlayerID:      playerID,
		AuthKey:       inviteCode,
		ControlURL:    controlURL,
		advertiseTags: []string{SquadTag},
	})
}

func eventuallyWithin(t *testing.T, timeout time.Duration, what string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timed out waiting until %s", what)
}

func TestTwoCopiesShareOverARealTsnetTailnet(t *testing.T) {
	if testing.Short() {
		t.Skip("starts real tsnet nodes")
	}
	// tsnet binds UDP on every interface, and Windows Firewall asks about each new test binary
	// that does (so every `go test` and every cmd/release run would pop a prompt). It runs on
	// Linux (cloud sessions); on Windows only when asked for.
	if runtime.GOOS == "windows" && os.Getenv("STM_SQUAD_TSNET_TEST") == "" {
		t.Skip("set STM_SQUAD_TSNET_TEST=1 to run real tsnet nodes on Windows (firewall prompt)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	aliceDir, bobDir := t.TempDir(), t.TempDir()
	alice := newTestCopy(t, aliceDir, "", nil, Settings{PlayerID: mike.ID, Name: "Alice", Color: "#4dabf7", ShareTasks: true})
	bob := newTestCopy(t, bobDir, "", nil, Settings{PlayerID: sam.ID, Name: "Bob", Color: "#ff922b"})

	t.Run("a wrong invite code is refused and leaves nothing behind", func(t *testing.T) {
		strictTailnet := fakeTailnet(t, testInviteCode).HTTPTestServer.URL
		shortContext, cancelShort := context.WithTimeout(ctx, 5*time.Second)
		defer cancelShort()
		err := bob.squad.Join(shortContext, tsnetTransportFor(strictTailnet, bobDir, sam.ID, "tskey-auth-wrong"))
		if err == nil {
			t.Fatal("joined with a wrong invite code")
		}
		if !strings.Contains(err.Error(), "invalid authkey") {
			t.Errorf("the error %q doesn't give Tailscale's reason", err)
		}
		if _, statErr := os.Stat(filepath.Join(bobDir, StateFolderName)); !os.IsNotExist(statErr) {
			t.Errorf("the state folder is still there after a failed join")
		}
		if bob.squad.Settings().Joined {
			t.Error("settings say joined after a failed join")
		}
	})

	control := fakeTailnet(t, "")
	controlURL := control.HTTPTestServer.URL
	var aliceAgain *testCopy
	wholeTest := t // copies made in a subtest must outlive it

	t.Run("both join, and a share reaches the other over the tailnet", func(t *testing.T) {
		alice.squad.SetMyShare(drawingAt(1))
		for _, copy := range []*testCopy{alice, bob} {
			transport := tsnetTransportFor(controlURL, copy.dir, copy.squad.Settings().PlayerID, testInviteCode)
			if err := copy.squad.Join(ctx, transport); err != nil {
				t.Fatalf("join: %v", err)
			}
		}
		eventuallyWithin(t, 30*time.Second, "Bob has Alice's share and sees her online", func() bool {
			friend, known := bob.friend(mike.ID)
			return known && friend.Online && friend.Share.Rev == 1
		})
		if bob.squad.View().Status.State != StateConnected {
			t.Errorf("Bob's status: %+v", bob.squad.View().Status)
		}
	})

	t.Run("the invite code is not kept anywhere", func(t *testing.T) {
		saved := alice.savedSettings()
		if !saved.Joined {
			t.Error("settings don't say joined")
		}
		if containsText(t, aliceDir, testInviteCode) {
			t.Error("the invite code was written to a file in the data folder")
		}
	})

	t.Run("an update reaches the friend", func(t *testing.T) {
		alice.squad.SetMyShare(drawingAt(2))
		eventuallyWithin(t, 15*time.Second, "Bob gets rev 2", func() bool {
			friend, _ := bob.friend(mike.ID)
			return friend.Share.Rev == 2
		})
	})

	t.Run("a tailnet node without tag:stm is refused", func(t *testing.T) {
		intruder := &tsnet.Server{
			Dir:        filepath.Join(t.TempDir(), "intruder"),
			Hostname:   "laptop",
			AuthKey:    testInviteCode,
			ControlURL: controlURL,
			UserLogf:   logger.Discard,
		}
		defer intruder.Close()
		if _, err := intruder.Up(ctx); err != nil {
			t.Fatal(err)
		}
		aliceAddress := peerAddressOf(t, bob, mike.ID)
		request, _ := http.NewRequestWithContext(ctx, http.MethodGet, aliceAddress+"/squad/v1/share", nil)
		response, err := intruder.HTTPClient().Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusForbidden {
			t.Errorf("an untagged node got %d, want 403", response.StatusCode)
		}
	})

	t.Run("after a restart the copy reconnects without an invite code", func(t *testing.T) {
		alice.squad.Stop()
		eventuallyWithin(t, 15*time.Second, "Bob sees Alice offline", func() bool {
			friend, _ := bob.friend(mike.ID)
			return !friend.Online
		})
		settings := alice.savedSettings()
		aliceAgain = newTestCopy(wholeTest, aliceDir, "", nil, settings)
		aliceAgain.squad.Resume(tsnetTransportFor(controlURL, aliceDir, mike.ID, ""))
		eventuallyWithin(t, 30*time.Second, "Bob sees Alice online again", func() bool {
			friend, _ := bob.friend(mike.ID)
			return friend.Online
		})
		if aliceAgain.squad.View().Me.Rev != 2 {
			t.Errorf("Alice's share after the restart: rev %d, want 2", aliceAgain.squad.View().Me.Rev)
		}
	})

	t.Run("leaving deletes the node key and forgets friends", func(t *testing.T) {
		bob.squad.Leave(ctx)
		if _, err := os.Stat(filepath.Join(bobDir, StateFolderName)); !os.IsNotExist(err) {
			t.Errorf("the state folder survived Leave: %v", err)
		}
		if view := bob.squad.View(); len(view.Friends) != 0 || view.Settings.Joined {
			t.Errorf("after Leave: %+v", view)
		}
	})

	t.Run("a copy the tailnet signs out says so and stops its node", func(t *testing.T) {
		// As when the owner deletes the machine or its key expires in the admin console.
		for _, node := range control.AllNodes() {
			if strings.HasPrefix(node.Name, Hostname(mike.ID)) {
				node.KeyExpiry = time.Now().Add(-time.Minute)
				control.UpdateNode(node)
			}
		}
		eventuallyWithin(t, 30*time.Second, "Alice's status says signed out", func() bool {
			return aliceAgain.squad.View().Status.State == StateNeedsLogin
		})
		time.Sleep(200 * time.Millisecond) // the node closing must not turn this into an error
		if status := aliceAgain.squad.View().Status; status.State != StateNeedsLogin {
			t.Errorf("status %+v, want needsLogin", status)
		}
		if !aliceAgain.squad.Settings().Joined {
			t.Error("a sign-out by the tailnet must not leave the squad by itself (Leave cleans up)")
		}
	})
}

// peerAddressOf is the peer API address of a friend, as one copy found it on the tailnet.
func peerAddressOf(t *testing.T, copy *testCopy, playerID string) string {
	t.Helper()
	current := copy.squad.currentSession()
	transport := current.transport.(*TsnetTransport)
	localClient, err := transport.server.LocalClient()
	if err != nil {
		t.Fatal(err)
	}
	status, err := localClient.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	friends, _ := SquadPeers(tailnetPeersFromStatus(status), copy.squad.Settings().PlayerID)
	for _, peer := range friends {
		if peer.PlayerID == playerID {
			return peer.BaseURL
		}
	}
	t.Fatalf("%s isn't on the tailnet", playerID)
	return ""
}

// containsText reports whether any file under dir contains text.
func containsText(t *testing.T, dir, text string) bool {
	t.Helper()
	found := false
	filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return nil
		}
		data, readErr := os.ReadFile(path)
		if readErr == nil && strings.Contains(string(data), text) {
			found = true
		}
		return nil
	})
	return found
}
