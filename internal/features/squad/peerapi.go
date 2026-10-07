package squad

// The peer API: what friends' copies ask this copy for. It runs on its own listener (the tailnet,
// or a 127.0.0.1 port with the dev transport), never on the page's server, and has two routes:
//
//	GET /squad/v1/share   my latest share (404 until the page has sent one)
//	GET /squad/v1/stream  Server-Sent Events: my share now, then again each time its rev changes
//
// Nothing else is served, nothing can be written, and only squad nodes are answered.

import (
	"context"
	"net/http"
	"net/netip"
	"sync"
	"time"
)

const (
	// maxPeerStreams: a squad is at most 6 people; this leaves room for reconnects overlapping.
	maxPeerStreams = 16
	// maxPeerHeaderBytes: friends send a plain GET; nothing bigger is needed.
	maxPeerHeaderBytes = 16 << 10
	// peerHeaderTimeout: a caller that doesn't finish its request line in time is dropped.
	peerHeaderTimeout = 10 * time.Second
	// peerIdleTimeout: a kept-alive connection with no request for this long is closed
	// (QA: idle connections were otherwise held forever).
	peerIdleTimeout = 60 * time.Second
	// peerWriteTimeout: each write to a stream must finish within this, so a caller that stops
	// reading loses its stream instead of holding it (and a goroutine) forever.
	peerWriteTimeout = 10 * time.Second
)

// peerAccess is what the peer API needs from the transport (Transport has all of it).
type peerAccess interface {
	IdentifyCaller(ctx context.Context, remoteAddr string) (callerKey string, isAllowed bool)
	OwnAddresses() []netip.AddrPort
	StreamsPerCaller() int
}

// shareFeed holds my latest share, encoded, and wakes friends' streams when it changes.
type shareFeed struct {
	mutex       sync.Mutex
	encoded     []byte                   // nil until the page has sent a share
	subscribers map[chan struct{}]string // each open stream and the caller holding it
}

func newShareFeed() *shareFeed {
	return &shareFeed{subscribers: map[chan struct{}]string{}}
}

// publish replaces my share and wakes every stream. A stream that hasn't sent the previous one
// yet just sends the newest (each message is the full share, so nothing is lost).
func (feed *shareFeed) publish(encoded []byte) {
	feed.mutex.Lock()
	defer feed.mutex.Unlock()
	feed.encoded = encoded
	for wake := range feed.subscribers {
		select {
		case wake <- struct{}{}:
		default:
		}
	}
}

func (feed *shareFeed) current() []byte {
	feed.mutex.Lock()
	defer feed.mutex.Unlock()
	return feed.encoded
}

// subscribe adds a stream for a caller; ok is false when maxPeerStreams are open in all, or this
// caller already holds perCaller of them.
func (feed *shareFeed) subscribe(callerKey string, perCaller int) (chan struct{}, bool) {
	feed.mutex.Lock()
	defer feed.mutex.Unlock()
	if len(feed.subscribers) >= maxPeerStreams {
		return nil, false
	}
	heldByCaller := 0
	for _, holder := range feed.subscribers {
		if holder == callerKey {
			heldByCaller++
		}
	}
	if heldByCaller >= perCaller {
		return nil, false
	}
	wake := make(chan struct{}, 1)
	feed.subscribers[wake] = callerKey
	return wake, true
}

func (feed *shareFeed) unsubscribe(wake chan struct{}) {
	feed.mutex.Lock()
	defer feed.mutex.Unlock()
	delete(feed.subscribers, wake)
}

// callerKeyContext carries the caller's key from the check to the stream handler.
type callerKeyContext struct{}

// newPeerServer builds the peer API's HTTP server. Every request is checked first: the Host must
// be one of our own addresses (IsOwnHost: blocks DNS rebinding), no browser headers
// (IsBrowserRequest), and the caller must be a squad node (or this PC, dev transport).
func newPeerServer(feed *shareFeed, access peerAccess) *http.Server {
	routes := http.NewServeMux()
	routes.HandleFunc("GET /squad/v1/share", func(writer http.ResponseWriter, _ *http.Request) {
		serveShare(writer, feed)
	})
	routes.HandleFunc("GET /squad/v1/stream", func(writer http.ResponseWriter, request *http.Request) {
		callerKey, _ := request.Context().Value(callerKeyContext{}).(string)
		serveShareStream(writer, request, feed, callerKey, access.StreamsPerCaller())
	})
	routes.HandleFunc("/", func(writer http.ResponseWriter, _ *http.Request) {
		http.Error(writer, "Not found", http.StatusNotFound)
	})
	guarded := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		refusal := "Only squad members' copies of Squad Task Map can ask this."
		if !IsOwnHost(request.Host, access.OwnAddresses()) {
			http.Error(writer, refusal, http.StatusMisdirectedRequest)
			return
		}
		if IsBrowserRequest(request.Header) {
			http.Error(writer, refusal, http.StatusForbidden)
			return
		}
		callerKey, isAllowed := access.IdentifyCaller(request.Context(), request.RemoteAddr)
		if !isAllowed {
			http.Error(writer, refusal, http.StatusForbidden)
			return
		}
		request.Body = http.MaxBytesReader(writer, request.Body, 0) // GETs only: no body
		withCaller := context.WithValue(request.Context(), callerKeyContext{}, callerKey)
		routes.ServeHTTP(writer, request.WithContext(withCaller))
	})
	return &http.Server{
		Handler:           guarded,
		ReadHeaderTimeout: peerHeaderTimeout,
		IdleTimeout:       peerIdleTimeout,
		MaxHeaderBytes:    maxPeerHeaderBytes,
	}
}

func serveShare(writer http.ResponseWriter, feed *shareFeed) {
	encoded := feed.current()
	if encoded == nil {
		http.Error(writer, "Nothing shared yet", http.StatusNotFound)
		return
	}
	_ = http.NewResponseController(writer).SetWriteDeadline(time.Now().Add(peerWriteTimeout))
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	writer.Write(encoded)
}

// serveShareStream keeps one friend's stream open. It sends my share at once (if there is one),
// then again whenever it changes. Idle in between: no keep-alive timer. A friend that went away
// is noticed when the tailnet reports it offline, or when a write fails or times out.
//
// Goroutine note: runs on the HTTP server's goroutine for the request; ends when the friend
// disconnects, a write takes over peerWriteTimeout, or the server is closed (Leave, app closing).
func serveShareStream(
	writer http.ResponseWriter, request *http.Request, feed *shareFeed, callerKey string, perCaller int,
) {
	controller := http.NewResponseController(writer)
	wake, ok := feed.subscribe(callerKey, perCaller)
	if !ok {
		http.Error(writer, "Too many open streams", http.StatusServiceUnavailable)
		return
	}
	defer feed.unsubscribe(wake)

	writer.Header().Set("Content-Type", "text/event-stream")
	writer.Header().Set("Cache-Control", "no-cache")
	pending := []byte(": squad\n\n")
	var lastSent []byte
	for {
		encoded := feed.current()
		if encoded != nil && string(encoded) != string(lastSent) {
			pending = append(pending, shareEvent(encoded)...)
			lastSent = encoded
		}
		if pending != nil {
			_ = controller.SetWriteDeadline(time.Now().Add(peerWriteTimeout))
			if _, err := writer.Write(pending); err != nil {
				return
			}
			if controller.Flush() != nil {
				return
			}
			pending = nil
		}
		select {
		case <-request.Context().Done():
			return
		case <-wake:
		}
	}
}

// shareEvent is one SSE message carrying a whole share (JSON has no newlines, so one data line).
func shareEvent(encoded []byte) []byte {
	return []byte("event: share\ndata: " + string(encoded) + "\n\n")
}
