package squad

// How this copy reaches friends' copies. Two transports do the same job:
//   - tsnet (tsnet.go): the real one, a Tailscale node inside the exe;
//   - dev (this file): plain TCP on 127.0.0.1 ports, for tests and for trying three copies on one
//     PC (STM_SQUAD_DEV_LISTEN, STM_SQUAD_DEV_PEERS). No tsnet at all.
// internal/app picks one.

import (
	"context"
	"net"
	"net/http"
	"strings"
	"time"
)

// Transport is a way to listen for friends and to reach them.
type Transport interface {
	// Name is "tsnet" or "dev" (shown on the page).
	Name() string
	// Up brings the transport up. When joining with an invite code it waits until the node is
	// logged in (or ctx ends); otherwise it returns at once and the state follows in WatchPeers.
	Up(ctx context.Context, isJoining bool) error
	// Listen opens the peer API listener (never the page's 127.0.0.1 server).
	Listen() (net.Listener, error)
	// IsCallerAllowed checks who sent a request to the peer API.
	IsCallerAllowed(ctx context.Context, remoteAddr string) bool
	// Client is the HTTP client that reaches friends.
	Client() *http.Client
	// WatchPeers reports the friends to connect to, and the connection state, whenever either
	// changes. It blocks until ctx ends.
	WatchPeers(ctx context.Context, onPeers PeersFound, onState StateChanged)
	// Logout signs this node out of the tailnet (Leave squad).
	Logout(ctx context.Context) error
	// Close stops everything the transport started.
	Close() error
}

// PeersFound receives the friends to connect to: the whole current list, each time it changes.
type PeersFound func(peers []PeerAddress)

// StateChanged receives the connection state (StateConnected, …) and, for StateError, the problem.
type StateChanged func(state, problem string)

// peerFetchTimeout limits a GET /squad/v1/share and the wait for a stream's first answer.
const peerFetchTimeout = 15 * time.Second

// newPeerHTTPClient is the client that reaches friends: how to dial (nil = the normal network) and
// a limit on waiting for an answer's headers, but none on how long a stream stays open.
func newPeerHTTPClient(
	dial func(ctx context.Context, network, address string) (net.Conn, error),
) *http.Client {
	return &http.Client{Transport: &http.Transport{
		DialContext:           dial,
		ResponseHeaderTimeout: peerFetchTimeout,
		MaxIdleConnsPerHost:   2,
		IdleConnTimeout:       90 * time.Second,
	}}
}

// ---------------------------------------------------------------- the dev transport

// DevTransport serves the peer API on a 127.0.0.1 port and connects to a fixed list of local ports.
// A friend's identity comes from the player id in its share.
type DevTransport struct {
	listenAddress string
	peers         []string
	client        *http.Client
}

// NewDevTransport: listen on listenAddress (e.g. "127.0.0.1:7901") and connect to each of
// peerAddresses ("127.0.0.1:7902"). Our own address is left out of the list.
func NewDevTransport(listenAddress string, peerAddresses []string) *DevTransport {
	var peers []string
	for _, address := range peerAddresses {
		address = strings.TrimSpace(address)
		if address != "" && address != listenAddress {
			peers = append(peers, address)
		}
	}
	return &DevTransport{listenAddress: listenAddress, peers: peers, client: newPeerHTTPClient(nil)}
}

// ParseDevPeers splits STM_SQUAD_DEV_PEERS ("127.0.0.1:7902,127.0.0.1:7903").
func ParseDevPeers(list string) []string {
	var peers []string
	for _, address := range strings.Split(list, ",") {
		if trimmed := strings.TrimSpace(address); trimmed != "" {
			peers = append(peers, trimmed)
		}
	}
	return peers
}

// Name is "dev".
func (transport *DevTransport) Name() string { return "dev" }

// Up has nothing to start.
func (transport *DevTransport) Up(context.Context, bool) error { return nil }

// Listen opens the listen address, which must be on this PC.
func (transport *DevTransport) Listen() (net.Listener, error) {
	return net.Listen("tcp", transport.listenAddress)
}

// IsCallerAllowed: only this PC.
func (transport *DevTransport) IsCallerAllowed(_ context.Context, remoteAddr string) bool {
	return IsLoopbackCaller(remoteAddr)
}

// Client is a plain HTTP client.
func (transport *DevTransport) Client() *http.Client { return transport.client }

// WatchPeers reports the fixed list once and the state "connected", then waits for ctx.
func (transport *DevTransport) WatchPeers(ctx context.Context, onPeers PeersFound, onState StateChanged) {
	var peers []PeerAddress
	for _, address := range transport.peers {
		peers = append(peers, PeerAddress{Key: address, BaseURL: "http://" + address})
	}
	onState(StateConnected, "")
	onPeers(peers)
	<-ctx.Done()
}

// Logout has nothing to sign out of.
func (transport *DevTransport) Logout(context.Context) error { return nil }

// Close closes idle connections.
func (transport *DevTransport) Close() error {
	transport.client.CloseIdleConnections()
	return nil
}
