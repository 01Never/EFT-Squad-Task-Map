package squad

// Connections to friends' copies. For each friend the transport reports online: fetch their share,
// then keep their stream open; when it drops, reconnect after 1 s, 2 s, 4 s … up to 60 s. A friend
// who goes offline (or leaves the list) is let go at once. Everything received is checked
// (DecodeShare); a bad share is dropped and logged once.

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"
	"time"
)

// friendEvents is how a connection reports back to the squad.
type friendEvents struct {
	// onShare: a valid share arrived from this connection (viaStream: on the open stream).
	onShare func(link PeerAddress, share Share, viaStream bool)
	// onStreamClosed: the stream to this connection ended.
	onStreamClosed func(link PeerAddress)
}

// friendLinks keeps one connection per friend the transport reports.
type friendLinks struct {
	client     *http.Client
	events     friendEvents
	retryDelay func(failuresInARow int) time.Duration

	// minShareInterval: at most one share a second is taken from each friend (MinShareInterval).
	minShareInterval time.Duration

	mutex       sync.Mutex
	running     map[string]*friendLink // by PeerAddress.Key
	lastProblem map[string]string      // what was last logged per connection ("log once")
	wait        sync.WaitGroup
}

type friendLink struct {
	peer   PeerAddress
	cancel context.CancelFunc
}

func newFriendLinks(
	client *http.Client, events friendEvents, retryDelay func(int) time.Duration,
) *friendLinks {
	return &friendLinks{
		client:           client,
		events:           events,
		retryDelay:       retryDelay,
		minShareInterval: MinShareInterval,
		running:          map[string]*friendLink{},
		lastProblem:      map[string]string{},
	}
}

// reconcile starts a connection for each new friend and stops the ones no longer listed.
func (links *friendLinks) reconcile(ctx context.Context, peers []PeerAddress) {
	links.mutex.Lock()
	defer links.mutex.Unlock()
	if ctx.Err() != nil {
		return
	}
	wanted := map[string]PeerAddress{}
	for _, peer := range peers {
		wanted[peer.Key] = peer
	}
	for key, link := range links.running {
		if peer, stillWanted := wanted[key]; !stillWanted || peer != link.peer {
			link.cancel()
			delete(links.running, key)
		}
	}
	for key, peer := range wanted {
		if _, isRunning := links.running[key]; isRunning {
			continue
		}
		linkContext, cancel := context.WithCancel(ctx)
		links.running[key] = &friendLink{peer: peer, cancel: cancel}
		links.wait.Add(1)
		// Goroutine: one per friend, started here; ends when reconcile drops the friend or the
		// squad session stops (both cancel linkContext).
		go func() {
			defer links.wait.Done()
			links.keepConnected(linkContext, peer)
		}()
	}
}

// stopAll ends every connection and waits for them.
func (links *friendLinks) stopAll() {
	links.mutex.Lock()
	for key, link := range links.running {
		link.cancel()
		delete(links.running, key)
	}
	links.mutex.Unlock()
	links.wait.Wait()
}

// keepConnected connects, and reconnects with backoff, until ctx ends.
func (links *friendLinks) keepConnected(ctx context.Context, peer PeerAddress) {
	failuresInARow := 0
	for {
		receivedAny := links.connectOnce(ctx, peer)
		if ctx.Err() != nil {
			return
		}
		if receivedAny {
			failuresInARow = 0
		}
		failuresInARow++
		if !sleepOrDone(ctx, links.retryDelay(failuresInARow)) {
			return
		}
	}
}

// connectOnce fetches the friend's share, then reads their stream until it ends. receivedAny is
// true when the stream delivered at least one valid share (so the backoff starts over).
func (links *friendLinks) connectOnce(ctx context.Context, peer PeerAddress) (receivedAny bool) {
	if err := links.fetchShare(ctx, peer); err != nil {
		links.logOnce(peer, err.Error())
		return false
	}
	streamContext, cancel := context.WithCancel(ctx)
	defer cancel()
	response, err := links.openStream(streamContext, peer)
	if err != nil {
		links.logOnce(peer, err.Error())
		return false
	}
	defer links.events.onStreamClosed(peer)

	newest := newNewestEvent()
	readEnded := make(chan error, 1)
	// Goroutine: reads the friend's stream, keeping only the newest event; started here, ends when
	// the stream ends or its body is closed just below.
	paced := &paceReader{ctx: streamContext, reader: response.Body, bytesPerSecond: maxStreamBytesPerSecond}
	go func() { readEnded <- readShareEvents(paced, newest.put) }()

	receivedAny, readErr, hasReadEnded := links.applyNewest(streamContext, peer, newest, readEnded)
	response.Body.Close()
	if !hasReadEnded {
		<-readEnded
	}
	if readErr != nil && ctx.Err() == nil {
		links.logOnce(peer, "stream: "+readErr.Error())
	}
	return receivedAny
}

// applyNewest takes the newest share from the stream at most once per minShareInterval: shares
// that arrive meanwhile replace the waiting one, so a friend sending in a loop costs one check a
// second, and the last one sent always wins. It returns when the stream ends (hasReadEnded) or
// ctx ends.
func (links *friendLinks) applyNewest(
	ctx context.Context, peer PeerAddress, newest *newestEvent, readEnded <-chan error,
) (receivedAny bool, readErr error, hasReadEnded bool) {
	var lastApplied time.Time
	applyWaiting := func() {
		data := newest.take()
		if data == nil {
			return
		}
		if links.acceptShare(peer, data, true) {
			receivedAny = true
		}
		lastApplied = time.Now()
	}
	for {
		select {
		case <-ctx.Done():
			return receivedAny, nil, false
		case readErr = <-readEnded:
			applyWaiting() // the share sent last before the stream ended
			return receivedAny, readErr, true
		case <-newest.arrived:
			wait := links.minShareInterval - time.Since(lastApplied)
			if wait > 0 && !sleepOrDone(ctx, wait) {
				return receivedAny, nil, false
			}
			applyWaiting()
		}
	}
}

// maxStreamBytesPerSecond: a friend's stream is read at most this fast, one full share a second
// plus room for the SSE framing (shares are only taken once a second anyway). An honest friend
// sends about one share a second; a friend sending in a loop is held back by TCP instead of
// costing CPU here (QA: reading a flood at full speed took about 60% of a core).
const maxStreamBytesPerSecond = MaxShareBytes + 64<<10

// paceReader reads at most bytesPerSecond, sleeping out the rest of the second once that much
// was read (a timer only then; ctx ends the wait).
type paceReader struct {
	ctx            context.Context
	reader         io.Reader
	bytesPerSecond int
	windowStart    time.Time
	readInWindow   int
}

func (pace *paceReader) Read(buffer []byte) (int, error) {
	if time.Since(pace.windowStart) >= time.Second {
		pace.windowStart, pace.readInWindow = time.Now(), 0
	}
	if pace.readInWindow >= pace.bytesPerSecond {
		if !sleepOrDone(pace.ctx, time.Second-time.Since(pace.windowStart)) {
			return 0, pace.ctx.Err()
		}
		pace.windowStart, pace.readInWindow = time.Now(), 0
	}
	allowed := min(len(buffer), pace.bytesPerSecond-pace.readInWindow)
	count, err := pace.reader.Read(buffer[:allowed])
	pace.readInWindow += count
	return count, err
}

// newestEvent holds the newest event read from a friend's stream until it is taken.
type newestEvent struct {
	mutex   sync.Mutex
	data    []byte
	arrived chan struct{} // holds one signal while there is something to take
}

func newNewestEvent() *newestEvent {
	return &newestEvent{arrived: make(chan struct{}, 1)}
}

// put replaces any event still waiting.
func (slot *newestEvent) put(data []byte) {
	slot.mutex.Lock()
	slot.data = data
	slot.mutex.Unlock()
	select {
	case slot.arrived <- struct{}{}:
	default:
	}
}

func (slot *newestEvent) take() []byte {
	slot.mutex.Lock()
	defer slot.mutex.Unlock()
	data := slot.data
	slot.data = nil
	return data
}

// fetchShare: GET /squad/v1/share. "Nothing shared yet" (404) is fine.
func (links *friendLinks) fetchShare(ctx context.Context, peer PeerAddress) error {
	fetchContext, cancel := context.WithTimeout(ctx, peerFetchTimeout)
	defer cancel()
	shareURL := peer.BaseURL + "/squad/v1/share"
	request, err := http.NewRequestWithContext(fetchContext, http.MethodGet, shareURL, nil)
	if err != nil {
		return err
	}
	response, err := links.client.Do(request)
	if err != nil {
		return fmt.Errorf("can't reach %s: %w", peer.BaseURL, err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("%s answered %s", peer.BaseURL, response.Status)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, MaxShareBytes+1))
	if err != nil {
		return fmt.Errorf("reading %s: %w", peer.BaseURL, err)
	}
	links.acceptShare(peer, data, false)
	return nil
}

// openStream: GET /squad/v1/stream. The client waits at most peerFetchTimeout for the answer's
// headers (newPeerHTTPClient); after that the stream may stay open and idle as long as it likes.
func (links *friendLinks) openStream(ctx context.Context, peer PeerAddress) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, peer.BaseURL+"/squad/v1/stream", nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "text/event-stream")
	response, err := links.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("can't open the stream of %s: %w", peer.BaseURL, err)
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, fmt.Errorf("%s answered the stream with %s", peer.BaseURL, response.Status)
	}
	return response, nil
}

// acceptShare checks a received share and hands it on. Returns false (and logs once) when it's
// dropped.
func (links *friendLinks) acceptShare(peer PeerAddress, data []byte, viaStream bool) bool {
	share, err := DecodeShare(data)
	if err != nil {
		links.logOnce(peer, "dropped a share: "+err.Error())
		return false
	}
	if !ShareFitsPeer(share, peer.PlayerID) {
		problem := fmt.Sprintf("dropped a share: it names player %s, the node is %s",
			share.Player.ID, peer.PlayerID)
		links.logOnce(peer, problem)
		return false
	}
	links.clearProblem(peer)
	links.events.onShare(peer, share, viaStream)
	return true
}

// logOnce writes a problem with a friend's connection to the console, but not the same one twice
// in a row (a friend who is offline would otherwise log on every retry).
func (links *friendLinks) logOnce(peer PeerAddress, problem string) {
	links.mutex.Lock()
	defer links.mutex.Unlock()
	if links.lastProblem[peer.Key] == problem {
		return
	}
	links.lastProblem[peer.Key] = problem
	log.Printf("squad: friend %s: %s", peer.Key, problem)
}

func (links *friendLinks) clearProblem(peer PeerAddress) {
	links.mutex.Lock()
	defer links.mutex.Unlock()
	delete(links.lastProblem, peer.Key)
}

// readShareEvents reads Server-Sent Events and calls onData with each event's data, until the
// stream ends. A line longer than a share may be ends it with an error.
func readShareEvents(body io.Reader, onData func(data []byte)) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64<<10), MaxShareBytes+1024)
	var data bytes.Buffer
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			if data.Len() > 0 {
				onData(append([]byte(nil), data.Bytes()...))
				data.Reset()
			}
			continue
		}
		if value, isData := bytes.CutPrefix(line, []byte("data:")); isData {
			if data.Len() > 0 {
				data.WriteByte('\n')
			}
			data.Write(bytes.TrimPrefix(value, []byte(" ")))
			if data.Len() > MaxShareBytes {
				return fmt.Errorf("an event is over %d bytes", MaxShareBytes)
			}
		}
		// "event:" and ": comment" lines carry nothing we need.
	}
	return scanner.Err() // nil when the friend closed the stream
}

// sleepOrDone waits, or returns false as soon as ctx ends.
func sleepOrDone(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
