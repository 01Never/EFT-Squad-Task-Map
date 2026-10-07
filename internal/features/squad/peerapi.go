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
)

// shareFeed holds my latest share, encoded, and wakes friends' streams when it changes.
type shareFeed struct {
	mutex       sync.Mutex
	encoded     []byte // nil until the page has sent a share
	subscribers map[chan struct{}]bool
}

func newShareFeed() *shareFeed {
	return &shareFeed{subscribers: map[chan struct{}]bool{}}
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

// subscribe adds a stream; ok is false when maxPeerStreams are already open.
func (feed *shareFeed) subscribe() (chan struct{}, bool) {
	feed.mutex.Lock()
	defer feed.mutex.Unlock()
	if len(feed.subscribers) >= maxPeerStreams {
		return nil, false
	}
	wake := make(chan struct{}, 1)
	feed.subscribers[wake] = true
	return wake, true
}

func (feed *shareFeed) unsubscribe(wake chan struct{}) {
	feed.mutex.Lock()
	defer feed.mutex.Unlock()
	delete(feed.subscribers, wake)
}

// newPeerServer builds the peer API's HTTP server.
func newPeerServer(
	feed *shareFeed, isCallerAllowed func(ctx context.Context, remoteAddr string) bool,
) *http.Server {
	routes := http.NewServeMux()
	routes.HandleFunc("GET /squad/v1/share", func(writer http.ResponseWriter, _ *http.Request) {
		serveShare(writer, feed)
	})
	routes.HandleFunc("GET /squad/v1/stream", func(writer http.ResponseWriter, request *http.Request) {
		serveShareStream(writer, request, feed)
	})
	routes.HandleFunc("/", func(writer http.ResponseWriter, _ *http.Request) {
		http.Error(writer, "Not found", http.StatusNotFound)
	})
	guarded := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if IsBrowserRequest(request.Header) || !isCallerAllowed(request.Context(), request.RemoteAddr) {
			refusal := "Only squad members' copies of Squad Task Map can ask this."
			http.Error(writer, refusal, http.StatusForbidden)
			return
		}
		request.Body = http.MaxBytesReader(writer, request.Body, 0) // GETs only: no body
		routes.ServeHTTP(writer, request)
	})
	return &http.Server{
		Handler:           guarded,
		ReadHeaderTimeout: peerHeaderTimeout,
		MaxHeaderBytes:    maxPeerHeaderBytes,
	}
}

func serveShare(writer http.ResponseWriter, feed *shareFeed) {
	encoded := feed.current()
	if encoded == nil {
		http.Error(writer, "Nothing shared yet", http.StatusNotFound)
		return
	}
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	writer.Write(encoded)
}

// serveShareStream keeps one friend's stream open. It sends my share at once (if there is one),
// then again whenever it changes. Idle in between: no keep-alive timer. A friend that went away
// is noticed when the tailnet reports it offline, or when a write fails.
//
// Goroutine note: runs on the HTTP server's goroutine for the request; ends when the friend
// disconnects or the server is closed (Leave squad, app closing).
func serveShareStream(writer http.ResponseWriter, request *http.Request, feed *shareFeed) {
	flusher, canFlush := writer.(http.Flusher)
	if !canFlush {
		http.Error(writer, "streaming not supported", http.StatusInternalServerError)
		return
	}
	wake, ok := feed.subscribe()
	if !ok {
		http.Error(writer, "Too many open streams", http.StatusServiceUnavailable)
		return
	}
	defer feed.unsubscribe(wake)

	writer.Header().Set("Content-Type", "text/event-stream")
	writer.Header().Set("Cache-Control", "no-cache")
	writer.WriteHeader(http.StatusOK)
	writer.Write([]byte(": squad\n\n"))
	var lastSent []byte
	for {
		encoded := feed.current()
		if encoded != nil && string(encoded) != string(lastSent) {
			if _, err := writer.Write(shareEvent(encoded)); err != nil {
				return
			}
			lastSent = encoded
		}
		flusher.Flush()
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
