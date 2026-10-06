package gamelog

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// eventAsV2JSON writes an event in the shape v2's TypeScript parser produced, so the Go parser can
// be compared with the golden lists captured from v2.
func eventAsV2JSON(event Event) map[string]any {
	shape := map[string]any{"type": event.Kind}
	switch event.Kind {
	case KindTask:
		shape["id"], shape["status"], shape["at"] = event.TaskID, event.Status, event.At
	case KindMode:
		shape["mode"], shape["raw"] = event.Mode, event.RawMode
	case KindMapLoading:
		shape["scene"] = event.Scene
	case KindMapLoaded:
		shape["nameId"] = event.NameID
	case KindRaidStart:
		shape["at"] = event.At
	case KindKeybind:
		shape["ok"] = event.OK
		if event.OK {
			shape["warning"] = nil
		} else {
			shape["warning"] = event.Warning
		}
	}
	return shape
}

func TestParserMatchesTheV2GoldenEvents(t *testing.T) {
	goldenData, err := os.ReadFile(filepath.Join("..", "..", "..", "testdata", "golden", "log-events.json"))
	if err != nil {
		t.Fatal(err)
	}
	var golden map[string][]map[string]any
	if err := json.Unmarshal(goldenData, &golden); err != nil {
		t.Fatal(err)
	}
	for fixture, want := range golden {
		t.Run(fixture, func(t *testing.T) {
			text, err := os.ReadFile(filepath.Join("..", "..", "..", "testdata", "logs", filepath.FromSlash(fixture)))
			if err != nil {
				t.Fatal(err)
			}
			entries, _ := SplitEntries(string(text))
			var got []map[string]any
			for _, entry := range entries {
				for _, event := range EventsFrom(entry) {
					got = append(got, eventAsV2JSON(event))
				}
			}
			gotJSON, _ := json.Marshal(got)
			wantJSON, _ := json.Marshal(want)
			var gotValue, wantValue any
			json.Unmarshal(gotJSON, &gotValue)
			json.Unmarshal(wantJSON, &wantValue)
			if !reflect.DeepEqual(gotValue, wantValue) {
				t.Errorf("events differ from v2:\n got: %s\nwant: %s", gotJSON, wantJSON)
			}
		})
	}
}

// ---------------------------------------------------------------- helpers like v2's tests

func timestamp() string { return "2026-10-01 11:25:03.123 -05:00" }

func notification(messageType int, taskID string) string {
	return fmt.Sprintf("%s|1.1.5.1|Info|notifications|Got notification | ChatMessageReceived\n{\n  \"type\": \"new_message\",\n  \"eventId\": \"x\",\n  \"message\": {\n    \"_id\": \"abc\",\n    \"type\": %d,\n    \"templateId\": \"%s description\",\n    \"text\": \"\"\n  }\n}\n", timestamp(), messageType, taskID)
}

func applicationLine(message string) string {
	return timestamp() + "|1.1.5.1|Info|application|" + message + "\n"
}

func TestTaskMessagesBecomeTaskEvents(t *testing.T) {
	entries, rest := SplitEntries(notification(10, "5967530a86f77462ba22226b") + notification(12, "5967530a86f77462ba22226c"))
	if rest != "" {
		t.Fatalf("rest = %q, want empty", rest)
	}
	var got []Event
	for _, entry := range entries {
		got = append(got, EventsFrom(entry)...)
	}
	want := []Event{
		{Kind: KindTask, TaskID: "5967530a86f77462ba22226b", Status: "started", At: "2026-10-01T11:25:03.123"},
		{Kind: KindTask, TaskID: "5967530a86f77462ba22226c", Status: "finished", At: "2026-10-01T11:25:03.123"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestAnEntryCutInsideItsJSONWaitsForTheRest(t *testing.T) {
	full := notification(11, "5967530a86f77462ba22226b")
	cut := strings.Index(full, `"type": 11`)
	entries, rest := SplitEntries(full[:cut])
	if len(entries) != 0 {
		t.Fatalf("got %d entries from half an entry", len(entries))
	}
	entries, _ = SplitEntries(rest + full[cut:])
	events := EventsFrom(entries[0])
	if len(events) != 1 || events[0].Status != "failed" {
		t.Errorf("got %+v, want one failed task", events)
	}
}

func TestScreenshotKeyCheck(t *testing.T) {
	check := func(slots ...[]string) Event {
		var variants []any
		for _, keys := range slots {
			keyCodes := []any{}
			for _, key := range keys {
				keyCodes = append(keyCodes, key)
			}
			variants = append(variants, map[string]any{"keyCode": keyCodes})
		}
		return ScreenshotKeyCheck(map[string]any{"keyBindings": []any{map[string]any{"keyName": "MakeScreenshot", "variants": variants}}})
	}
	cases := []struct {
		name   string
		event  Event
		wantOK bool
		warns  string
	}{
		{"one working slot is enough (the owner's real binding: SysReq + KeypadEnter)", check([]string{"SysReq"}, []string{"KeypadEnter"}), true, ""},
		{"SysReq alone doesn't work", check([]string{"SysReq"}, nil), false, "SysReq"},
		{"nothing bound", check(nil, nil), false, "No screenshot key"},
		{"a normal key", check([]string{"F12"}), true, ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if testCase.event.OK != testCase.wantOK || !strings.Contains(testCase.event.Warning, testCase.warns) {
				t.Errorf("got %+v", testCase.event)
			}
		})
	}
}

func TestWatcherStartsAtTheEndReadsNewBytesAndFollowsANewSession(t *testing.T) {
	dir := t.TempDir()
	firstSession := filepath.Join(dir, "log_2026.10.01_10-00-00_1.1.5.1")
	os.Mkdir(firstSession, 0o755)
	notifications := filepath.Join(firstSession, "2026.10.01_10-00-00_1.1.5.1 notifications.log")
	os.WriteFile(notifications, []byte(notification(12, "aaaaaaaaaaaaaaaaaaaaaaaa")), 0o644) // old: must be ignored
	os.WriteFile(filepath.Join(firstSession, "2026.10.01_10-00-00_1.1.5.1 application.log"), nil, 0o644)

	var got []Event
	watcher := NewWatcher(func(event Event) { got = append(got, event) })
	watcher.Start(dir)
	defer watcher.Stop()
	watcher.Poll()
	if len(got) != 0 {
		t.Fatalf("replayed old entries: %+v", got)
	}

	appendTo(t, notifications, notification(10, "bbbbbbbbbbbbbbbbbbbbbbbb"))
	watcher.Poll()
	if len(got) != 1 || got[0].TaskID != "bbbbbbbbbbbbbbbbbbbbbbbb" {
		t.Fatalf("got %+v, want the new task only", got)
	}

	// The game restarts: a new session folder, read from its start.
	secondSession := filepath.Join(dir, "log_2026.10.01_12-00-00_1.1.5.1")
	os.Mkdir(secondSession, 0o755)
	os.WriteFile(filepath.Join(secondSession, "2026.10.01_12-00-00_1.1.5.1 application.log"), []byte(applicationLine("GameStarted:1 real:1")), 0o644)
	for i := 0; i < folderRescanEvery; i++ {
		watcher.Poll() // the folder rescan happens every 6th poll (30 s)
	}
	if got[len(got)-1].Kind != KindRaidStart {
		t.Errorf("the new session's raid start wasn't read: %+v", got)
	}
}

func TestWatcherHandlesSplitWritesAndAShrinkingFile(t *testing.T) {
	dir := t.TempDir()
	session := filepath.Join(dir, "log_2026.10.01_10-00-00_1.1.5.1")
	os.Mkdir(session, 0o755)
	logFile := filepath.Join(session, "x push-notifications_000.log")
	os.WriteFile(logFile, nil, 0o644)

	var got []Event
	watcher := NewWatcher(func(event Event) { got = append(got, event) })
	watcher.Start(dir)
	defer watcher.Stop()

	full := notification(10, "cccccccccccccccccccccccc")
	half := len(full) / 2
	appendTo(t, logFile, full[:half])
	watcher.Poll()
	if len(got) != 0 {
		t.Fatalf("an unfinished entry produced events: %+v", got)
	}
	appendTo(t, logFile, full[half:])
	watcher.Poll()
	if len(got) != 1 {
		t.Fatalf("the finished entry produced %d events, want 1", len(got))
	}

	// The file is replaced by a shorter one: read it from the start.
	os.WriteFile(logFile, []byte(applicationLine("GameStarted:1 real:1")), 0o644)
	watcher.Poll()
	if got[len(got)-1].Kind != KindRaidStart {
		t.Errorf("after the file shrank, its content wasn't read: %+v", got)
	}
}

func TestAUTF8CharacterCutBetweenReadsIsKeptWhole(t *testing.T) {
	state := &fileState{}
	word := []byte("Kraków")
	first := decodeUTF8Stream(state, word[:5]) // "Krak" + the first byte of "ó"
	second := decodeUTF8Stream(state, word[5:])
	if first+second != "Kraków" {
		t.Errorf("got %q + %q", first, second)
	}
}

func appendTo(t *testing.T, path, text string) {
	t.Helper()
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	file.WriteString(text)
}
