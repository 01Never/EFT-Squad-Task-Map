package main

import (
	"net/netip"
	"slices"
	"testing"
	"time"

	"tailscale.com/disco"
	"tailscale.com/tailcfg"
)

func TestInviteCodesDecideTagsOrRefusal(t *testing.T) {
	cases := []struct {
		name        string
		code        string
		wantTags    []string
		wantRefusal string
	}{
		{"the squad's key tags the node tag:stm", TaggedInviteCode, []string{"tag:stm"}, ""},
		{"an untagged key joins with no tags", UntaggedInviteCode, nil, ""},
		{"an expired key is refused as expired", ExpiredInviteCode, nil, ErrorInviteExpired},
		{"any other key is refused as unknown", "tskey-auth-somebody-elses", nil, ErrorInviteUnknown},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tags, refusal := InviteCodeTags(tc.code)
			if !slices.Equal(tags, tc.wantTags) || refusal != tc.wantRefusal {
				t.Errorf("got %v %q, want %v %q", tags, refusal, tc.wantTags, tc.wantRefusal)
			}
		})
	}
}

func TestRegistrationDecisions(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	longAgo := time.Unix(123, 0) // what a Tailscale client sends to log out
	cases := []struct {
		name     string
		isKnown  bool
		code     string
		expiry   time.Time
		wantKind RegistrationKind
	}{
		{"a known machine coming back after a restart needs no code", true, "", time.Time{}, RegisterKnownNode},
		{"a known machine asking for an expiry in the past is logging out", true, "", longAgo, RegisterLogout},
		{"a known machine asking for a later expiry is not logging out", true, "", now.Add(time.Hour), RegisterKnownNode},
		{"a new node with the squad's code is a new machine", false, TaggedInviteCode, time.Time{}, RegisterNewNode},
		{"a new node with an expired code is refused", false, ExpiredInviteCode, time.Time{}, RegisterRefused},
		{"a new node without a code is sent to an interactive log-in", false, "", time.Time{}, RegisterNeedsLogin},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			decision := DecideRegistration(tc.isKnown, tc.code, tc.expiry, now)
			if decision.Kind != tc.wantKind {
				t.Errorf("kind %d, want %d", decision.Kind, tc.wantKind)
			}
		})
	}
}

func TestMagicDNSNamesAreUniqueLikeTailscales(t *testing.T) {
	cases := []struct {
		name     string
		hostName string
		taken    []string
		want     string
	}{
		{"a free name is kept", "stm-0123456789abcdef", nil, "stm-0123456789abcdef"},
		{"a taken name gets -1", "stm-0123456789abcdef", []string{"stm-0123456789abcdef"}, "stm-0123456789abcdef-1"},
		{"then -2", "stm-0123456789abcdef", []string{"stm-0123456789abcdef", "stm-0123456789abcdef-1"}, "stm-0123456789abcdef-2"},
		{"upper case and spaces are cleaned", "Mike's Laptop", nil, "mike-s-laptop"},
		{"a name of only symbols becomes node", "!!!", nil, "node"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			taken := map[string]bool{}
			for _, label := range tc.taken {
				taken[label] = true
			}
			if got := DNSLabelFor(tc.hostName, taken); got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestTheSquadPolicyOnlyLetsTagStmReachTagStmOnPort7777(t *testing.T) {
	squadTags := []string{"tag:stm"}
	cases := []struct {
		name        string
		acl         string
		source      []string
		destination []string
		port        uint16
		want        bool
	}{
		{"squad to squad on the peer API port", ACLSquadOnly, squadTags, squadTags, 7777, true},
		{"squad to squad on another port", ACLSquadOnly, squadTags, squadTags, 22, false},
		{"untagged to squad", ACLSquadOnly, nil, squadTags, 7777, false},
		{"squad to untagged", ACLSquadOnly, squadTags, nil, 7777, false},
		{"the open policy allows anything", ACLOpen, nil, squadTags, 7777, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ACLAllows(tc.acl, tc.source, tc.destination, tc.port); got != tc.want {
				t.Errorf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestNodesOnlySeePeersThePolicyLetsThemReach(t *testing.T) {
	if !CanSeeEachOther(ACLSquadOnly, []string{"tag:stm"}, []string{"tag:stm"}) {
		t.Error("two squad nodes must see each other")
	}
	if CanSeeEachOther(ACLSquadOnly, nil, []string{"tag:stm"}) {
		t.Error("an untagged node must not see a squad node under the squad policy")
	}
	if !CanSeeEachOther(ACLOpen, nil, []string{"tag:stm"}) {
		t.Error("the open policy shows everyone")
	}
}

func TestPacketFilters(t *testing.T) {
	sources := []netip.Prefix{netip.MustParsePrefix("100.64.0.1/32"), netip.MustParsePrefix("100.64.0.2/32")}

	t.Run("a squad node accepts TCP 7777 from squad addresses only", func(t *testing.T) {
		filter := PacketFilterFor(ACLSquadOnly, []string{"tag:stm"}, sources)
		if len(filter) != 1 {
			t.Fatalf("%d rules", len(filter))
		}
		rule := filter[0]
		if !slices.Equal(rule.SrcIPs, []string{"100.64.0.1/32", "100.64.0.2/32"}) {
			t.Errorf("sources %v", rule.SrcIPs)
		}
		if rule.DstPorts[0].Ports != (tailcfg.PortRange{First: 7777, Last: 7777}) || !slices.Equal(rule.IPProto, []int{6}) {
			t.Errorf("ports %v protocols %v", rule.DstPorts, rule.IPProto)
		}
	})
	t.Run("an untagged node accepts nothing (a rule from an address nobody has)", func(t *testing.T) {
		filter := PacketFilterFor(ACLSquadOnly, nil, sources)
		if len(filter) != 1 || !slices.Equal(filter[0].SrcIPs, []string{noTrafficSource}) {
			t.Errorf("filter %+v", filter)
		}
	})
	t.Run("the open policy allows everything", func(t *testing.T) {
		filter := PacketFilterFor(ACLOpen, nil, sources)
		if len(filter) != 1 || filter[0].SrcIPs[0] != "*" {
			t.Errorf("filter %+v", filter)
		}
	})
}

func TestRelayOnlyDropsDiscoMessagesButRelaysWireGuard(t *testing.T) {
	destination := make([]byte, derpKeyBytes)
	discoPacket := append(append([]byte{}, destination...), []byte(disco.Magic+"sealed")...)
	wireGuardPacket := append(append([]byte{}, destination...), 4, 0, 0, 0, 1, 2, 3)
	cases := []struct {
		name        string
		isRelayOnly bool
		frameType   byte
		payload     []byte
		want        bool
	}{
		{"normal mode relays disco messages", false, derpFrameSendPacket, discoPacket, true},
		{"relay-only drops disco messages", true, derpFrameSendPacket, discoPacket, false},
		{"relay-only relays WireGuard data", true, derpFrameSendPacket, wireGuardPacket, true},
		{"relay-only passes other frames (client info, keep-alives)", true, derpFrameClientInfo, discoPacket, true},
		{"a frame too short to hold a key is passed on for the relay to reject", true, derpFrameSendPacket, []byte{1, 2}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ShouldRelayFrame(tc.isRelayOnly, tc.frameType, tc.payload); got != tc.want {
				t.Errorf("got %v, want %v", got, tc.want)
			}
		})
	}
}
