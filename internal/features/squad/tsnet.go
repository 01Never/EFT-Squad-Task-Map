package squad

// The real transport: a Tailscale node inside the exe (tsnet). It starts only once the player has
// joined a squad. Its state folder (squad-task-map-tailscale/) holds the node key; the invite code
// (auth key) is used once, when joining, and never stored by the app.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"

	"tailscale.com/envknob"
	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tsnet"
)

// tsnetStateFile is the file tsnet keeps the node key in, inside the state folder.
const tsnetStateFile = "tailscaled.state"

// errNotLoggedIn: there's no node key in the state folder (joined before, but the folder is gone).
var errNotLoggedIn = errors.New("this copy isn't logged in to the squad network")

// TsnetConfig is what the tsnet transport needs.
type TsnetConfig struct {
	StateDir string // squad-task-map-tailscale/ in the data folder
	PlayerID string // the node is named stm-<player id>
	AuthKey  string // the invite code, only when joining; "" when resuming after a restart
	Debug    bool   // print tsnet's own (verbose) log in the console (STM_SQUAD_DEBUG)

	// Tests only (tsnet_test.go runs a fake tailnet): its control server, and the tags a node asks
	// for. A real node gets tag:stm from the invite code instead.
	controlURL    string
	advertiseTags []string
}

// TsnetTransport is the squad on a real tailnet.
type TsnetTransport struct {
	config TsnetConfig
	server *tsnet.Server
	client *http.Client

	mutex     sync.Mutex
	isStarted bool // tsnet was started, so Logout and Close have something to do
	isClosed  bool
}

// NewTsnetTransport prepares a node; nothing starts until Up.
func NewTsnetTransport(config TsnetConfig) *TsnetTransport {
	// Owner's lightness and privacy rule: no log uploads to Tailscale (tsnet would send its debug
	// log to log.tailscale.com otherwise). Its log still goes to files in the state folder.
	envknob.SetNoLogsNoSupport()
	// tsnet asks for a "logs folder" (on Windows %LocalAppData%\Tailscale, on Linux it creates
	// /var/lib/tailscale). Point it at our own state folder so nothing is made outside the app's
	// files. (The folder exists by then: tsnet creates it first.)
	_ = os.Setenv("TS_LOGS_DIR", config.StateDir)

	server := &tsnet.Server{
		Dir:      config.StateDir,
		Hostname: Hostname(config.PlayerID),
		UserLogf: func(string, ...any) {}, // the status line on the page says what matters

		ControlURL:    config.controlURL,
		AdvertiseTags: config.advertiseTags,
	}
	if config.Debug {
		server.UserLogf = log.Printf
		server.Logf = log.Printf
	}
	transport := &TsnetTransport{config: config, server: server}
	transport.client = newPeerHTTPClient(server.Dial)
	return transport
}

// Name is "tsnet".
func (transport *TsnetTransport) Name() string { return "tsnet" }

// Up starts the node. Joining (with an invite code) waits until the tailnet has accepted it.
// Resuming after a restart returns at once; without a node key in the state folder it refuses
// to start (tsnet would otherwise wait for an interactive log-in, retrying every few seconds).
func (transport *TsnetTransport) Up(ctx context.Context, isJoining bool) error {
	if !isJoining && !fileExists(filepath.Join(transport.config.StateDir, tsnetStateFile)) {
		return errNotLoggedIn
	}
	transport.mutex.Lock()
	transport.isStarted = true
	transport.mutex.Unlock()

	if !isJoining {
		return transport.server.Start()
	}
	transport.server.AuthKey = transport.config.AuthKey
	_, err := transport.server.Up(ctx)
	transport.server.AuthKey = "" // used once; the node key in the state folder is enough from now on
	transport.config.AuthKey = ""
	if err != nil {
		return fmt.Errorf("joining the squad network: %w", err)
	}
	return nil
}

// Listen opens the peer API on the tailnet only, at :7777.
func (transport *TsnetTransport) Listen() (net.Listener, error) {
	return transport.server.Listen("tcp", ":"+strconv.Itoa(PeerAPIPort))
}

// IsCallerAllowed asks the tailnet who is calling: only nodes tagged tag:stm.
func (transport *TsnetTransport) IsCallerAllowed(ctx context.Context, remoteAddr string) bool {
	localClient, err := transport.server.LocalClient()
	if err != nil {
		return false
	}
	who, err := localClient.WhoIs(ctx, remoteAddr)
	if err != nil || who == nil || who.Node == nil {
		return false
	}
	return HasSquadTag(who.Node.Tags)
}

// Client reaches friends through the tailnet.
func (transport *TsnetTransport) Client() *http.Client { return transport.client }

// WatchPeers follows the tailnet's IPN bus (event-driven, no polling): each change of state or of
// the peer list re-reads the peer list. If the bus watch drops, it is opened again with the same
// 1 s → 60 s backoff as friends' streams.
//
// Goroutine note: runs on the goroutine the squad session starts for it; returns when ctx ends.
func (transport *TsnetTransport) WatchPeers(ctx context.Context, onPeers PeersFound, onState StateChanged) {
	failuresInARow := 0
	for ctx.Err() == nil {
		hadEvents, loggedOut := transport.watchBusOnce(ctx, onPeers, onState)
		if loggedOut {
			// Signed out by the tailnet: stop the node so it doesn't keep asking for a log-in.
			_ = transport.Close()
			<-ctx.Done()
			return
		}
		if hadEvents {
			failuresInARow = 0
		}
		failuresInARow++
		if !sleepOrDone(ctx, RetryDelay(failuresInARow)) {
			return
		}
	}
}

// watchBusOnce reads the bus until it ends. hadEvents: at least one message arrived;
// loggedOut: the tailnet says this node must log in again.
func (transport *TsnetTransport) watchBusOnce(
	ctx context.Context, onPeers PeersFound, onState StateChanged,
) (hadEvents, loggedOut bool) {
	localClient, err := transport.server.LocalClient()
	if err != nil {
		onState(StateError, err.Error())
		return false, false
	}
	watcher, err := localClient.WatchIPNBus(ctx, ipn.NotifyInitialState|ipn.NotifyPeerChanges)
	if err != nil {
		return false, false
	}
	defer watcher.Close()

	isRunning := false
	for {
		notification, err := watcher.Next()
		if err != nil {
			return hadEvents, false
		}
		hadEvents = true
		if notification.State != nil {
			state := stateFromBackend(*notification.State)
			if state == StateNeedsLogin {
				onPeers(nil)
				onState(StateNeedsLogin, "")
				return true, true
			}
			isRunning = state == StateConnected
			onState(state, "")
		}
		if isRunning && changesPeerList(notification) {
			transport.reportPeers(ctx, onPeers)
		}
	}
}

// changesPeerList: the notification may have changed who is online.
func changesPeerList(notification ipn.Notify) bool {
	return notification.State != nil || len(notification.PeersChanged) > 0 ||
		len(notification.PeersRemoved) > 0 || notification.SelfChange != nil
}

// reportPeers reads the tailnet's peer list and passes on the squad's online nodes.
func (transport *TsnetTransport) reportPeers(ctx context.Context, onPeers PeersFound) {
	localClient, err := transport.server.LocalClient()
	if err != nil {
		return
	}
	status, err := localClient.Status(ctx)
	if err != nil {
		return
	}
	onPeers(SquadPeers(tailnetPeersFromStatus(status), transport.config.PlayerID))
}

func tailnetPeersFromStatus(status *ipnstate.Status) []TailnetPeer {
	var peers []TailnetPeer
	for _, peer := range status.Peer {
		var tags []string
		if peer.Tags != nil {
			tags = peer.Tags.AsSlice()
		}
		peers = append(peers, TailnetPeer{
			HostName:  peer.HostName,
			DNSName:   peer.DNSName,
			Tags:      tags,
			IsOnline:  peer.Online,
			Addresses: peer.TailscaleIPs,
		})
	}
	return peers
}

// stateFromBackend turns Tailscale's backend state into the squad's.
func stateFromBackend(state ipn.State) string {
	switch state {
	case ipn.Running:
		return StateConnected
	case ipn.NeedsLogin, ipn.NeedsMachineAuth:
		return StateNeedsLogin
	default:
		return StateStarting
	}
}

// Logout signs the node out of the tailnet (it disappears from the admin console's online list).
// Does nothing when the node never started.
func (transport *TsnetTransport) Logout(ctx context.Context) error {
	transport.mutex.Lock()
	canLogOut := transport.isStarted && !transport.isClosed
	transport.mutex.Unlock()
	if !canLogOut {
		return nil
	}
	localClient, err := transport.server.LocalClient()
	if err != nil {
		return err
	}
	return localClient.Logout(ctx)
}

// Close stops the node (once).
func (transport *TsnetTransport) Close() error {
	transport.mutex.Lock()
	shouldClose := transport.isStarted && !transport.isClosed
	transport.isClosed = true
	transport.mutex.Unlock()
	if !shouldClose {
		return nil
	}
	return transport.server.Close()
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
