package squad

// The squad as the rest of the app sees it: your squad settings, your share, your friends' last
// shares, and the session (transport + peer API + friend connections) while you're in a squad.
// internal/app creates it, picks the transport, and turns OnChange into the page's "squad" event.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// StateFolderName is tsnet's state folder in the data folder. It holds the node key: treat it as
// secret. Leave squad deletes it, and only a folder with exactly this name.
const StateFolderName = "squad-task-map-tailscale"

// ErrAlreadyJoined: Join while already in a squad.
var ErrAlreadyJoined = errors.New("Already in a squad. Leave it first to join another")

// Settings are the player's squad choices, saved by internal/app in the settings file. The invite
// code is never among them.
type Settings struct {
	PlayerID   string
	Name       string
	Color      string
	ShareTasks bool
	Joined     bool
}

// Config is what New needs.
type Config struct {
	CacheFile     string                  // squad-task-map-squad.json
	StateDir      string                  // squad-task-map-tailscale/ (deleted on Leave)
	TransportName string                  // "tsnet" or "dev": the one internal/app will use
	Settings      Settings                // as saved
	SaveSettings  func(Settings)          // called whenever they change (a new player id too)
	OnChange      func()                  // something on the page's squad view changed
	Now           func() time.Time        // time.Now; tests replace it
	RetryDelay    func(int) time.Duration // RetryDelay; tests shorten it
}

// Squad is the squad feature.
type Squad struct {
	config Config
	feed   *shareFeed

	mutex       sync.Mutex
	settings    Settings
	mine        *Share
	friends     map[string]CachedFriend // by player id
	onlineLinks map[string]string       // connection key → player id, while its stream is open
	state       string
	problem     string
	session     *session

	// lifecycle makes Join, Resume, Leave and Stop happen one at a time.
	lifecycle sync.Mutex

	// pageUpdates sends the "squad" event and cacheWrites saves the cache file, each at most once
	// per ChangeInterval (a friend's flood of shares becomes a handful of each).
	pageUpdates *throttle
	cacheWrites *throttle
	writeCount  atomic.Int64 // cache files written (tests)
}

// New loads the squad cache and fills in the settings' defaults (a new player id is made once and
// saved). Nothing starts: see Resume and Join.
func New(config Config) *Squad {
	if config.Now == nil {
		config.Now = time.Now
	}
	if config.RetryDelay == nil {
		config.RetryDelay = RetryDelay
	}
	if config.OnChange == nil {
		config.OnChange = func() {}
	}
	if config.SaveSettings == nil {
		config.SaveSettings = func(Settings) {}
	}
	settings, changed := withDefaults(config.Settings)
	squad := &Squad{
		config:      config,
		feed:        newShareFeed(),
		settings:    settings,
		onlineLinks: map[string]string{},
		state:       StateOff,
	}
	squad.pageUpdates = newThrottle(ChangeInterval, config.OnChange)
	squad.cacheWrites = newThrottle(ChangeInterval, squad.writeCacheNow)
	squad.mine, squad.friends = readCache(config.CacheFile)
	delete(squad.friends, settings.PlayerID)
	if changed {
		config.SaveSettings(settings)
	}
	squad.restampMineLocked()
	return squad
}

// withDefaults: a player id (made once), the default name and colour when unset or invalid.
func withDefaults(settings Settings) (Settings, bool) {
	changed := false
	if !IsValidPlayerID(settings.PlayerID) {
		settings.PlayerID = NewPlayerID()
		changed = true
	}
	if !IsValidName(settings.Name) {
		settings.Name = DefaultName
		changed = true
	}
	if !IsValidColor(settings.Color) {
		settings.Color = DefaultColor
		changed = true
	}
	return settings, changed
}

// NewPlayerID makes a random player id: 16 lower-case hex characters.
func NewPlayerID() string {
	random := make([]byte, 8)
	_, _ = rand.Read(random) // crypto/rand.Read never fails (Go 1.24+)
	return hex.EncodeToString(random)
}

// Settings are the current squad settings.
func (squad *Squad) Settings() Settings {
	squad.mutex.Lock()
	defer squad.mutex.Unlock()
	return squad.settings
}

func (squad *Squad) playerLocked() Player {
	return Player{ID: squad.settings.PlayerID, Name: squad.settings.Name, Color: squad.settings.Color}
}

// ---------------------------------------------------------------- my share

// ShareResult is the answer to PUT /api/squad/share.
type ShareResult struct {
	Rev         int64 `json:"rev"`
	UpdatedAt   int64 `json:"updatedAt"`
	Changed     bool  `json:"changed"`     // false when the content was the same as before
	TasksShared bool  `json:"tasksShared"` // false: "Share my tasks" is off, so tasks were dropped
	InSquad     bool  `json:"inSquad"`     // false: kept for when you join, nobody gets it now
}

// SetMyShare takes the page's drawings and tasks, stamps them (StampShare) and, when they changed,
// saves them and sends them to friends' open streams.
func (squad *Squad) SetMyShare(parts ShareParts) (ShareResult, error) {
	if err := ValidateParts(parts); err != nil {
		return ShareResult{}, err
	}
	squad.mutex.Lock()
	next, changed := squad.stampLocked(parts)
	if changed {
		squad.mine = &next
		squad.saveCacheLocked()
		squad.publishMineLocked()
	}
	result := ShareResult{
		Rev: next.Rev, UpdatedAt: next.UpdatedAt, Changed: changed,
		TasksShared: squad.settings.ShareTasks, InSquad: squad.settings.Joined,
	}
	squad.mutex.Unlock()
	if changed {
		squad.notifyPage()
	}
	return result, nil
}

// SetProfile changes name, colour and "Share my tasks". The share is stamped again at once, so
// friends see the new name, and tasks disappear from it as soon as sharing is turned off. (Turning
// it on shares tasks from the page's next PUT /api/squad/share.)
func (squad *Squad) SetProfile(name, color string, shareTasks bool) error {
	cleanName, isValidName := NormalizeName(name)
	if !isValidName {
		return fmt.Errorf("Your name must be 1 to %d characters", MaxNameRunes)
	}
	cleanColor, isValidColor := NormalizeColor(color)
	if !isValidColor {
		return errors.New("Your colour must look like #4dabf7")
	}
	squad.mutex.Lock()
	squad.settings.Name, squad.settings.Color, squad.settings.ShareTasks = cleanName, cleanColor, shareTasks
	settings := squad.settings
	squad.restampMineLocked()
	squad.mutex.Unlock()
	squad.config.SaveSettings(settings)
	squad.notifyPage()
	return nil
}

// restampMineLocked stamps my share again with the current profile (keeping its drawings and
// tasks; tasks are dropped when sharing is off), saves it if it changed, and publishes it.
func (squad *Squad) restampMineLocked() {
	if squad.mine == nil {
		return
	}
	parts := ShareParts{Draw: squad.mine.Draw, Tasks: squad.mine.Tasks}
	next, changed := squad.stampLocked(parts)
	squad.mine = &next
	if changed {
		squad.saveCacheLocked()
	}
	squad.publishMineLocked()
}

// stampLocked applies StampShare with the current profile, task-sharing choice and time.
func (squad *Squad) stampLocked(parts ShareParts) (Share, bool) {
	now := squad.config.Now()
	return StampShare(squad.mine, squad.playerLocked(), parts, squad.settings.ShareTasks, now)
}

func (squad *Squad) publishMineLocked() {
	encoded, err := json.Marshal(squad.mine)
	if err != nil {
		return
	}
	squad.feed.publish(encoded)
}

// saveCacheLocked asks for the cache file to be written (within ChangeInterval; see cacheWrites).
func (squad *Squad) saveCacheLocked() {
	squad.cacheWrites.trigger()
}

// writeCacheNow writes the cache file with the current state.
func (squad *Squad) writeCacheNow() {
	squad.mutex.Lock()
	defer squad.mutex.Unlock()
	squad.writeCacheNowLocked()
}

func (squad *Squad) writeCacheNowLocked() {
	squad.writeCount.Add(1)
	if err := writeCache(squad.config.CacheFile, squad.mine, squad.friends); err != nil {
		log.Printf("squad: %v", err)
	}
}

// notifyPage asks for a "squad" event (within ChangeInterval; see pageUpdates).
func (squad *Squad) notifyPage() {
	squad.pageUpdates.trigger()
}

// ---------------------------------------------------------------- friends

// onFriendShare: a friend's connection delivered a valid share.
func (squad *Squad) onFriendShare(link PeerAddress, share Share, viaStream bool) {
	squad.mutex.Lock()
	playerID := share.Player.ID
	if playerID == squad.settings.PlayerID {
		squad.mutex.Unlock()
		return // our own copy (a dev list that includes us, or a copied settings file)
	}
	var known *Share
	if friend, isKnown := squad.friends[playerID]; isKnown {
		known = &friend.Share
	}
	hasNewContent := HasChanged(known, share)
	wasOnline := squad.isOnlineLocked(playerID)
	squad.friends[playerID] = CachedFriend{LastSeen: squad.config.Now().UnixMilli(), Share: share}
	if viaStream {
		squad.onlineLinks[link.Key] = playerID
	}
	isOnline := squad.isOnlineLocked(playerID)
	if hasNewContent {
		squad.saveCacheLocked()
	}
	squad.mutex.Unlock()
	if hasNewContent || wasOnline != isOnline {
		squad.notifyPage()
	}
}

// onFriendStreamClosed: a friend's stream ended; remember when we last saw them.
func (squad *Squad) onFriendStreamClosed(link PeerAddress) {
	squad.mutex.Lock()
	playerID, wasOpen := squad.onlineLinks[link.Key]
	if !wasOpen {
		squad.mutex.Unlock()
		return
	}
	delete(squad.onlineLinks, link.Key)
	if friend, isKnown := squad.friends[playerID]; isKnown {
		friend.LastSeen = squad.config.Now().UnixMilli()
		squad.friends[playerID] = friend
		squad.saveCacheLocked()
	}
	squad.mutex.Unlock()
	squad.notifyPage()
}

func (squad *Squad) isOnlineLocked(playerID string) bool {
	for _, onlineID := range squad.onlineLinks {
		if onlineID == playerID {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------- what the page sees

// View is GET /api/squad and the "squad" event (see README for the contract).
type View struct {
	Me        MeView       `json:"me"`
	Settings  SettingsView `json:"settings"`
	Transport string       `json:"transport"` // "tsnet" or "dev"
	Status    StatusView   `json:"status"`
	Friends   []FriendView `json:"friends"` // by name, then player id
}

// MeView is you as friends see you, without your share (the page built it).
type MeView struct {
	PlayerID  string `json:"playerId"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	Rev       int64  `json:"rev"`       // 0 until the page sent a share
	UpdatedAt int64  `json:"updatedAt"` // ms since 1970; 0 until the page sent a share
}

// SettingsView is the squad settings the page can change (name and colour are in MeView).
type SettingsView struct {
	ShareTasks bool `json:"shareTasks"`
	Joined     bool `json:"joined"`
}

// StatusView is the connection line.
type StatusView struct {
	State         string `json:"state"` // off, starting, needsLogin, connected, error
	Text          string `json:"text"`  // e.g. "Connected · 3 of 4 friends online"
	FriendsOnline int    `json:"friendsOnline"`
	FriendsKnown  int    `json:"friendsKnown"`
	Problem       string `json:"problem"` // the error, when state is "error"
}

// FriendView is one friend: online now, or their last share and when we last saw them.
type FriendView struct {
	PlayerID string `json:"playerId"`
	Name     string `json:"name"`
	Color    string `json:"color"`
	Online   bool   `json:"online"`
	LastSeen int64  `json:"lastSeen"` // ms since 1970
	Share    Share  `json:"share"`
}

// View is the page's whole squad view.
func (squad *Squad) View() View {
	squad.mutex.Lock()
	defer squad.mutex.Unlock()
	settings := squad.settings
	view := View{
		Me:        MeView{PlayerID: settings.PlayerID, Name: settings.Name, Color: settings.Color},
		Settings:  SettingsView{ShareTasks: squad.settings.ShareTasks, Joined: squad.settings.Joined},
		Transport: squad.config.TransportName,
		Friends:   []FriendView{},
	}
	if squad.mine != nil {
		view.Me.Rev, view.Me.UpdatedAt = squad.mine.Rev, squad.mine.UpdatedAt
	}
	online := 0
	for playerID, friend := range squad.friends {
		isOnline := squad.isOnlineLocked(playerID)
		if isOnline {
			online++
		}
		view.Friends = append(view.Friends, FriendView{
			PlayerID: playerID, Name: friend.Share.Player.Name, Color: friend.Share.Player.Color,
			Online: isOnline, LastSeen: friend.LastSeen, Share: friend.Share,
		})
	}
	sort.Slice(view.Friends, func(i, j int) bool {
		if view.Friends[i].Name != view.Friends[j].Name {
			return view.Friends[i].Name < view.Friends[j].Name
		}
		return view.Friends[i].PlayerID < view.Friends[j].PlayerID
	})
	view.Status = StatusView{
		State: squad.state, FriendsOnline: online, FriendsKnown: len(squad.friends), Problem: squad.problem,
		Text: StatusText(squad.state, online, len(squad.friends), squad.problem),
	}
	return view
}

// ---------------------------------------------------------------- joining and leaving

// Join joins the squad with an invite code: it brings the transport up (waiting until the tailnet
// accepts the node), then starts the session. On failure nothing is kept: the transport is closed
// and its state folder deleted.
func (squad *Squad) Join(ctx context.Context, transport Transport) error {
	squad.lifecycle.Lock()
	defer squad.lifecycle.Unlock()
	if squad.Settings().Joined {
		_ = transport.Close()
		return ErrAlreadyJoined
	}
	squad.setState(nil, StateStarting, "")
	if err := transport.Up(ctx, true); err != nil {
		_ = transport.Close()
		squad.removeStateFolder()
		squad.setState(nil, StateOff, "")
		return err
	}
	squad.mutex.Lock()
	squad.settings.Joined = true
	settings := squad.settings
	squad.mutex.Unlock()
	squad.config.SaveSettings(settings)
	current := squad.startSession(transport, true)
	select {
	case <-current.listening:
	case <-ctx.Done():
	}
	return nil
}

// Resume starts the session after a restart, when the settings say we're in a squad. Returns at
// once; the transport comes up in the background.
func (squad *Squad) Resume(transport Transport) {
	squad.lifecycle.Lock()
	defer squad.lifecycle.Unlock()
	if !squad.Settings().Joined || squad.currentSession() != nil {
		_ = transport.Close()
		return
	}
	squad.startSession(transport, false)
}

// Leave leaves the squad: stops the session, logs the node out of the tailnet, deletes the tsnet
// state folder (the node key) and forgets friends' shares. Your own share is kept.
func (squad *Squad) Leave(ctx context.Context) {
	squad.lifecycle.Lock()
	defer squad.lifecycle.Unlock()
	if current := squad.detachSession(); current != nil {
		current.stop()
		if err := current.transport.Logout(ctx); err != nil {
			log.Printf("squad: logging out of the squad network: %v", err)
		}
		_ = current.transport.Close()
	}
	squad.removeStateFolder()

	squad.mutex.Lock()
	squad.friends = map[string]CachedFriend{}
	squad.onlineLinks = map[string]string{}
	squad.settings.Joined = false
	squad.state, squad.problem = StateOff, ""
	settings := squad.settings
	squad.writeCacheNowLocked() // friends are forgotten on disk at once
	squad.mutex.Unlock()
	squad.config.SaveSettings(settings)
	squad.notifyPage()
}

// Stop ends the session when the app closes (nothing is deleted; Resume picks it up next time).
func (squad *Squad) Stop() {
	squad.lifecycle.Lock()
	defer squad.lifecycle.Unlock()
	if current := squad.detachSession(); current != nil {
		current.stop()
		_ = current.transport.Close()
	}
	squad.forgetOnlineLinks()
	squad.cacheWrites.flush() // the last shares and lastSeen reach the file before the app closes
}

// removeStateFolder deletes tsnet's state folder: the app's own folder, and only that one.
func (squad *Squad) removeStateFolder() {
	dir := squad.config.StateDir
	if dir == "" || filepath.Base(dir) != StateFolderName {
		return
	}
	if err := os.RemoveAll(dir); err != nil {
		log.Printf("squad: deleting %s: %v", dir, err)
	}
}

// setState records the connection state; from a session, only while it's the current one.
func (squad *Squad) setState(from *session, state, problem string) {
	squad.mutex.Lock()
	if from != nil && squad.session != from {
		squad.mutex.Unlock()
		return
	}
	isSame := squad.state == state && squad.problem == problem
	squad.state, squad.problem = state, problem
	squad.mutex.Unlock()
	if !isSame {
		squad.notifyPage()
	}
}

func (squad *Squad) currentSession() *session {
	squad.mutex.Lock()
	defer squad.mutex.Unlock()
	return squad.session
}

// detachSession makes the session no longer current (its state reports are ignored from now on).
// Its streams still close normally in stop(), which records when each friend was last seen.
func (squad *Squad) detachSession() *session {
	squad.mutex.Lock()
	defer squad.mutex.Unlock()
	current := squad.session
	squad.session = nil
	return current
}

func (squad *Squad) forgetOnlineLinks() {
	squad.mutex.Lock()
	defer squad.mutex.Unlock()
	squad.onlineLinks = map[string]string{}
}

// ---------------------------------------------------------------- the session

// session is one run of the squad: the transport, the peer API server and the friend connections.
type session struct {
	transport Transport
	cancel    context.CancelFunc
	links     *friendLinks
	running   sync.WaitGroup
	// listening is closed once the peer API listener is open, or the session gave up trying
	// (Join waits for it, so friends can reach us as soon as Join returns).
	listening     chan struct{}
	listeningOnce sync.Once

	mutex     sync.Mutex
	server    *http.Server
	isStopped bool
}

// startSession starts the session's goroutine (lifecycle is held by the caller).
func (squad *Squad) startSession(transport Transport, isAlreadyUp bool) *session {
	ctx, cancel := context.WithCancel(context.Background())
	current := &session{transport: transport, cancel: cancel, listening: make(chan struct{})}
	current.links = newFriendLinks(transport.Client(), friendEvents{
		onShare:        squad.onFriendShare,
		onStreamClosed: squad.onFriendStreamClosed,
	}, squad.config.RetryDelay)
	squad.mutex.Lock()
	squad.session = current
	squad.mutex.Unlock()
	squad.setState(current, StateStarting, "")

	current.running.Add(1)
	// Goroutine: the session, started by Join or Resume; ends when stop() cancels ctx.
	go func() {
		defer current.running.Done()
		defer current.markListening() // however runSession ends, nobody waits forever
		squad.runSession(ctx, current, isAlreadyUp)
	}()
	return current
}

// runSession brings the transport up, serves the peer API and follows the peer list until ctx ends.
func (squad *Squad) runSession(ctx context.Context, current *session, isAlreadyUp bool) {
	if !isAlreadyUp {
		if err := current.transport.Up(ctx, false); err != nil {
			if errors.Is(err, errNotLoggedIn) {
				squad.setState(current, StateNeedsLogin, "")
			} else {
				squad.setState(current, StateError, err.Error())
			}
			return
		}
	}
	listener, err := current.transport.Listen()
	current.markListening()
	if err != nil {
		squad.setState(current, StateError, "listening for friends: "+err.Error())
		return
	}
	server := newPeerServer(squad.feed, current.transport)
	if !current.attachServer(server) {
		listener.Close()
		return
	}
	current.running.Add(1)
	// Goroutine: the peer API server; ends when stop() closes it, or when the transport closes the
	// listener (signed out of the tailnet; the state line already says so, so this only logs).
	go func() {
		defer current.running.Done()
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("squad: the peer API stopped: %v", err)
		}
	}()
	current.transport.WatchPeers(ctx,
		func(peers []PeerAddress) { current.links.reconcile(ctx, peers) },
		func(state, problem string) { squad.setState(current, state, problem) },
	)
}

// markListening tells whoever waits that the listener is open (or won't be).
func (current *session) markListening() {
	current.listeningOnce.Do(func() { close(current.listening) })
}

// attachServer keeps the server so stop() can close it; false if the session already stopped.
func (current *session) attachServer(server *http.Server) bool {
	current.mutex.Lock()
	defer current.mutex.Unlock()
	if current.isStopped {
		return false
	}
	current.server = server
	return true
}

// stop ends the session's goroutines and waits for them. The transport stays open (Leave still
// has to log out); the caller closes it.
func (current *session) stop() {
	current.cancel()
	current.mutex.Lock()
	current.isStopped = true
	server := current.server
	current.mutex.Unlock()
	if server != nil {
		_ = server.Close()
	}
	current.links.stopAll()
	current.running.Wait()
}
