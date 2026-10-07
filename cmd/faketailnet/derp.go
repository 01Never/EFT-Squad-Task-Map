package main

// The relay (DERP, Tailscale's own server from tailscale.com/derp/derpserver) and a STUN server,
// both on 127.0.0.1. Every relay connection is read through relayFilter, which counts what each
// node sends through the relay and, in relay-only mode, drops disco messages (rules.go:
// ShouldRelayFrame).

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"sort"
	"sync"

	"tailscale.com/derp/derpserver"
	"tailscale.com/net/stun"
	"tailscale.com/tailcfg"
	"tailscale.com/types/key"
)

// relayCounters: what went through the relay, by sender → receiver, since the start.
type relayCounters struct {
	mutex          sync.Mutex
	dataPackets    map[[2]key.NodePublic]int // WireGuard packets relayed
	dataBytes      map[[2]key.NodePublic]int
	discoRelayed   int // disco messages relayed (normal mode)
	discoDropped   int // disco messages dropped (relay-only mode)
	isRelayOnly    func() bool
	nodeNameForKey func(key.NodePublic) string
}

func newRelayCounters() *relayCounters {
	return &relayCounters{
		dataPackets:    map[[2]key.NodePublic]int{},
		dataBytes:      map[[2]key.NodePublic]int{},
		isRelayOnly:    func() bool { return false },
		nodeNameForKey: func(key.NodePublic) string { return "" },
	}
}

// relayPairView is one row of GET /admin/relay.
type relayPairView struct {
	From    string `json:"from"` // machine names
	To      string `json:"to"`
	Packets int    `json:"packets"` // WireGuard packets relayed
	Bytes   int    `json:"bytes"`
}

// relayView is GET /admin/relay.
type relayView struct {
	Pairs        []relayPairView `json:"pairs"`
	DiscoRelayed int             `json:"discoRelayed"`
	DiscoDropped int             `json:"discoDropped"`
}

func (counters *relayCounters) count(
	from key.NodePublic, frameType byte, payload []byte, isRelayed bool,
) {
	if frameType != derpFrameSendPacket || len(payload) < derpKeyBytes {
		return
	}
	counters.mutex.Lock()
	defer counters.mutex.Unlock()
	packet := payload[derpKeyBytes:]
	if IsDiscoPacket(packet) {
		if isRelayed {
			counters.discoRelayed++
		} else {
			counters.discoDropped++
		}
		return
	}
	to := nodeKeyFromBytes(payload[:derpKeyBytes])
	pair := [2]key.NodePublic{from, to}
	counters.dataPackets[pair]++
	counters.dataBytes[pair] += len(packet)
}

func (counters *relayCounters) view() relayView {
	counters.mutex.Lock()
	defer counters.mutex.Unlock()
	view := relayView{DiscoRelayed: counters.discoRelayed, DiscoDropped: counters.discoDropped}
	for pair, packets := range counters.dataPackets {
		view.Pairs = append(view.Pairs, relayPairView{
			From: counters.nodeNameForKey(pair[0]), To: counters.nodeNameForKey(pair[1]),
			Packets: packets, Bytes: counters.dataBytes[pair],
		})
	}
	sort.Slice(view.Pairs, func(i, j int) bool {
		if view.Pairs[i].From != view.Pairs[j].From {
			return view.Pairs[i].From < view.Pairs[j].From
		}
		return view.Pairs[i].To < view.Pairs[j].To
	})
	return view
}

// relayFilter reads a client's side of a relay connection frame by frame and passes on only the
// frames ShouldRelayFrame allows. The first frame (client info) names the sender.
type relayFilter struct {
	net.Conn
	source   *bufio.Reader // the hijacked connection's reader (it may hold buffered bytes)
	counters *relayCounters
	sender   key.NodePublic
	pending  []byte // frames allowed but not yet read by the relay server
}

func (filter *relayFilter) Read(buffer []byte) (int, error) {
	for len(filter.pending) == 0 {
		if err := filter.readOneFrame(); err != nil {
			return 0, err
		}
	}
	read := copy(buffer, filter.pending)
	filter.pending = filter.pending[read:]
	return read, nil
}

func (filter *relayFilter) readOneFrame() error {
	header := make([]byte, derpFrameHeaderBytes)
	if _, err := io.ReadFull(filter.source, header); err != nil {
		return err
	}
	frameType := header[0]
	length := binary.BigEndian.Uint32(header[1:])
	if length > derpMaxFrameBytes {
		return errors.New("relay frame too large")
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(filter.source, payload); err != nil {
		return err
	}
	if frameType == derpFrameClientInfo && len(payload) >= derpKeyBytes {
		filter.sender = nodeKeyFromBytes(payload[:derpKeyBytes])
	}
	isRelayed := ShouldRelayFrame(filter.counters.isRelayOnly(), frameType, payload)
	filter.counters.count(filter.sender, frameType, payload, isRelayed)
	if isRelayed {
		filter.pending = append(append(filter.pending, header...), payload...)
	}
	return nil
}

// filteringHijacker hands the relay server a filtered connection instead of the raw one.
type filteringHijacker struct {
	http.ResponseWriter
	counters *relayCounters
}

func (writer filteringHijacker) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	connection, readWriter, err := writer.ResponseWriter.(http.Hijacker).Hijack()
	if err != nil {
		return nil, nil, err
	}
	filter := &relayFilter{Conn: connection, source: readWriter.Reader, counters: writer.counters}
	return filter, bufio.NewReadWriter(bufio.NewReader(filter), readWriter.Writer), nil
}

// startRelay starts the DERP relay (HTTPS with a self-signed certificate, which the DERP map
// marks InsecureForTests) and a STUN server, on 127.0.0.1. Returns the DERP map for the control
// server and a stop function.
func startRelay(counters *relayCounters) (*tailcfg.DERPMap, func(), error) {
	relay := derpserver.New(key.NewNode(), func(string, ...any) {})
	derpHandler := derpserver.Handler(relay)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, nil, fmt.Errorf("relay: %w", err)
	}
	filtered := func(writer http.ResponseWriter, request *http.Request) {
		derpHandler.ServeHTTP(filteringHijacker{ResponseWriter: writer, counters: counters}, request)
	}
	server := httptest.NewUnstartedServer(http.HandlerFunc(filtered))
	server.Listener.Close()
	server.Listener = listener
	server.Config.ErrorLog = discardLogger()
	server.StartTLS()

	stunConnection, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		server.Close()
		return nil, nil, fmt.Errorf("STUN: %w", err)
	}
	go serveSTUN(stunConnection)

	derpMap := &tailcfg.DERPMap{Regions: map[tailcfg.DERPRegionID]*tailcfg.DERPRegion{
		1: {RegionID: 1, RegionCode: "fake", RegionName: "Fake relay", Nodes: []*tailcfg.DERPNode{{
			Name: "1a", RegionID: 1, HostName: "127.0.0.1", IPv4: "127.0.0.1", IPv6: "none",
			DERPPort:         listener.Addr().(*net.TCPAddr).Port,
			STUNPort:         stunConnection.LocalAddr().(*net.UDPAddr).Port,
			STUNTestIP:       "127.0.0.1",
			InsecureForTests: true,
		}}},
	}}
	stop := func() {
		stunConnection.Close()
		server.Close()
		relay.Close()
	}
	return derpMap, stop, nil
}

// serveSTUN answers STUN binding requests with the address they came from.
//
// Goroutine note: started by startRelay; ends when the connection is closed.
func serveSTUN(connection net.PacketConn) {
	buffer := make([]byte, 1500)
	for {
		length, from, err := connection.ReadFrom(buffer)
		if err != nil {
			return
		}
		transactionID, err := stun.ParseBindingRequest(buffer[:length])
		if err != nil {
			continue
		}
		fromAddress, isUDP := from.(*net.UDPAddr)
		if !isUDP {
			continue
		}
		address := netip.AddrPortFrom(fromAddress.AddrPort().Addr().Unmap(), uint16(fromAddress.Port))
		_, _ = connection.WriteTo(stun.Response(transactionID, address), from)
	}
}

// nodeKeyFromBytes reads a node's public key from the 32 raw bytes a DERP frame carries.
func nodeKeyFromBytes(raw []byte) key.NodePublic {
	var nodeKey key.NodePublic
	_ = nodeKey.ReadRawWithoutAllocating(bufio.NewReader(bytes.NewReader(raw)))
	return nodeKey
}
