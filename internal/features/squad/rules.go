// Package squad shares your drawings (and, if you choose, your tasks) with friends running the
// app, over a private Tailscale network built into the exe (tsnet), with no server in between.
// This file holds the rules as plain functions; the network and file code calls them.
package squad

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"net/http"
	"net/netip"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// ---------------------------------------------------------------- the numbers

const (
	// ShareFormatVersion is the "v" of every share. A friend on another format is ignored (logged once).
	ShareFormatVersion = 1

	// MaxShareBytes caps one share, both the one the page sends and one a friend sends (ticket 05:
	// "cap request and response sizes, e.g. 2 MB"). A busy map's drawings are a few hundred KB.
	MaxShareBytes = 2 << 20

	// MaxNameRunes: a player name is 1 to 32 characters (brief for ticket 05).
	MaxNameRunes = 32

	// Ids and map keys are short plain words: task and objective ids are 24 hex characters,
	// map keys look like "streets-of-tarkov".
	maxKeyLength = 64

	// Limits on a share's drawings, far above real use; the 2 MB cap is the one that matters.
	maxMaps             = 64
	maxStrokesPerMap    = 5000
	maxPointsPerStroke  = 10000
	maxStrokeWidth      = 1000
	maxCoordinateAbs    = 1e6
	maxTasks            = 2000
	maxTicksPerTask     = 200
	maxTickCount        = 100000
	maxPercent          = 100
	maxStrokeColorBytes = 7 // "#rrggbb"

	// DefaultName and DefaultColor are your profile until you change it (ticket's example colour).
	DefaultName  = "Player"
	DefaultColor = "#4dabf7"

	// SquadTag is the Tailscale tag every squad node carries (the invite code is tagged with it).
	// The peer API answers only nodes with this tag.
	SquadTag = "tag:stm"

	// HostnamePrefix: each node is called "stm-<player id>" on the tailnet.
	HostnamePrefix = "stm-"

	// PeerAPIPort is where the peer API listens on the tailnet.
	PeerAPIPort = 7777

	// Reconnecting to a friend waits 1 s after the first failure, doubling up to 60 s (ticket 05).
	firstRetryDelay = time.Second
	maxRetryDelay   = 60 * time.Second
)

var (
	playerIDPattern = regexp.MustCompile(`^[0-9a-f]{16}$`)
	colorPattern    = regexp.MustCompile(`^#[0-9a-f]{6}$`)
	strokeColor     = regexp.MustCompile(`^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$`)
	keyPattern      = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
)

// ---------------------------------------------------------------- the share

// Share is what one player shows the squad ("my share"). The page builds Draw and Tasks from its
// saved data; the server stamps the rest.
type Share struct {
	Version   int                     `json:"v"`
	Player    Player                  `json:"player"`
	Rev       int64                   `json:"rev"`       // goes up by one each time the content changes
	UpdatedAt int64                   `json:"updatedAt"` // when the content last changed, ms since 1970
	Draw      map[string][]Stroke     `json:"draw"`      // by map key, the same shape as the page's draw
	Tasks     map[string]TaskProgress `json:"tasks"`     // by task id; null when "Share my tasks" is off
}

// Player is who a share belongs to.
type Player struct {
	ID    string `json:"id"`    // 16 lower-case hex characters, made once per copy
	Name  string `json:"name"`  // 1 to 32 characters
	Color string `json:"color"` // "#rrggbb"
}

// Stroke is one drawn line, in game coordinates (the page's Stroke: c, w, pts).
type Stroke struct {
	Color  string      `json:"c"`
	Width  float64     `json:"w"`
	Points [][]float64 `json:"pts"` // [x, z] pairs
}

// TaskProgress is one active task: its ticks and how far along it is.
type TaskProgress struct {
	Ticks   map[string]Tick `json:"ticks"` // by objective id
	Percent float64         `json:"pct"`   // 0 to 100
}

// Tick is one objective's progress, as the page saves it: true (done) or a count.
type Tick struct {
	IsDone bool
	Count  int
}

// MarshalJSON writes true or the count.
func (tick Tick) MarshalJSON() ([]byte, error) {
	if tick.IsDone {
		return []byte("true"), nil
	}
	return json.Marshal(tick.Count)
}

// UnmarshalJSON reads true or a whole number; anything else (false, text, 2.5) is refused.
func (tick *Tick) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	if string(trimmed) == "true" {
		*tick = Tick{IsDone: true}
		return nil
	}
	var count int
	if err := json.Unmarshal(trimmed, &count); err != nil {
		return errors.New("a tick is true or a whole number")
	}
	*tick = Tick{Count: count}
	return nil
}

// ShareParts is what the page sends with PUT /api/squad/share.
type ShareParts struct {
	Draw  map[string][]Stroke     `json:"draw"`
	Tasks map[string]TaskProgress `json:"tasks"`
}

// StampShare makes my next share from the page's parts. Tasks are dropped when "Share my tasks"
// is off (the server enforces this, not only the page). rev goes up by one and updatedAt is set
// only when the content (player, drawings, tasks) differs from the previous share; otherwise the
// previous share is returned unchanged, with changed = false.
func StampShare(
	previous *Share, player Player, parts ShareParts, shareTasks bool, now time.Time,
) (Share, bool) {
	next := Share{
		Version: ShareFormatVersion,
		Player:  player,
		Draw:    parts.Draw,
		Tasks:   parts.Tasks,
	}
	if next.Draw == nil {
		next.Draw = map[string][]Stroke{}
	}
	if !shareTasks {
		next.Tasks = nil
	}
	if previous == nil {
		next.Rev = 1
		next.UpdatedAt = now.UnixMilli()
		return next, true
	}
	if hasSameContent(*previous, next) {
		return *previous, false
	}
	next.Rev = previous.Rev + 1
	next.UpdatedAt = now.UnixMilli()
	return next, true
}

// hasSameContent compares what a friend sees: player, drawings and tasks.
func hasSameContent(a, b Share) bool {
	contentA, errA := json.Marshal([]any{a.Player, a.Draw, a.Tasks})
	contentB, errB := json.Marshal([]any{b.Player, b.Draw, b.Tasks})
	return errA == nil && errB == nil && bytes.Equal(contentA, contentB)
}

// HasChanged: a friend's share is new to us when its rev or updatedAt differ from the one we have.
// (Not "rev is higher": a friend who reset their data starts again at rev 1.)
func HasChanged(known *Share, received Share) bool {
	if known == nil {
		return true
	}
	return known.Rev != received.Rev || known.UpdatedAt != received.UpdatedAt
}

// ---------------------------------------------------------------- checking a share

// DecodeShare reads a share sent by a friend (or read from the cache) and checks all of it.
// Anything wrong refuses the whole share.
func DecodeShare(data []byte) (Share, error) {
	if len(data) > MaxShareBytes {
		return Share{}, fmt.Errorf("share is %d bytes, over the %d limit", len(data), MaxShareBytes)
	}
	var share Share
	if err := json.Unmarshal(data, &share); err != nil {
		return Share{}, fmt.Errorf("share isn't valid JSON of the right shape: %w", err)
	}
	if err := ValidateShare(share); err != nil {
		return Share{}, err
	}
	if share.Draw == nil {
		share.Draw = map[string][]Stroke{}
	}
	return share, nil
}

// ValidateShare checks a whole share: format version, player, rev, drawings and tasks.
func ValidateShare(share Share) error {
	if share.Version != ShareFormatVersion {
		return fmt.Errorf("share format v%d, this copy reads v%d", share.Version, ShareFormatVersion)
	}
	if err := ValidatePlayer(share.Player); err != nil {
		return err
	}
	if share.Rev < 1 || share.UpdatedAt < 0 {
		return errors.New("share has no valid rev or updatedAt")
	}
	return ValidateParts(ShareParts{Draw: share.Draw, Tasks: share.Tasks})
}

// ValidatePlayer: a valid player id, a name of 1 to 32 characters and a "#rrggbb" colour.
func ValidatePlayer(player Player) error {
	if !IsValidPlayerID(player.ID) {
		return errors.New("player id isn't 16 lower-case hex characters")
	}
	if !IsValidName(player.Name) {
		return fmt.Errorf("player name must be 1 to %d characters, no control characters", MaxNameRunes)
	}
	if !IsValidColor(player.Color) {
		return errors.New("player colour isn't #rrggbb")
	}
	return nil
}

// ValidateParts checks the drawings and tasks of a share (the page's parts or a friend's).
func ValidateParts(parts ShareParts) error {
	if len(parts.Draw) > maxMaps {
		return fmt.Errorf("drawings on %d maps, over the %d limit", len(parts.Draw), maxMaps)
	}
	for mapKey, strokes := range parts.Draw {
		if !isValidKey(mapKey) {
			return fmt.Errorf("map key %q isn't a plain short word", mapKey)
		}
		if err := validateStrokes(strokes); err != nil {
			return fmt.Errorf("drawings on %s: %w", mapKey, err)
		}
	}
	if len(parts.Tasks) > maxTasks {
		return fmt.Errorf("%d tasks, over the %d limit", len(parts.Tasks), maxTasks)
	}
	for taskID, progress := range parts.Tasks {
		if !isValidKey(taskID) {
			return fmt.Errorf("task id %q isn't a plain short word", taskID)
		}
		if err := validateTaskProgress(progress); err != nil {
			return fmt.Errorf("task %s: %w", taskID, err)
		}
	}
	return nil
}

func validateStrokes(strokes []Stroke) error {
	if len(strokes) > maxStrokesPerMap {
		return fmt.Errorf("%d strokes, over the %d limit", len(strokes), maxStrokesPerMap)
	}
	for _, stroke := range strokes {
		if len(stroke.Color) > maxStrokeColorBytes || !strokeColor.MatchString(stroke.Color) {
			return errors.New("a stroke colour isn't #rgb or #rrggbb")
		}
		if !isFiniteIn(stroke.Width, 0, maxStrokeWidth) || stroke.Width == 0 {
			return errors.New("a stroke width is missing or out of range")
		}
		if len(stroke.Points) == 0 || len(stroke.Points) > maxPointsPerStroke {
			pointCount := len(stroke.Points)
			return fmt.Errorf("a stroke has %d points (1 to %d allowed)", pointCount, maxPointsPerStroke)
		}
		for _, point := range stroke.Points {
			if !isValidPoint(point) {
				return errors.New("a stroke point isn't an [x, z] pair of numbers")
			}
		}
	}
	return nil
}

// isValidPoint: exactly [x, z], both within the coordinate limit.
func isValidPoint(point []float64) bool {
	if len(point) != 2 {
		return false
	}
	isXValid := isFiniteIn(point[0], -maxCoordinateAbs, maxCoordinateAbs)
	isZValid := isFiniteIn(point[1], -maxCoordinateAbs, maxCoordinateAbs)
	return isXValid && isZValid
}

func validateTaskProgress(progress TaskProgress) error {
	if !isFiniteIn(progress.Percent, 0, maxPercent) {
		return errors.New("pct isn't 0 to 100")
	}
	if len(progress.Ticks) > maxTicksPerTask {
		return fmt.Errorf("%d ticks, over the %d limit", len(progress.Ticks), maxTicksPerTask)
	}
	for objectiveID, tick := range progress.Ticks {
		if !isValidKey(objectiveID) {
			return fmt.Errorf("objective id %q isn't a plain short word", objectiveID)
		}
		if !tick.IsDone && (tick.Count < 0 || tick.Count > maxTickCount) {
			return fmt.Errorf("tick count %d out of range", tick.Count)
		}
	}
	return nil
}

func isValidKey(key string) bool {
	return len(key) >= 1 && len(key) <= maxKeyLength && keyPattern.MatchString(key)
}

func isFiniteIn(value, low, high float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= low && value <= high
}

// ---------------------------------------------------------------- the profile

// IsValidPlayerID: 16 lower-case hex characters (what NewPlayerID makes).
func IsValidPlayerID(id string) bool { return playerIDPattern.MatchString(id) }

// IsValidColor: "#rrggbb" in lower case (NormalizeColor lower-cases what the page sends).
func IsValidColor(color string) bool { return colorPattern.MatchString(color) }

// IsValidName: 1 to 32 characters, no control characters, no spaces at either end.
func IsValidName(name string) bool {
	if !utf8.ValidString(name) || name != strings.TrimSpace(name) {
		return false
	}
	length := utf8.RuneCountInString(name)
	if length < 1 || length > MaxNameRunes {
		return false
	}
	for _, character := range name {
		if unicode.IsControl(character) {
			return false
		}
	}
	return true
}

// NormalizeName trims the name the page sends; ok is false when the result isn't a valid name.
func NormalizeName(name string) (string, bool) {
	trimmed := strings.TrimSpace(name)
	return trimmed, IsValidName(trimmed)
}

// NormalizeColor lower-cases "#RRGGBB"; ok is false for anything else.
func NormalizeColor(color string) (string, bool) {
	lower := strings.ToLower(strings.TrimSpace(color))
	return lower, IsValidColor(lower)
}

// ---------------------------------------------------------------- finding friends on the tailnet

// Hostname is this copy's name on the tailnet: "stm-<player id>".
func Hostname(playerID string) string { return HostnamePrefix + playerID }

// PlayerIDFromHostname reads the player id out of "stm-<player id>" (any case).
func PlayerIDFromHostname(hostname string) (string, bool) {
	lower := strings.ToLower(hostname)
	if !strings.HasPrefix(lower, HostnamePrefix) {
		return "", false
	}
	id := strings.TrimPrefix(lower, HostnamePrefix)
	return id, IsValidPlayerID(id)
}

// TailnetPeer is the part of the tailnet's peer list the squad looks at.
type TailnetPeer struct {
	HostName  string       // the name the node asked for ("stm-<player id>")
	DNSName   string       // "stm-<player id>.<tailnet>.ts.net." (may get "-1" on a clash)
	Tags      []string     // e.g. ["tag:stm"]
	IsOnline  bool         // connected to the tailnet right now
	Addresses []netip.Addr // its tailnet addresses
}

// PeerAddress is a friend's copy to connect to.
type PeerAddress struct {
	Key      string // stable name for the connection: the player id (tsnet) or the address (dev)
	PlayerID string // the player id the share must carry; "" when unknown (dev transport)
	BaseURL  string // "http://100.64.0.7:7777"
}

// SquadPeers picks, from the tailnet's peer list, the online squad nodes to connect to: tagged
// tag:stm, named stm-<player id>, with an address. Our own player id is left out.
func SquadPeers(peers []TailnetPeer, ownPlayerID string) []PeerAddress {
	var found []PeerAddress
	for _, peer := range peers {
		if !peer.IsOnline || !HasSquadTag(peer.Tags) {
			continue
		}
		playerID, isSquadName := playerIDFromPeerNames(peer)
		if !isSquadName || playerID == ownPlayerID {
			continue
		}
		address, hasAddress := preferredAddress(peer.Addresses)
		if !hasAddress {
			continue
		}
		baseURL := "http://" + net.JoinHostPort(address.String(), fmt.Sprint(PeerAPIPort))
		found = append(found, PeerAddress{Key: playerID, PlayerID: playerID, BaseURL: baseURL})
	}
	return found
}

// playerIDFromPeerNames reads the id from the host name, or else from the first part of the DNS name.
func playerIDFromPeerNames(peer TailnetPeer) (string, bool) {
	if id, ok := PlayerIDFromHostname(peer.HostName); ok {
		return id, true
	}
	firstLabel, _, _ := strings.Cut(peer.DNSName, ".")
	return PlayerIDFromHostname(firstLabel)
}

// preferredAddress: the IPv4 tailnet address if there is one, else the first IPv6.
func preferredAddress(addresses []netip.Addr) (netip.Addr, bool) {
	for _, address := range addresses {
		if address.Is4() {
			return address, true
		}
	}
	if len(addresses) > 0 {
		return addresses[0], true
	}
	return netip.Addr{}, false
}

// HasSquadTag: the node carries tag:stm.
func HasSquadTag(tags []string) bool {
	for _, tag := range tags {
		if tag == SquadTag {
			return true
		}
	}
	return false
}

// IsLoopbackCaller: the request came from this PC (the only callers the dev transport answers).
func IsLoopbackCaller(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	address, err := netip.ParseAddr(host)
	return err == nil && address.IsLoopback()
}

// IsBrowserRequest: friends' copies never send Origin or Sec-Fetch-Site; browsers do. Refusing
// them keeps web pages (DNS rebinding included) from reading the peer API.
func IsBrowserRequest(header http.Header) bool {
	return header.Get("Origin") != "" || header.Get("Sec-Fetch-Site") != ""
}

// ShareFitsPeer: on the tailnet a share must carry the player id its node is named after, so one
// friend can't pose as another. The dev transport has no names (expected = "").
func ShareFitsPeer(share Share, expectedPlayerID string) bool {
	return expectedPlayerID == "" || share.Player.ID == expectedPlayerID
}

// ---------------------------------------------------------------- reconnecting

// RetryDelay is how long to wait before reconnecting after this many failures in a row:
// 1 s, 2 s, 4 s … up to 60 s (ticket 05).
func RetryDelay(failuresInARow int) time.Duration {
	if failuresInARow < 1 {
		return firstRetryDelay
	}
	delay := firstRetryDelay
	for attempt := 1; attempt < failuresInARow; attempt++ {
		delay *= 2
		if delay >= maxRetryDelay {
			return maxRetryDelay
		}
	}
	return delay
}

// ---------------------------------------------------------------- the status line

// Connection states shown in Settings → Squad.
const (
	StateOff        = "off"        // not in a squad
	StateStarting   = "starting"   // joining or reconnecting to the tailnet
	StateNeedsLogin = "needsLogin" // the tailnet logged this copy out (machine removed, key expired)
	StateConnected  = "connected"  // on the tailnet, the peer API is up
	StateError      = "error"      // couldn't start; see the error
)

// StatusText is the line under Settings → Squad, e.g. "Connected · 3 of 4 friends online".
func StatusText(state string, friendsOnline, friendsKnown int, problem string) string {
	switch state {
	case StateStarting:
		return "Connecting…"
	case StateNeedsLogin:
		return "Signed out of the squad network: leave, then join again with an invite code"
	case StateConnected:
		if friendsKnown == 0 {
			return "Connected · no friends seen yet"
		}
		return fmt.Sprintf("Connected · %d of %d friends online", friendsOnline, friendsKnown)
	case StateError:
		return "Squad connection failed: " + problem
	default:
		return "Not in a squad"
	}
}

// IsPlausibleAuthKey: a Tailscale auth key starts with "tskey-" and has no spaces. The real
// check is Tailscale's, when joining.
func IsPlausibleAuthKey(key string) bool {
	hasSpaces := strings.ContainsFunc(key, unicode.IsSpace)
	return strings.HasPrefix(key, "tskey-") && len(key) <= 200 && !hasSpaces
}
