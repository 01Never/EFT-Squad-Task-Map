package main

// Test nodes: plain tsnet nodes this tool runs on its own tailnet, for the checks an app copy
// can't do by itself: an intruder with an untagged invite code reading a copy's peer API, a tagged
// node that calls itself like an existing friend, and a witness that shows how packets travel
// (direct or through the relay). Each one is a real Tailscale node in this process.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"squadtaskmap/internal/features/squad"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tailcfg"
	"tailscale.com/tsnet"
)

// testNodeJoinTimeout: how long starting a test node may take.
const testNodeJoinTimeout = 60 * time.Second

// testNodeRequestTimeout: a request from a test node gives up after this (a policy that drops the
// packets shows as a timeout: "refused by the tailnet").
const testNodeRequestTimeout = 5 * time.Second

// testNode is one running test node.
type testNode struct {
	hostName string
	server   *tsnet.Server
	listener net.Listener // its own peer API, when it pretends to be a copy
}

// testNodes runs and stops test nodes. Their state lives in a temporary folder.
type testNodes struct {
	controlURL string
	stateRoot  string

	mutex sync.Mutex
	nodes map[string]*testNode
}

// testNodeRequest is POST /admin/test-nodes.
type testNodeRequest struct {
	HostName   string `json:"hostName"`
	InviteCode string `json:"inviteCode"`
	// ServeShare, when set, is answered on its own :7777 at /squad/v1/share and as one event on
	// /squad/v1/stream: an impostor's share.
	ServeShare json.RawMessage `json:"serveShare,omitempty"`
}

func (nodes *testNodes) start(request testNodeRequest) (map[string]any, error) {
	if request.HostName == "" {
		return nil, errors.New("hostName is required")
	}
	nodes.mutex.Lock()
	_, exists := nodes.nodes[request.HostName]
	nodes.mutex.Unlock()
	if exists {
		return nil, fmt.Errorf("a test node %q is already running", request.HostName)
	}
	server := &tsnet.Server{
		Dir:        filepath.Join(nodes.stateRoot, request.HostName),
		Hostname:   request.HostName,
		AuthKey:    request.InviteCode,
		ControlURL: nodes.controlURL,
		Ephemeral:  false,
		Logf:       func(string, ...any) {},
		UserLogf:   func(string, ...any) {},
	}
	ctx, cancel := context.WithTimeout(context.Background(), testNodeJoinTimeout)
	defer cancel()
	status, err := server.Up(ctx)
	if err != nil {
		reason := joinFailureReason(server, err)
		server.Close()
		return nil, errors.New(reason)
	}
	node := &testNode{hostName: request.HostName, server: server}
	if len(request.ServeShare) > 0 {
		if err := node.serveShare(request.ServeShare); err != nil {
			server.Close()
			return nil, err
		}
	}
	nodes.mutex.Lock()
	nodes.nodes[request.HostName] = node
	nodes.mutex.Unlock()
	var addresses []string
	for _, address := range status.TailscaleIPs {
		addresses = append(addresses, address.String())
	}
	return map[string]any{"hostName": request.HostName, "addresses": addresses}, nil
}

// joinFailureReason: Tailscale's own reason from its health messages, like the app reports it.
func joinFailureReason(server *tsnet.Server, upError error) string {
	localClient, err := server.LocalClient()
	if err != nil {
		return upError.Error()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	status, err := localClient.StatusWithoutPeers(ctx)
	if err != nil || len(status.Health) == 0 {
		return upError.Error()
	}
	return fmt.Sprint(status.Health)
}

// serveShare answers like a copy's peer API with a fixed share (no checks: it is the impostor).
//
// Goroutine note: the HTTP server runs until the node is stopped (its listener closes).
func (node *testNode) serveShare(share json.RawMessage) error {
	listener, err := node.server.Listen("tcp", ":"+strconv.Itoa(squad.PeerAPIPort))
	if err != nil {
		return err
	}
	node.listener = listener
	mux := http.NewServeMux()
	mux.HandleFunc("/squad/v1/share", func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		writer.Write(share)
	})
	mux.HandleFunc("/squad/v1/stream", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(writer, ": squad\n\nevent: share\ndata: %s\n\n", share)
		writer.(http.Flusher).Flush()
		<-request.Context().Done()
	})
	go http.Serve(listener, mux)
	return nil
}

// fetchResult is POST /admin/test-nodes/{name}/fetch's answer.
type fetchResult struct {
	Status int    `json:"status"` // 0 when there was no answer
	Body   string `json:"body"`   // the first 2000 bytes
	Error  string `json:"error"`  // e.g. a timeout when the policy drops the packets
}

// fetch makes a GET from a test node through the tailnet.
func (nodes *testNodes) fetch(hostName, url string) (fetchResult, error) {
	node, err := nodes.named(hostName)
	if err != nil {
		return fetchResult{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), testNodeRequestTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fetchResult{}, err
	}
	response, err := node.server.HTTPClient().Do(request)
	if err != nil {
		return fetchResult{Error: err.Error()}, nil
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 2000))
	return fetchResult{Status: response.StatusCode, Body: string(body)}, nil
}

// peerPath is one row of GET /admin/test-nodes/{name}/paths: how this node reaches a peer.
type peerPath struct {
	DNSName string `json:"dnsName"`
	Online  bool   `json:"online"`
	Direct  string `json:"direct"` // the direct address in use; "" = through the relay
	Relay   string `json:"relay"`  // the relay region it uses
	RxBytes int64  `json:"rxBytes"`
	TxBytes int64  `json:"txBytes"`
	// Ping: a TSMP ping (through WireGuard, like data): "answered in 1.2 ms", or why not.
	Ping string `json:"ping"`
}

// paths reports how a test node reaches each peer it sees, after a TSMP ping to each (a ping
// through WireGuard: it travels the same way as data).
func (nodes *testNodes) paths(hostName string) ([]peerPath, error) {
	node, err := nodes.named(hostName)
	if err != nil {
		return nil, err
	}
	localClient, err := node.server.LocalClient()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	status, err := localClient.Status(ctx)
	if err != nil {
		return nil, err
	}
	var rows []peerPath
	for _, peer := range status.Peer {
		row := peerPath{DNSName: peer.DNSName, Online: peer.Online}
		row.Ping = pingThroughWireGuard(ctx, localClient.Ping, peer)
		rows = append(rows, row)
	}
	// Read again after the pings: they set up the paths.
	status, err = localClient.Status(ctx)
	if err == nil {
		for index := range rows {
			for _, peer := range status.Peer {
				if peer.DNSName == rows[index].DNSName {
					rows[index].Direct, rows[index].Relay = peer.CurAddr, peer.Relay
					rows[index].RxBytes, rows[index].TxBytes = peer.RxBytes, peer.TxBytes
				}
			}
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].DNSName < rows[j].DNSName })
	return rows, nil
}

type pingFunction func(context.Context, netip.Addr, tailcfg.PingType) (*ipnstate.PingResult, error)

func pingThroughWireGuard(
	ctx context.Context, ping pingFunction, peer *ipnstate.PeerStatus,
) string {
	if len(peer.TailscaleIPs) == 0 {
		return "no address"
	}
	pingContext, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	result, err := ping(pingContext, peer.TailscaleIPs[0], tailcfg.PingTSMP)
	if err != nil {
		return err.Error()
	}
	if result.Err != "" {
		return result.Err
	}
	return fmt.Sprintf("answered in %.1f ms", result.LatencySeconds*1000)
}

func (nodes *testNodes) named(hostName string) (*testNode, error) {
	nodes.mutex.Lock()
	defer nodes.mutex.Unlock()
	node := nodes.nodes[hostName]
	if node == nil {
		return nil, fmt.Errorf("no test node %q", hostName)
	}
	return node, nil
}

// stop closes a test node and returns its machine's name (the first part of its MagicDNS name),
// so the caller can delete the machine too.
func (nodes *testNodes) stop(hostName string) (machineName string, err error) {
	node, err := nodes.named(hostName)
	if err != nil {
		return "", err
	}
	nodes.mutex.Lock()
	delete(nodes.nodes, hostName)
	nodes.mutex.Unlock()
	machineName = machineNameOf(node.server)
	if node.listener != nil {
		node.listener.Close()
	}
	node.server.Close()
	return machineName, os.RemoveAll(filepath.Join(nodes.stateRoot, hostName))
}

func machineNameOf(server *tsnet.Server) string {
	localClient, err := server.LocalClient()
	if err != nil {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	status, err := localClient.StatusWithoutPeers(ctx)
	if err != nil || status.Self == nil {
		return ""
	}
	name, _, _ := strings.Cut(status.Self.DNSName, ".")
	return name
}

func (nodes *testNodes) stopAll() {
	nodes.mutex.Lock()
	var names []string
	for name := range nodes.nodes {
		names = append(names, name)
	}
	nodes.mutex.Unlock()
	for _, name := range names {
		_, _ = nodes.stop(name)
	}
}
