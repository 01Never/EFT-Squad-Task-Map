package squad

// Rules about who a friend is and what a friend may send (QA findings on ticket 05 part 1).

import (
	"fmt"
	"net/netip"
	"testing"
)

// squadNode is an online tag:stm node whose MagicDNS name starts with dnsLabel.
func squadNode(nodeID, hostName, dnsLabel string, addresses ...netip.Addr) TailnetPeer {
	return TailnetPeer{
		NodeID: nodeID, HostName: hostName, DNSName: dnsLabel + ".tail1234.ts.net.",
		Tags: []string{SquadTag}, IsOnline: true, Addresses: addresses,
	}
}

func TestFindingSquadPeersOnTheTailnet(t *testing.T) {
	address := netip.MustParseAddr("100.64.0.7")
	addressV6 := netip.MustParseAddr("fd7a:115c:a1e0::7")
	samsName := "stm-" + sam.ID
	samAt := func(baseURL string) []PeerAddress {
		return []PeerAddress{{Key: "nSam", PlayerID: sam.ID, BaseURL: baseURL}}
	}
	offline := squadNode("nSam", samsName, samsName, address)
	offline.IsOnline = false
	untagged := squadNode("nSam", samsName, samsName, address)
	untagged.Tags = nil
	cases := []struct {
		name          string
		peers         []TailnetPeer
		want          []PeerAddress
		wantContested []string
	}{
		{"an online tag:stm node whose DNS name is stm-<id> is a friend, keyed by its node id",
			[]TailnetPeer{squadNode("nSam", "DESKTOP-1", samsName, addressV6, address)},
			samAt("http://100.64.0.7:7777"), nil},
		{"an IPv6-only node gets a bracketed address",
			[]TailnetPeer{squadNode("nSam", samsName, samsName, addressV6)},
			samAt("http://[fd7a:115c:a1e0::7]:7777"), nil},
		{"the host name alone proves nothing (each node picks its own)",
			[]TailnetPeer{squadNode("nX", samsName, "laptop", address)}, nil, nil},
		{"a DNS name made unique with -1 is not trusted",
			[]TailnetPeer{squadNode("nX", samsName, samsName+"-1", address)}, nil, nil},
		{"two nodes with the same host name: neither is trusted, and the id is reported",
			[]TailnetPeer{
				squadNode("nSam", samsName, samsName, address),
				squadNode("nX", samsName, samsName+"-1", address),
			}, nil, []string{sam.ID}},
		{"an offline machine still claiming the id makes the online one untrusted too",
			[]TailnetPeer{offline, squadNode("nNew", samsName, samsName+"-1", address)},
			nil, []string{sam.ID}},
		{"an offline node is skipped", []TailnetPeer{offline}, nil, nil},
		{"an untagged node is skipped", []TailnetPeer{untagged}, nil, nil},
		{"our own player id is skipped",
			[]TailnetPeer{squadNode("nMe", "x", "stm-"+mike.ID, address)}, nil, nil},
		{"a node without an address is skipped", []TailnetPeer{squadNode("nSam", "x", samsName)}, nil, nil},
		{"a node without a node id is skipped",
			[]TailnetPeer{squadNode("", "x", samsName, address)}, nil, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, contested := SquadPeers(tc.peers, mike.ID)
			if fmt.Sprint(got) != fmt.Sprint(tc.want) || fmt.Sprint(contested) != fmt.Sprint(tc.wantContested) {
				t.Errorf("SquadPeers = %+v, contested %v; want %+v, contested %v",
					got, contested, tc.want, tc.wantContested)
			}
		})
	}
}

func TestThePeerAPIOnlyAnswersItsOwnAddressAsHost(t *testing.T) {
	own := []netip.AddrPort{
		netip.MustParseAddrPort("127.0.0.1:7901"),
		netip.MustParseAddrPort("[fd7a:115c:a1e0::7]:7777"),
	}
	cases := []struct {
		name string
		host string
		want bool
	}{
		{"its own address and port", "127.0.0.1:7901", true},
		{"its own IPv6 address and port", "[fd7a:115c:a1e0::7]:7777", true},
		{"a rebinding domain pointing at it", "attacker.example:7901", false},
		{"localhost by name", "localhost:7901", false},
		{"the right address on another port", "127.0.0.1:7902", false},
		{"no port", "127.0.0.1", false},
		{"no Host at all", "", false},
	}
	for _, tc := range cases {
		if got := IsOwnHost(tc.host, own); got != tc.want {
			t.Errorf("%s: IsOwnHost(%q) = %v, want %v", tc.name, tc.host, got, tc.want)
		}
	}
}

func TestKeysThatMeanSomethingToJavaScriptAreRefused(t *testing.T) {
	stroke := []any{map[string]any{"c": "#fff", "w": 1, "pts": []any{[]any{1, 2}}}}
	emptyTask := map[string]any{"ticks": map[string]any{}, "pct": 0}
	for _, key := range []string{"__proto__", "constructor", "prototype"} {
		cases := map[string][]byte{
			"as a map key": validShareJSON(map[string]any{"draw": map[string]any{key: stroke}}),
			"as a task id": validShareJSON(map[string]any{"tasks": map[string]any{key: emptyTask}}),
			"as an objective id": validShareJSON(map[string]any{"tasks": map[string]any{
				"t1": map[string]any{"ticks": map[string]any{key: true}, "pct": 0},
			}}),
		}
		for where, data := range cases {
			if _, err := DecodeShare(data); err == nil {
				t.Errorf("%q %s was accepted", key, where)
			}
		}
	}
}

// Names are shown to friends as text. These are accepted on purpose: the page must always insert
// a friend's name as text (escaped), never as HTML, and keep it inside its own element (bidi
// isolation) so a right-to-left override can't flip the text around it.
func TestUnusualNamesAreAcceptedAndThePageMustEscapeThem(t *testing.T) {
	cases := []struct {
		name   string
		player string
	}{
		{"markup", `<img src=x onerror=alert(1)>`},
		{"a right-to-left override", "Sam‮evil"},
		{"a zero-width space", "Sa​m"},
		{"quotes and ampersands", `"Sam" & 'Co'`},
	}
	for _, tc := range cases {
		if _, err := DecodeShare(validShareJSON(withPlayer(sam.ID, tc.player, sam.Color))); err != nil {
			t.Errorf("a name with %s was refused (%v); it is accepted on purpose", tc.name, err)
		}
	}
}
