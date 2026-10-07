package main

// The fake tailnet's rules: what the real Tailscale admin console and coordination server decide,
// as far as the squad depends on it. Pure functions (no network, no clock reads), tested in
// rules_test.go. The plumbing that applies them is in tailnet.go and derp.go.

import (
	"bytes"
	"fmt"
	"net/netip"
	"strings"
	"time"

	"squadtaskmap/internal/features/squad"
	"tailscale.com/disco"
	"tailscale.com/tailcfg"
)

// The three invite codes (auth keys) the fake tailnet knows, like keys made in the admin console.
const (
	// TaggedInviteCode is the squad's real kind of key: reusable, tagged tag:stm, not ephemeral.
	TaggedInviteCode = "tskey-auth-faketailnet-squad-0001"
	// ExpiredInviteCode was a tagged key once, but it has expired.
	ExpiredInviteCode = "tskey-auth-faketailnet-expired-0002"
	// UntaggedInviteCode is a reusable key made without a tag (a mistake the owner could make,
	// or an intruder's own key on the same tailnet).
	UntaggedInviteCode = "tskey-auth-faketailnet-untagged-0003"
)

// The refusals a joining node sees (RegisterResponse.Error). Tailscale's real wording may differ;
// the app shows whatever text the coordination server sends.
const (
	ErrorInviteExpired = "invalid key: this auth key has expired"
	ErrorInviteUnknown = "invalid key: unknown auth key"
)

// MagicDNSDomain is the tailnet's DNS suffix: nodes are "<name>.faketailnet.ts.net.".
const MagicDNSDomain = "faketailnet.ts.net"

// ACL modes, as the tailnet policy would say them.
const (
	// ACLSquadOnly is the owner's policy (docs/USER-GUIDE.md): tag:stm may reach tag:stm on TCP
	// port 7777, nothing else. Nodes only see the peers they may talk to (either way).
	ACLSquadOnly = "squad"
	// ACLOpen allows every node to reach every node on every port (Tailscale's default policy):
	// used to check the app's own tag:stm check (WhoIs) behind a too-loose policy.
	ACLOpen = "open"
)

// InviteCodeTags says what a new node joining with this code gets: its tags, or the refusal.
func InviteCodeTags(code string) (tags []string, refusal string) {
	switch code {
	case TaggedInviteCode:
		return []string{squad.SquadTag}, ""
	case UntaggedInviteCode:
		return nil, ""
	case ExpiredInviteCode:
		return nil, ErrorInviteExpired
	default:
		return nil, ErrorInviteUnknown
	}
}

// RegistrationKind is what the coordination server does with one register request.
type RegistrationKind int

const (
	// RegisterNewNode: a node key we haven't seen, with a good invite code: a new machine.
	RegisterNewNode RegistrationKind = iota + 1
	// RegisterKnownNode: a machine we know, coming back (restart) or refreshing; or a known
	// expired one, which Tailscale answers with "node key expired".
	RegisterKnownNode
	// RegisterLogout: a known machine logging out (it asks for an expiry in the past).
	RegisterLogout
	// RegisterRefused: a new node with a bad invite code (Refusal says why).
	RegisterRefused
	// RegisterNeedsLogin: a new node with no invite code at all: Tailscale would send it to a
	// log-in page (an auth URL); the node then waits for an interactive log-in.
	RegisterNeedsLogin
)

// RegistrationDecision is DecideRegistration's answer.
type RegistrationDecision struct {
	Kind    RegistrationKind
	Tags    []string // for RegisterNewNode
	Refusal string   // for RegisterRefused
}

// DecideRegistration: a known node key (not deleted) is let through, as a log-out when it asks for
// an expiry in the past; a new node needs a good invite code, which decides its tags. A deleted
// machine's key counts as unknown: it must join again with an invite code.
func DecideRegistration(
	isKnownNode bool, inviteCode string, requestedExpiry time.Time, now time.Time,
) RegistrationDecision {
	if isKnownNode {
		isLogout := !requestedExpiry.IsZero() && requestedExpiry.Before(now)
		if isLogout {
			return RegistrationDecision{Kind: RegisterLogout}
		}
		return RegistrationDecision{Kind: RegisterKnownNode}
	}
	if inviteCode == "" {
		return RegistrationDecision{Kind: RegisterNeedsLogin}
	}
	tags, refusal := InviteCodeTags(inviteCode)
	if refusal != "" {
		return RegistrationDecision{Kind: RegisterRefused, Refusal: refusal}
	}
	return RegistrationDecision{Kind: RegisterNewNode, Tags: tags}
}

// DNSLabelFor turns the host name a node asks for into its MagicDNS name's first part, unique in
// the tailnet: lower case, anything but a-z, 0-9 and "-" becomes "-"; when the name is taken by
// another machine (online or not, logged out or not; only deleting it frees the name) it gets
// "-1", "-2", … like Tailscale does. taken holds the labels of the other machines.
func DNSLabelFor(hostName string, taken map[string]bool) string {
	base := cleanDNSLabel(hostName)
	if !taken[base] {
		return base
	}
	for suffix := 1; ; suffix++ {
		candidate := fmt.Sprintf("%s-%d", base, suffix)
		if !taken[candidate] {
			return candidate
		}
	}
}

func cleanDNSLabel(hostName string) string {
	var label strings.Builder
	for _, character := range strings.ToLower(hostName) {
		isLetter := character >= 'a' && character <= 'z'
		isDigit := character >= '0' && character <= '9'
		isAllowed := isLetter || isDigit || character == '-'
		if isAllowed {
			label.WriteRune(character)
		} else {
			label.WriteRune('-')
		}
	}
	cleaned := strings.Trim(label.String(), "-")
	if cleaned == "" {
		return "node"
	}
	return cleaned
}

// MagicDNSName is the node's full name, as peers see it: "stm-0123….faketailnet.ts.net.".
func MagicDNSName(label string) string { return label + "." + MagicDNSDomain + "." }

// ACLAllows: may a node with sourceTags open a connection to a node with destinationTags on this
// TCP port?
func ACLAllows(aclMode string, sourceTags, destinationTags []string, port uint16) bool {
	if aclMode == ACLOpen {
		return true
	}
	isSquadToSquad := squad.HasSquadTag(sourceTags) && squad.HasSquadTag(destinationTags)
	return isSquadToSquad && port == squad.PeerAPIPort
}

// CanSeeEachOther: Tailscale only puts a peer in a node's map when the policy lets one of the two
// reach the other. With the squad policy, an untagged node sees no squad node and vice versa.
func CanSeeEachOther(aclMode string, firstTags, secondTags []string) bool {
	if aclMode == ACLOpen {
		return true
	}
	return squad.HasSquadTag(firstTags) && squad.HasSquadTag(secondTags)
}

// noTrafficSource is an address no node has (TEST-NET-1): a filter rule from it allows nothing.
// (An empty packet filter can't be sent: the map response would read it as "unchanged".)
const noTrafficSource = "192.0.2.1/32"

// PacketFilterFor is the filter a node enforces on traffic coming in, from the policy: who may open
// connections to it, on which ports. squadSources are the addresses of every tag:stm machine.
func PacketFilterFor(
	aclMode string, selfTags []string, squadSources []netip.Prefix,
) []tailcfg.FilterRule {
	if aclMode == ACLOpen {
		return tailcfg.FilterAllowAll
	}
	peerAPIPort := tailcfg.PortRange{First: squad.PeerAPIPort, Last: squad.PeerAPIPort}
	allowNothing := []tailcfg.FilterRule{{
		SrcIPs:   []string{noTrafficSource},
		DstPorts: []tailcfg.NetPortRange{{IP: "*", Ports: peerAPIPort}},
	}}
	if !squad.HasSquadTag(selfTags) || len(squadSources) == 0 {
		return allowNothing
	}
	var sources []string
	for _, prefix := range squadSources {
		sources = append(sources, prefix.String())
	}
	const tcp = 6
	return []tailcfg.FilterRule{{
		SrcIPs:   sources,
		DstPorts: []tailcfg.NetPortRange{{IP: "*", Ports: peerAPIPort}},
		IPProto:  []int{tcp},
	}}
}

// DERP frames (Tailscale's relay protocol): a 1-byte type, a 4-byte big-endian length, the payload.
const (
	derpFrameHeaderBytes = 5
	derpFrameClientInfo  = 0x02 // client → relay, first frame: 32-byte public key, then a sealed box
	derpFrameSendPacket  = 0x04 // client → relay: 32-byte destination key, then the packet
	derpKeyBytes         = 32
	// derpMaxFrameBytes: DERP's own cap is 64 KB a packet (+ key); client info is ≤ 1 MB.
	derpMaxFrameBytes = 1<<20 + derpKeyBytes
)

// IsDiscoPacket: a packet sent through the relay is a disco message (Tailscale's path discovery:
// pings and "call me maybe" with the sender's direct addresses) rather than WireGuard data. Disco
// messages start with a 6-byte magic in the clear; their content is sealed.
func IsDiscoPacket(packet []byte) bool {
	return bytes.HasPrefix(packet, []byte(disco.Magic))
}

// ShouldRelayFrame: in relay-only mode, disco messages sent through the relay are dropped, so the
// nodes never learn each other's direct addresses (the map responses carry none either) and every
// WireGuard packet keeps going through the relay. Everything else is relayed.
func ShouldRelayFrame(isRelayOnly bool, frameType byte, payload []byte) bool {
	if !isRelayOnly || frameType != derpFrameSendPacket || len(payload) < derpKeyBytes {
		return true
	}
	return !IsDiscoPacket(payload[derpKeyBytes:])
}
