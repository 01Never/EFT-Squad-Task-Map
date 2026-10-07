package main

// The fake coordination server: Tailscale's own test control server (testcontrol: the Noise
// handshake, registering nodes, addresses, the base of each map response) with this tool's rules
// on top, through testcontrol's two hooks:
//   - MaybeRejectRequest sees every register request first: invite codes, tags, unique names,
//     log-outs (rules.go: DecideRegistration);
//   - AltMapStream serves every map poll: who is online (a node with an open map stream), who
//     sees whom and the packet filter (the ACL), deleted and expired machines, relay-only.

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/netip"
	"slices"
	"sort"
	"sync"
	"time"

	"squadtaskmap/internal/features/squad"
	"tailscale.com/tailcfg"
	"tailscale.com/tstest/integration/testcontrol"
	"tailscale.com/types/key"
)

// mapKeepAlive: how often an idle map stream gets a keep-alive (Tailscale's clients drop a stream
// that is silent for 2 minutes; testcontrol uses 50–58 s).
const mapKeepAlive = 50 * time.Second

// machine is one node as the admin console shows it.
type machine struct {
	nodeKey     key.NodePublic
	hostName    string   // what the node asked to be called
	dnsLabel    string   // its MagicDNS name's first part, unique in the tailnet
	tags        []string // from its invite code
	inviteCode  string   // which code it joined with
	createdAt   time.Time
	openStreams int       // map streams open right now: online while > 0
	lastSeen    time.Time // when its last map stream closed
	isLoggedOut bool      // it logged out (Leave); stays listed until deleted
	isExpired   bool      // its key was expired in the console
	isDeleted   bool      // deleted in the console: gone from every list
}

func (node *machine) isOnline() bool { return node.openStreams > 0 && !node.isDeleted }

// tailnetSettings are what the admin API can change while it runs.
type tailnetSettings struct {
	ACL string `json:"acl"` // ACLSquadOnly or ACLOpen
	// RelayOnly: no direct paths: map responses carry no endpoints and the relay drops disco
	// messages. Applies to paths made after it is switched on (restart the copies).
	RelayOnly bool `json:"relayOnly"`
	// LogoutRemovesMachine: a node that logs out disappears from the console (else it stays listed
	// as logged out, keeping its name, until deleted). Tailscale's real behaviour is to be checked.
	LogoutRemovesMachine bool `json:"logoutRemovesMachine"`
}

// tailnet is the fake tailnet: the control server, its machines and settings.
type tailnet struct {
	control *testcontrol.Server

	mutex    sync.Mutex
	machines map[key.NodePublic]*machine
	settings tailnetSettings
	changed  chan struct{} // closed (and replaced) whenever anything a map shows may have changed
}

func newTailnet(derpMap *tailcfg.DERPMap, baseURL string) *tailnet {
	network := &tailnet{
		machines: map[key.NodePublic]*machine{},
		settings: tailnetSettings{ACL: ACLSquadOnly},
		changed:  make(chan struct{}),
	}
	network.control = &testcontrol.Server{
		DERPMap:            derpMap,
		MagicDNSDomain:     MagicDNSDomain,
		ExplicitBaseURL:    baseURL,
		Logf:               func(string, ...any) {},
		MaybeRejectRequest: network.checkRequest,
		AltMapStream:       network.serveMapStream,
	}
	return network
}

// noteChangeLocked wakes every open map stream (each sends a fresh map). mutex held.
func (network *tailnet) noteChangeLocked() {
	close(network.changed)
	network.changed = make(chan struct{})
}

func (network *tailnet) noteChange() {
	network.mutex.Lock()
	defer network.mutex.Unlock()
	network.noteChangeLocked()
}

// ---------------------------------------------------------------- register requests

// checkRequest runs before testcontrol handles a request inside the Noise channel. Only register
// requests are looked at; anything else goes on. A non-zero status answers the request instead.
func (network *tailnet) checkRequest(request *http.Request) (status int, retryAfter, body string) {
	if request.URL.Path != "/machine/register" {
		return 0, "", ""
	}
	raw, err := io.ReadAll(io.LimitReader(request.Body, 1<<20))
	request.Body.Close()
	request.Body = io.NopCloser(bytes.NewReader(raw)) // testcontrol reads it again
	if err != nil {
		return http.StatusBadRequest, "", "unreadable register request"
	}
	var register tailcfg.RegisterRequest
	if err := json.Unmarshal(raw, &register); err != nil {
		return http.StatusBadRequest, "", "unreadable register request"
	}
	if register.Followup != "" {
		// A node waiting for an interactive log-in: nobody ever logs in here.
		<-request.Context().Done()
		return http.StatusGatewayTimeout, "", "no interactive log-in on the fake tailnet"
	}
	return network.register(register)
}

// register applies DecideRegistration. Refusals are answered here with a RegisterResponse (status
// 200 with JSON, as Tailscale does); accepted requests go on to testcontrol.
func (network *tailnet) register(
	register tailcfg.RegisterRequest,
) (status int, retryAfter, body string) {
	inviteCode := ""
	if register.Auth != nil {
		inviteCode = register.Auth.AuthKey
	}
	network.mutex.Lock()
	defer network.mutex.Unlock()
	known := network.machines[register.NodeKey]
	isKnown := known != nil && !known.isDeleted
	now := time.Now()
	decision := DecideRegistration(isKnown, inviteCode, register.Expiry, now)
	switch decision.Kind {
	case RegisterRefused:
		return http.StatusOK, "", registerAnswer(tailcfg.RegisterResponse{Error: decision.Refusal})
	case RegisterNeedsLogin:
		logInPage := network.control.BaseURL() + "/auth/no-interactive-login"
		answer := tailcfg.RegisterResponse{AuthURL: logInPage}
		return http.StatusOK, "", registerAnswer(answer)
	case RegisterLogout:
		known.isLoggedOut = true
		if network.settings.LogoutRemovesMachine {
			known.isDeleted = true
		}
		network.noteChangeLocked()
	case RegisterNewNode:
		hostName := ""
		if register.Hostinfo != nil {
			hostName = register.Hostinfo.Hostname
		}
		network.machines[register.NodeKey] = &machine{
			nodeKey:    register.NodeKey,
			hostName:   hostName,
			dnsLabel:   DNSLabelFor(hostName, network.takenLabelsLocked()),
			tags:       decision.Tags,
			inviteCode: inviteCode,
			createdAt:  now,
		}
		network.noteChangeLocked()
	}
	return 0, "", ""
}

func registerAnswer(answer tailcfg.RegisterResponse) string {
	encoded, _ := json.Marshal(answer)
	return string(encoded)
}

// takenLabelsLocked: the names of every machine not deleted. mutex held.
func (network *tailnet) takenLabelsLocked() map[string]bool {
	taken := map[string]bool{}
	for _, node := range network.machines {
		if !node.isDeleted {
			taken[node.dnsLabel] = true
		}
	}
	return taken
}

// ---------------------------------------------------------------- map polls

// serveMapStream answers one map poll (testcontrol has already sent the 200 header).
// Non-streaming polls carry the node's endpoints, disco key and host info: they're stored and
// every stream is woken. A streaming poll makes the node online until it ends.
//
// Goroutine note: runs on the HTTP/2 handler goroutine of the poll; returns when the node closes
// the poll (ctx) or the node is gone.
func (network *tailnet) serveMapStream(
	ctx context.Context, writer testcontrol.MapStreamWriter, request *tailcfg.MapRequest,
) {
	if !network.isActiveNode(request.NodeKey) {
		return
	}
	isStreaming := request.Stream && !request.ReadOnly
	carriesUpdate := !request.ReadOnly && !request.Stream
	if carriesUpdate {
		network.storeNodeUpdate(request)
	}
	if request.OmitPeers && !isStreaming {
		return // an update only: the client doesn't read an answer
	}
	if !isStreaming {
		network.sendMap(writer, request)
		return
	}
	network.streamOpened(request.NodeKey)
	defer network.streamClosed(request.NodeKey)
	for {
		changed := network.changeSignal()
		if err := network.sendMap(writer, request); err != nil {
			return
		}
		if !network.waitForChange(ctx, writer, changed) {
			return
		}
	}
}

// waitForChange blocks until something changed (true) or the poll ended (false), sending
// keep-alives meanwhile.
func (network *tailnet) waitForChange(
	ctx context.Context, writer testcontrol.MapStreamWriter, changed <-chan struct{},
) bool {
	keepAlive := time.NewTicker(mapKeepAlive)
	defer keepAlive.Stop()
	for {
		select {
		case <-ctx.Done():
			return false
		case <-changed:
			return true
		case <-keepAlive.C:
			if err := writer.SendMapMessage(&tailcfg.MapResponse{KeepAlive: true}); err != nil {
				return false
			}
		}
	}
}

func (network *tailnet) changeSignal() <-chan struct{} {
	network.mutex.Lock()
	defer network.mutex.Unlock()
	return network.changed
}

func (network *tailnet) isActiveNode(nodeKey key.NodePublic) bool {
	network.mutex.Lock()
	defer network.mutex.Unlock()
	node := network.machines[nodeKey]
	return node != nil && !node.isDeleted && network.control.Node(nodeKey) != nil
}

// storeNodeUpdate keeps what a node reports about itself (testcontrol would, without AltMapStream).
func (network *tailnet) storeNodeUpdate(request *tailcfg.MapRequest) {
	network.mutex.Lock()
	defer network.mutex.Unlock()
	node := network.control.Node(request.NodeKey)
	if node == nil {
		return
	}
	node.Endpoints = slices.Clone(request.Endpoints)
	node.DiscoKey = request.DiscoKey
	node.Cap = request.Version
	if request.Hostinfo != nil {
		node.Hostinfo = request.Hostinfo.View()
		if netInfo := request.Hostinfo.NetInfo; netInfo != nil && netInfo.PreferredDERP != 0 {
			node.HomeDERP = netInfo.PreferredDERP
		}
	}
	network.control.UpdateNode(node)
	network.noteChangeLocked()
}

func (network *tailnet) streamOpened(nodeKey key.NodePublic) {
	network.mutex.Lock()
	defer network.mutex.Unlock()
	if node := network.machines[nodeKey]; node != nil {
		node.openStreams++
	}
	network.noteChangeLocked()
}

func (network *tailnet) streamClosed(nodeKey key.NodePublic) {
	network.mutex.Lock()
	defer network.mutex.Unlock()
	if node := network.machines[nodeKey]; node != nil {
		node.openStreams--
		node.lastSeen = time.Now()
	}
	network.noteChangeLocked()
}

// sendMap sends this node's whole map: testcontrol's, with this tool's rules applied.
func (network *tailnet) sendMap(
	writer testcontrol.MapStreamWriter, request *tailcfg.MapRequest,
) error {
	response, err := network.control.MapResponse(request)
	if err != nil || response == nil {
		return io.EOF
	}
	network.applyRules(response)
	return writer.SendMapMessage(response)
}

// applyRules turns testcontrol's map (every node sees every node, all traffic allowed) into this
// tailnet's: names, tags, online state, deleted and expired machines, who sees whom, the packet
// filter, and no endpoints in relay-only mode.
func (network *tailnet) applyRules(response *tailcfg.MapResponse) {
	network.mutex.Lock()
	defer network.mutex.Unlock()
	self := network.machines[response.Node.Key]
	if self == nil {
		return
	}
	network.describeNodeLocked(response.Node, self)
	response.Node.Online = nil
	var peers []*tailcfg.Node
	for _, peer := range response.Peers {
		peerMachine := network.machines[peer.Key]
		if peerMachine == nil || peerMachine.isDeleted {
			continue
		}
		if !CanSeeEachOther(network.settings.ACL, self.tags, peerMachine.tags) {
			continue
		}
		network.describeNodeLocked(peer, peerMachine)
		if network.settings.RelayOnly {
			peer.Endpoints = nil
		}
		peers = append(peers, peer)
	}
	response.Peers = peers
	squadSources := network.squadAddressesLocked()
	response.PacketFilter = PacketFilterFor(network.settings.ACL, self.tags, squadSources)
	// testcontrol says it's 2020; clients compare key expiries with the control server's time.
	now := time.Now()
	response.ControlTime = &now
}

// describeNodeLocked writes a machine's name, tags, online state and expiry into a map entry.
func (network *tailnet) describeNodeLocked(node *tailcfg.Node, about *machine) {
	node.Name = MagicDNSName(about.dnsLabel)
	node.Tags = slices.Clone(about.tags)
	online := about.isOnline() && !about.isLoggedOut && !about.isExpired
	node.Online = &online
	if !about.lastSeen.IsZero() && !online {
		lastSeen := about.lastSeen
		node.LastSeen = &lastSeen
	}
	if about.isLoggedOut || about.isExpired {
		node.Expired = true
		node.KeyExpiry = time.Now().Add(-time.Minute)
	}
}

// squadAddressesLocked: the tailnet addresses of every tag:stm machine (the ACL's sources).
func (network *tailnet) squadAddressesLocked() []netip.Prefix {
	var addresses []netip.Prefix
	for _, node := range network.control.AllNodes() {
		about := network.machines[node.Key]
		if about == nil || about.isDeleted || !squad.HasSquadTag(about.tags) {
			continue
		}
		addresses = append(addresses, node.Addresses...)
	}
	sort.Slice(addresses, func(i, j int) bool { return addresses[i].String() < addresses[j].String() })
	return addresses
}

// ---------------------------------------------------------------- the admin console's actions

// machineView is one row of the admin console's machine list.
type machineView struct {
	ID         string    `json:"id"`        // stable node id
	Name       string    `json:"name"`      // MagicDNS name's first part ("stm-<id>", "stm-<id>-1")
	DNSName    string    `json:"dnsName"`   // full MagicDNS name
	HostName   string    `json:"hostName"`  // what the node asked to be called
	Tags       []string  `json:"tags"`      // e.g. ["tag:stm"]
	Online     bool      `json:"online"`    // has an open map stream
	LoggedOut  bool      `json:"loggedOut"` // logged out (still listed)
	Expired    bool      `json:"expired"`   // key expired in the console
	Addresses  []string  `json:"addresses"` // tailnet addresses
	InviteCode string    `json:"inviteCode"`
	Created    time.Time `json:"created"`
	LastSeen   time.Time `json:"lastSeen,omitzero"`
}

// listMachines: every machine that isn't deleted, oldest first.
func (network *tailnet) listMachines() []machineView {
	network.mutex.Lock()
	defer network.mutex.Unlock()
	views := []machineView{}
	for _, node := range network.control.AllNodes() {
		about := network.machines[node.Key]
		if about == nil || about.isDeleted {
			continue
		}
		var addresses []string
		for _, prefix := range node.Addresses {
			addresses = append(addresses, prefix.Addr().String())
		}
		views = append(views, machineView{
			ID: string(node.StableID), Name: about.dnsLabel, DNSName: MagicDNSName(about.dnsLabel),
			HostName: about.hostName, Tags: slices.Clone(about.tags), Online: about.isOnline(),
			LoggedOut: about.isLoggedOut, Expired: about.isExpired, Addresses: addresses,
			InviteCode: about.inviteCode, Created: about.createdAt, LastSeen: about.lastSeen,
		})
	}
	sort.Slice(views, func(i, j int) bool { return views[i].Created.Before(views[j].Created) })
	return views
}

// errNoSuchMachine: no machine (not deleted) has that id or name.
var errNoSuchMachine = errorText("no such machine")

type errorText string

func (text errorText) Error() string { return string(text) }

// signOutMachine deletes a machine (isDeletion) or expires its key, as in the admin console. Either
// way its key stops working: its own map says so (the node goes to "needs log-in") and a register
// with that key answers "node key expired".
func (network *tailnet) signOutMachine(idOrName string, isDeletion bool) error {
	network.mutex.Lock()
	defer network.mutex.Unlock()
	for _, node := range network.control.AllNodes() {
		about := network.machines[node.Key]
		if about == nil || about.isDeleted {
			continue
		}
		if string(node.StableID) != idOrName && about.dnsLabel != idOrName {
			continue
		}
		if isDeletion {
			about.isDeleted = true
		} else {
			about.isExpired = true
		}
		node.KeyExpiry = time.Now().Add(-time.Minute)
		network.control.UpdateNode(node)
		network.noteChangeLocked()
		return nil
	}
	return errNoSuchMachine
}

func (network *tailnet) currentSettings() tailnetSettings {
	network.mutex.Lock()
	defer network.mutex.Unlock()
	return network.settings
}

func (network *tailnet) changeSettings(change func(*tailnetSettings)) tailnetSettings {
	network.mutex.Lock()
	defer network.mutex.Unlock()
	change(&network.settings)
	network.noteChangeLocked()
	return network.settings
}

// nodeNameByKey: the machine's name for a node key (for the relay's counters); "" if unknown.
func (network *tailnet) nodeNameByKey(nodeKey key.NodePublic) string {
	network.mutex.Lock()
	defer network.mutex.Unlock()
	if about := network.machines[nodeKey]; about != nil {
		return about.dnsLabel
	}
	return ""
}
