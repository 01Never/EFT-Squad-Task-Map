package events

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"

	"squadtaskmap/internal/storage"
)

// At most this many undelivered events are kept; older ones are dropped.
const maxPendingEvents = 500

// A page more than this many live messages behind is disconnected (it reconnects and catches up).
const clientBufferSize = 64

// Event is one message to the page: a "type" plus that event's fields.
type Event map[string]any

// New makes an event of the given type with the given fields.
func New(eventType string, fields map[string]any) Event {
	event := Event{"type": eventType}
	for key, value := range fields {
		event[key] = value
	}
	return event
}

// Hub keeps the open page connections and the queue of events waiting to be acknowledged.
type Hub struct {
	mutex       sync.Mutex
	clients     map[*client]bool
	pending     []Event
	lastID      float64
	pendingFile string
	closed      chan struct{} // closed by Close: every open stream ends (shutdown)
}

type client struct {
	messages chan []byte
	dropped  chan struct{} // closed when the page fell too far behind; its stream ends
}

// NewHub loads any events that were still waiting when the app last closed.
func NewHub(pendingFile string) *Hub {
	hub := &Hub{clients: map[*client]bool{}, pendingFile: pendingFile, closed: make(chan struct{})}
	if data, err := os.ReadFile(pendingFile); err == nil {
		_ = json.Unmarshal(data, &hub.pending)
	}
	// Ids continue from the highest one still queued (0 when the queue is empty), as v2 did.
	for _, event := range hub.pending {
		if id, ok := event["id"].(float64); ok && id > hub.lastID {
			hub.lastID = id
		}
	}
	return hub
}

// Broadcast sends a live-only event to every open page. Nothing is kept if no page is open.
func (hub *Hub) Broadcast(event Event) {
	hub.mutex.Lock()
	defer hub.mutex.Unlock()
	hub.broadcastLocked(event)
}

func (hub *Hub) broadcastLocked(event Event) {
	message := encode(event)
	for c := range hub.clients {
		hub.sendLocked(c, message)
	}
}

// Deliver queues an event that changes saved data, then sends it to every open page. It stays
// queued (also across restarts) until a page acknowledges it. Queueing and sending happen in one
// locked step, so a page that connects meanwhile gets the event once (in its queued batch or live).
func (hub *Hub) Deliver(event Event) {
	hub.mutex.Lock()
	hub.lastID++
	queued := Event{"id": hub.lastID}
	for key, value := range event {
		queued[key] = value
	}
	hub.pending = append(hub.pending, queued)
	if len(hub.pending) > maxPendingEvents {
		hub.pending = hub.pending[len(hub.pending)-maxPendingEvents:]
	}
	hub.savePendingLocked()
	hub.broadcastLocked(queued)
	hub.mutex.Unlock()
}

// Acknowledge drops every queued event up to and including this id: the page has applied them.
func (hub *Hub) Acknowledge(upToID float64) {
	hub.mutex.Lock()
	defer hub.mutex.Unlock()
	kept := hub.pending[:0]
	for _, event := range hub.pending {
		if id, _ := event["id"].(float64); id > upToID {
			kept = append(kept, event)
		}
	}
	if len(kept) != len(hub.pending) {
		hub.pending = kept
		hub.savePendingLocked()
	}
	hub.pending = kept
}

func (hub *Hub) savePendingLocked() {
	data, _ := json.Marshal(hub.pendingOrEmptyLocked())
	if err := storage.WriteFileAtomic(hub.pendingFile, data); err != nil {
		log.Printf("saving pending events: %v", err)
	}
}

func (hub *Hub) pendingOrEmptyLocked() []Event {
	if hub.pending == nil {
		return []Event{}
	}
	return hub.pending
}

// ServeSSE keeps one page connection open and writes events to it as they happen.
// The connection sits idle (no polling) until there's something to send.
//
// Goroutine note: this runs in the HTTP server's goroutine for the request. It ends when the page
// disconnects (the request context is cancelled), when it fell too far behind (dropped), or when
// the app closes (Close); then it unregisters the client.
func (hub *Hub) ServeSSE(writer http.ResponseWriter, request *http.Request) {
	flusher, canFlush := writer.(http.Flusher)
	if !canFlush {
		http.Error(writer, "streaming not supported", http.StatusInternalServerError)
		return
	}
	header := writer.Header()
	header.Set("Content-Type", "text/event-stream")
	header.Set("Cache-Control", "no-cache")
	header.Set("Connection", "keep-alive")
	writer.WriteHeader(http.StatusOK)

	c := &client{messages: make(chan []byte, clientBufferSize), dropped: make(chan struct{})}
	hub.mutex.Lock()
	hub.clients[c] = true
	queued := append([]Event(nil), hub.pending...)
	hub.mutex.Unlock()
	defer func() {
		hub.mutex.Lock()
		delete(hub.clients, c)
		hub.mutex.Unlock()
	}()

	fmt.Fprint(writer, ": hi\n\n")
	for _, event := range queued {
		writer.Write(encode(event))
	}
	flusher.Flush()

	for {
		select {
		case <-request.Context().Done():
			return
		case <-c.dropped:
			return // the browser sees the stream end, reconnects and gets the queue again
		case <-hub.closed:
			return
		case message := <-c.messages:
			if _, err := writer.Write(message); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// ClientCount is how many pages are connected.
func (hub *Hub) ClientCount() int {
	hub.mutex.Lock()
	defer hub.mutex.Unlock()
	return len(hub.clients)
}

// sendLocked hands a message to a client without ever blocking the sender. A page that has stopped
// reading (clientBufferSize messages behind) is dropped: its stream is ended, so the browser
// reconnects and gets the queued events again.
func (hub *Hub) sendLocked(c *client, message []byte) {
	select {
	case c.messages <- message:
	default:
		delete(hub.clients, c)
		close(c.dropped)
	}
}

// Close ends every open stream (the app is shutting down) so the web server can stop at once.
func (hub *Hub) Close() {
	hub.mutex.Lock()
	defer hub.mutex.Unlock()
	select {
	case <-hub.closed:
	default:
		close(hub.closed)
	}
}

func encode(event Event) []byte {
	data, _ := json.Marshal(event)
	return []byte("data: " + string(data) + "\n\n")
}
