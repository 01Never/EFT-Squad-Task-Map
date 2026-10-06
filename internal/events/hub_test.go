package events

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A frame can take this long to arrive before a test gives up (it normally takes microseconds).
const frameTimeout = 3 * time.Second

func pendingFileIn(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "squad-task-map-pending.json")
}

// queuedIDs reads the ids saved in the pending file.
func queuedIDs(t *testing.T, pendingFile string) []float64 {
	t.Helper()
	data, err := os.ReadFile(pendingFile)
	if err != nil {
		t.Fatal(err)
	}
	var queued []map[string]any
	if err := json.Unmarshal(data, &queued); err != nil {
		t.Fatalf("pending file isn't a JSON list: %s", data)
	}
	ids := []float64{}
	for _, event := range queued {
		ids = append(ids, event["id"].(float64))
	}
	return ids
}

func sameIDs(got, want []float64) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

func TestDeliveredEventsGetIncreasingIdsAndAreSavedUntilAcknowledged(t *testing.T) {
	pendingFile := pendingFileIn(t)
	hub := NewHub(pendingFile)
	hub.Deliver(New(Task, map[string]any{"taskId": "a", "status": "started"}))
	hub.Deliver(New(Task, map[string]any{"taskId": "b", "status": "finished"}))
	hub.Deliver(New(RaidEnd, map[string]any{"map": "customs", "deleted": 2}))

	if got := queuedIDs(t, pendingFile); !sameIDs(got, []float64{1, 2, 3}) {
		t.Fatalf("queued ids = %v, want [1 2 3]", got)
	}
	data, _ := os.ReadFile(pendingFile)
	var saved []map[string]any
	json.Unmarshal(data, &saved)
	if saved[1]["type"] != Task || saved[1]["taskId"] != "b" || saved[1]["status"] != "finished" {
		t.Errorf("the saved event lost its fields: %v", saved[1])
	}
}

func TestAcknowledgingDropsEveryEventUpToThatId(t *testing.T) {
	cases := []struct {
		name  string
		upTo  float64
		want  []float64
		write bool // whether the file changes
	}{
		{"up to the second", 2, []float64{3}, true},
		{"everything", 3, []float64{}, true},
		{"an id past the end drops everything", 10, []float64{}, true},
		{"an id before the queue changes nothing", 0, []float64{1, 2, 3}, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			pendingFile := pendingFileIn(t)
			hub := NewHub(pendingFile)
			for i := 0; i < 3; i++ {
				hub.Deliver(New(Task, map[string]any{"taskId": "x"}))
			}
			// Mark the file so an untouched one can be told apart from a rewritten one.
			before, _ := os.ReadFile(pendingFile)
			os.WriteFile(pendingFile, append(before, ' '), 0o644)

			hub.Acknowledge(testCase.upTo)
			if got := queuedIDs(t, pendingFile); !sameIDs(got, testCase.want) {
				t.Errorf("queued ids = %v, want %v", got, testCase.want)
			}
			after, _ := os.ReadFile(pendingFile)
			if rewritten := !strings.HasSuffix(string(after), " "); rewritten != testCase.write {
				t.Errorf("file rewritten = %v, want %v", rewritten, testCase.write)
			}
		})
	}
}

func TestANewHubContinuesIdsFromTheHighestQueuedOne(t *testing.T) {
	cases := []struct {
		name   string
		file   string // the pending file ("" = no file)
		wantID float64
	}{
		{"no file starts at 1", "", 1},
		{"after a queue of 1..3 comes 4", `[{"id":1,"type":"task"},{"id":2,"type":"task"},{"id":3,"type":"task"}]`, 4},
		{"the highest id counts, not the last one", `[{"id":7,"type":"task"},{"id":3,"type":"task"}]`, 8},
		{"an empty queue starts at 1 again, as v2 did", `[]`, 1},
		{"a broken file starts fresh", `[{"id":`, 1},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			pendingFile := pendingFileIn(t)
			if testCase.file != "" {
				os.WriteFile(pendingFile, []byte(testCase.file), 0o644)
			}
			hub := NewHub(pendingFile)
			hub.Deliver(New(Task, nil))
			ids := queuedIDs(t, pendingFile)
			if last := ids[len(ids)-1]; last != testCase.wantID {
				t.Errorf("new id = %v, want %v", last, testCase.wantID)
			}
		})
	}
}

func TestARestartKeepsTheQueueAndItsIds(t *testing.T) {
	pendingFile := pendingFileIn(t)
	first := NewHub(pendingFile)
	first.Deliver(New(Task, map[string]any{"taskId": "a"}))
	first.Deliver(New(Task, map[string]any{"taskId": "b"}))
	first.Acknowledge(1)

	second := NewHub(pendingFile)
	second.Deliver(New(Task, map[string]any{"taskId": "c"}))
	if got := queuedIDs(t, pendingFile); !sameIDs(got, []float64{2, 3}) {
		t.Errorf("queued ids = %v, want [2 3]", got)
	}
}

func TestTheQueueKeepsTheNewest500Events(t *testing.T) {
	pendingFile := pendingFileIn(t)
	hub := NewHub(pendingFile)
	for i := 0; i < maxPendingEvents+5; i++ {
		hub.Deliver(New(Task, nil))
	}
	ids := queuedIDs(t, pendingFile)
	if len(ids) != maxPendingEvents || ids[0] != 6 || ids[len(ids)-1] != maxPendingEvents+5 {
		t.Errorf("queue holds %d events, ids %v…%v; want 500 events, 6…505", len(ids), ids[0], ids[len(ids)-1])
	}
}

func TestABroadcastWithNoPageOpenIsDropped(t *testing.T) {
	pendingFile := pendingFileIn(t)
	hub := NewHub(pendingFile)
	hub.Broadcast(New(GPS, map[string]any{"gps": map[string]any{"x": 1}}))
	if _, err := os.Stat(pendingFile); !os.IsNotExist(err) {
		t.Error("a broadcast was saved to the pending file")
	}
	if hub.ClientCount() != 0 {
		t.Errorf("client count = %d", hub.ClientCount())
	}
	// A page that opens afterwards doesn't get it.
	server := httptest.NewServer(http.HandlerFunc(hub.ServeSSE))
	defer server.Close()
	frames, cancel := openStream(t, server.URL)
	defer cancel()
	if frame := nextFrame(t, frames); frame != ": hi" {
		t.Fatalf("first frame = %q", frame)
	}
	hub.Broadcast(New(Mode, map[string]any{"mode": "pve"}))
	if frame := nextFrame(t, frames); !strings.Contains(frame, `"type":"mode"`) {
		t.Errorf("next frame = %q, want the live mode event (not the old GPS one)", frame)
	}
}

func TestAPageGetsAGreetingThenTheQueueThenLiveEvents(t *testing.T) {
	hub := NewHub(pendingFileIn(t))
	hub.Deliver(New(Task, map[string]any{"taskId": "queued"}))
	server := httptest.NewServer(http.HandlerFunc(hub.ServeSSE))
	defer server.Close()

	request, _ := http.NewRequest(http.MethodGet, server.URL, nil)
	ctx, cancel := context.WithCancel(context.Background())
	response, err := http.DefaultClient.Do(request.WithContext(ctx))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if got := response.Header.Get("Content-Type"); got != "text/event-stream" {
		t.Errorf("content type = %q", got)
	}
	frames := readFrames(response.Body)

	want := []string{
		`: hi`,
		`data: {"id":1,"taskId":"queued","type":"task"}`,
	}
	for _, wantFrame := range want {
		if frame := nextFrame(t, frames); frame != wantFrame {
			t.Fatalf("frame = %q, want %q", frame, wantFrame)
		}
	}
	hub.Broadcast(New(RaidStart, map[string]any{"map": "woods"}))
	if frame := nextFrame(t, frames); frame != `data: {"map":"woods","type":"raidStart"}` {
		t.Errorf("live broadcast frame = %q", frame)
	}
	hub.Deliver(New(Task, map[string]any{"taskId": "live"}))
	if frame := nextFrame(t, frames); frame != `data: {"id":2,"taskId":"live","type":"task"}` {
		t.Errorf("live delivered frame = %q", frame)
	}

	// The page closes: the stream ends and the client is forgotten.
	cancel()
	waitFor(t, "the closed page to be unregistered", func() bool { return hub.ClientCount() == 0 })
}

func TestAPageThatConnectsWhileEventsArriveGetsEachOneExactlyOnce(t *testing.T) {
	const count = 100
	hub := NewHub(pendingFileIn(t))
	server := httptest.NewServer(http.HandlerFunc(hub.ServeSSE))
	defer server.Close()

	delivered := make(chan struct{})
	// Goroutine: delivers the events one by one while the page connects; ends after the last one.
	go func() {
		defer close(delivered)
		for i := 0; i < count; i++ {
			hub.Deliver(New(Task, nil))
			time.Sleep(time.Millisecond)
		}
	}()
	time.Sleep(20 * time.Millisecond) // connect somewhere in the middle
	frames, cancel := openStream(t, server.URL)
	defer cancel()
	if frame := nextFrame(t, frames); frame != ": hi" {
		t.Fatalf("first frame = %q", frame)
	}
	var ids []float64
	for len(ids) < count {
		frame := nextFrame(t, frames)
		var event map[string]any
		if err := json.Unmarshal([]byte(strings.TrimPrefix(frame, "data: ")), &event); err != nil {
			t.Fatalf("frame %q: %v", frame, err)
		}
		ids = append(ids, event["id"].(float64))
	}
	<-delivered
	for i, id := range ids {
		if id != float64(i+1) {
			t.Fatalf("ids = %v, want 1..%d in order, each once", ids, count)
		}
	}
}

// blockedPage is a page that stopped reading: after its greeting is flushed, every write waits until
// release is closed.
type blockedPage struct {
	header  http.Header
	release chan struct{}
	greeted bool
}

func (page *blockedPage) Header() http.Header { return page.header }
func (page *blockedPage) WriteHeader(int)     {}
func (page *blockedPage) Flush()              { page.greeted = true }
func (page *blockedPage) Write(data []byte) (int, error) {
	if page.greeted {
		<-page.release
	}
	return len(data), nil
}

func TestAPageThatFallsTooFarBehindIsDisconnectedSoItReconnects(t *testing.T) {
	hub := NewHub(pendingFileIn(t))
	page := &blockedPage{header: http.Header{}, release: make(chan struct{})}
	request := httptest.NewRequest(http.MethodGet, "/api/events", nil)
	ended := make(chan struct{})
	// Goroutine: the page's stream; ends when the hub drops the page.
	go func() {
		hub.ServeSSE(page, request)
		close(ended)
	}()
	waitFor(t, "the page to connect", func() bool { return hub.ClientCount() == 1 })

	// One message may be in the blocked write, 64 wait in the buffer; the next one is too many.
	for i := 0; i < clientBufferSize+2; i++ {
		hub.Broadcast(New(GPS, map[string]any{"n": i}))
	}
	if hub.ClientCount() != 0 {
		t.Fatalf("client count = %d, want the slow page dropped", hub.ClientCount())
	}
	close(page.release)
	select {
	case <-ended:
	case <-time.After(frameTimeout):
		t.Fatal("the dropped page's stream didn't end, so the browser would never reconnect")
	}
}

func TestClosingTheHubEndsEveryOpenStream(t *testing.T) {
	hub := NewHub(pendingFileIn(t))
	server := httptest.NewServer(http.HandlerFunc(hub.ServeSSE))
	defer server.Close()
	first, cancelFirst := openStream(t, server.URL)
	defer cancelFirst()
	second, cancelSecond := openStream(t, server.URL)
	defer cancelSecond()
	nextFrame(t, first)
	nextFrame(t, second)

	hub.Close()
	hub.Close() // closing twice is harmless
	for _, frames := range []<-chan string{first, second} {
		select {
		case frame, open := <-frames:
			if open {
				t.Errorf("got %q, want the stream to end", frame)
			}
		case <-time.After(frameTimeout):
			t.Fatal("a stream stayed open after Close")
		}
	}
}

// ---------------------------------------------------------------- stream helpers

// openStream connects to the event stream; cancel closes the page.
func openStream(t *testing.T, url string) (<-chan string, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	return readFrames(response.Body), func() { cancel(); response.Body.Close() }
}

// readFrames splits the stream into frames (the lines up to a blank line). The channel closes when
// the stream ends.
//
// Goroutine: reads until the body ends or fails (the test cancels the request).
func readFrames(body io.Reader) <-chan string {
	frames := make(chan string, 1024)
	go func() {
		defer close(frames)
		scanner := bufio.NewScanner(body)
		var lines []string
		for scanner.Scan() {
			if line := scanner.Text(); line != "" {
				lines = append(lines, line)
				continue
			}
			frames <- strings.Join(lines, "\n")
			lines = nil
		}
	}()
	return frames
}

func nextFrame(t *testing.T, frames <-chan string) string {
	t.Helper()
	select {
	case frame, open := <-frames:
		if !open {
			t.Fatal("the stream ended")
		}
		return frame
	case <-time.After(frameTimeout):
		t.Fatal("no frame arrived")
	}
	return ""
}

func waitFor(t *testing.T, what string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(frameTimeout)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}
