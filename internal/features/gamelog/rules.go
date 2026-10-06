// Package gamelog reads Escape from Tarkov's log files: tasks accepted, finished or failed, raid
// start and end, the map being loaded, the game mode, and whether a screenshot key is bound.
//
// rules.go is the parser: plain functions over text, no file access. watcher.go reads the files.
package gamelog

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

// Entry is one log entry: a header line, optionally followed by a JSON block.
//
// Tarkov's format (checked against the owner's real logs, 2026-10-04):
//
//	2026-10-04 22:12:05.947|1.1.5.1.47510|Info|application|Session mode: Pve
//	2026-10-04 23:36:17.918|1.1.5.1.47510|Info|push-notifications|Got notification | UserMatchOver
//	{
//	  "type": "userMatchOver",
//	  …
//	}
//
// Some versions add a time zone after the time (" -05:00").
type Entry struct {
	Date    string // "2026-10-04T22:12:05.947"
	Message string // everything after the date: "1.1.5.1.47510|Info|application|Session mode: Pve"
	JSON    any    // the decoded JSON block, or nil
}

var entryHeader = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3})(?: [+-]\d{2}:\d{2})?\|`)

// SplitEntries cuts a chunk of log text into complete entries. The last entry may still be being
// written (no newline yet, or a JSON block that isn't closed); it's returned as `rest` and should be
// put in front of the next chunk.
func SplitEntries(chunk string) (entries []Entry, rest string) {
	endsWithNewline := strings.HasSuffix(chunk, "\n")
	lines := splitLines(chunk)
	if endsWithNewline && len(lines) > 0 {
		lines = lines[:len(lines)-1] // the empty string after the last newline
	}

	var blocks [][]string
	var current []string
	for _, line := range lines {
		if entryHeader.MatchString(line) {
			if current != nil {
				blocks = append(blocks, current)
			}
			current = []string{line}
		} else if current != nil {
			current = append(current, line)
		}
		// Text before the first header is the tail of an entry we never saw the start of: ignored.
	}
	if current != nil {
		blocks = append(blocks, current)
	}

	if len(blocks) > 0 {
		last := blocks[len(blocks)-1]
		hasOpenJSON := len(last) > 1 && strings.HasPrefix(last[1], "{") && !anyLineStartsWith(last[1:], "}")
		if !endsWithNewline || hasOpenJSON {
			rest = strings.Join(last, "\n")
			if endsWithNewline {
				rest += "\n"
			}
			blocks = blocks[:len(blocks)-1]
		}
	}
	for _, block := range blocks {
		if entry, ok := parseBlock(block); ok {
			entries = append(entries, entry)
		}
	}
	return entries, rest
}

// splitLines splits on \n or \r\n, like JavaScript's split(/\r?\n/).
func splitLines(text string) []string {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimSuffix(line, "\r")
	}
	return lines
}

func anyLineStartsWith(lines []string, prefix string) bool {
	for _, line := range lines {
		if strings.HasPrefix(line, prefix) {
			return true
		}
	}
	return false
}

func parseBlock(block []string) (Entry, bool) {
	match := entryHeader.FindStringSubmatch(block[0])
	if match == nil {
		return Entry{}, false
	}
	entry := Entry{Date: match[1] + "T" + match[2], Message: block[0][len(match[0]):]}
	if len(block) > 1 && strings.HasPrefix(block[1], "{") {
		end := -1
		for i := 1; i < len(block); i++ {
			if strings.HasPrefix(block[i], "}") {
				end = i
				break
			}
		}
		jsonLines := block[1:]
		if end > 0 {
			jsonLines = block[1 : end+1]
		}
		var decoded any
		if json.Unmarshal([]byte(strings.Join(jsonLines, "\n")), &decoded) == nil {
			entry.JSON = decoded
		}
	}
	return entry, true
}

// ---------------------------------------------------------------- events

// Event kinds the parser produces.
const (
	KindTask            = "task"            // a task started, finished or failed
	KindMode            = "mode"            // the game says which game mode it's in
	KindMapLoading      = "mapLoading"      // the game is loading a map (scene preset path)
	KindMapLoaded       = "mapLoaded"       // the raid was created on a map (Location: nameId)
	KindRaidStart       = "raidStart"       // you're in the raid
	KindRaidLeft        = "raidLeft"        // the server says the match is over (UserMatchOver)
	KindProfileSelected = "profileSelected" // back in the menus: TarkovMonitor treats this as raid end
	KindMatchingAborted = "matchingAborted" // matchmaking was cancelled: no raid
	KindKeybind         = "keybind"         // the control settings: is a screenshot key bound?
)

// Event is something the app reacts to. Only the fields of its Kind are set.
type Event struct {
	Kind    string
	TaskID  string // task: the task id (same as tarkov.dev)
	Status  string // task: "started", "failed" or "finished"
	At      string // task, raidStart: the entry's date
	Mode    string // mode: "regular", "pve" or "pvp-season"
	RawMode string // mode: as written in the log ("PvpSeason")
	Scene   string // mapLoading: "maps/city_preset.bundle"
	NameID  string // mapLoaded: "TarkovStreets"
	OK      bool   // keybind: a working screenshot key is bound
	Warning string // keybind: what's wrong, when not OK
}

// Tarkov writes these chat message types into its notifications log.
var taskStatusByMessageType = map[float64]string{
	10: "started",
	11: "failed",
	12: "finished",
}

var (
	taskIDPattern   = regexp.MustCompile(`^[0-9a-fA-F]{24}$`)
	sessionMode     = regexp.MustCompile(`Session mode: ([^\s|]+)`)
	scenePresetPath = regexp.MustCompile(`scene preset path:(maps/[A-Za-z0-9_]+\.bundle)`)
	locationName    = regexp.MustCompile(`Location: ([^,]+)`)
	profileSelected = regexp.MustCompile(`(Select(ed)?Profile|PrepareSelectedProfileLocally) ProfileId:`)
)

// EventsFrom turns one log entry into the events it means (usually none).
func EventsFrom(entry Entry) []Event {
	var events []Event
	message := entry.Message

	if strings.Contains(message, "Got notification | ChatMessageReceived") && entry.JSON != nil {
		if event, isTask := taskEventFromChatMessage(entry); isTask {
			events = append(events, event)
		}
	}
	if strings.Contains(message, "Got notification | UserMatchOver") {
		events = append(events, Event{Kind: KindRaidLeft})
	}
	if match := sessionMode.FindStringSubmatch(message); match != nil {
		if mode := ResolveMode(match[1]); mode != "" {
			events = append(events, Event{Kind: KindMode, Mode: mode, RawMode: match[1]})
		}
	}
	if match := scenePresetPath.FindStringSubmatch(message); match != nil {
		events = append(events, Event{Kind: KindMapLoading, Scene: match[1]})
	}
	if strings.Contains(message, "TRACE-NetworkGameCreate profileStatus") {
		if match := locationName.FindStringSubmatch(message); match != nil {
			events = append(events, Event{Kind: KindMapLoaded, NameID: strings.TrimSpace(match[1])})
		}
	}
	if strings.Contains(message, "application|GameStarted") {
		events = append(events, Event{Kind: KindRaidStart, At: entry.Date})
	}
	if profileSelected.MatchString(message) {
		events = append(events, Event{Kind: KindProfileSelected})
	}
	if strings.Contains(message, "Network game matching aborted") || strings.Contains(message, "Network game matching cancelled") {
		events = append(events, Event{Kind: KindMatchingAborted})
	}
	if strings.Contains(message, "Control settings:") && entry.JSON != nil {
		events = append(events, ScreenshotKeyCheck(entry.JSON))
	}
	return events
}

// taskEventFromChatMessage reads a "ChatMessageReceived" notification. Its templateId looks like
// "<taskId> description" or "<taskId> successMessageText <traderId> 0". Other chat messages
// (insurance, flea market, …) aren't about tasks.
func taskEventFromChatMessage(entry Entry) (Event, bool) {
	message, _ := asMap(entry.JSON)["message"].(map[string]any)
	messageType := numberFrom(message["type"])
	status, isTaskMessage := taskStatusByMessageType[messageType]
	templateID, hasTemplate := message["templateId"].(string)
	if !isTaskMessage || !hasTemplate {
		return Event{}, false
	}
	taskID := strings.Split(templateID, " ")[0]
	if !taskIDPattern.MatchString(taskID) {
		return Event{}, false
	}
	return Event{Kind: KindTask, TaskID: taskID, Status: status, At: entry.Date}, true
}

// ResolveMode turns the log's mode name into the app's ("" when unknown). Names seen in logs:
// Regular / PVP, Pve / PVE, PvpSeason / Seasonal / SZN.
func ResolveMode(raw string) string {
	switch strings.ToLower(raw) {
	case "pve":
		return "pve"
	case "regular", "pvp":
		return "regular"
	case "pvpseason", "seasonal", "szn":
		return "pvp-season"
	}
	return ""
}

// The two warnings the page shows about the screenshot key.
const (
	warningNoScreenshotKey = "No screenshot key is bound in Tarkov's control settings. Bind one so the map can show your position."
	warningSysReqOnly      = "Tarkov's screenshot key is bound in a way that doesn't work (SysReq). Rebind it in the game's control settings."
)

// ScreenshotKeyCheck reads the game's control settings: is a working screenshot key bound?
// Each binding has two slots and one working slot is enough. SysReq (Print Screen) doesn't work:
// Tarkov doesn't receive it. (The owner's real settings: SysReq + KeypadEnter, which is fine.)
func ScreenshotKeyCheck(controlSettings any) Event {
	var slots []any
	for _, binding := range asList(asMap(controlSettings)["keyBindings"]) {
		if asMap(binding)["keyName"] == "MakeScreenshot" {
			slots = asList(asMap(binding)["variants"])
			break
		}
	}
	slotWorks := func(slot map[string]any) bool {
		keys := asList(slot["keyCode"])
		return slot["isAxis"] == true || (len(keys) > 0 && !containsText(keys, "SysReq"))
	}
	hasSysReq := false
	for _, rawSlot := range slots {
		slot := asMap(rawSlot)
		if slot == nil {
			continue
		}
		if slotWorks(slot) {
			return Event{Kind: KindKeybind, OK: true}
		}
		if containsText(asList(slot["keyCode"]), "SysReq") {
			hasSysReq = true
		}
	}
	if hasSysReq {
		return Event{Kind: KindKeybind, OK: false, Warning: warningSysReqOnly}
	}
	return Event{Kind: KindKeybind, OK: false, Warning: warningNoScreenshotKey}
}

func asMap(value any) map[string]any {
	object, _ := value.(map[string]any)
	return object
}

func asList(value any) []any {
	list, _ := value.([]any)
	return list
}

func containsText(list []any, want string) bool {
	for _, value := range list {
		if value == want {
			return true
		}
	}
	return false
}

// numberFrom reads a number written as a number or as text ("10"), like JavaScript's Number();
// anything else is -1 (no message type uses it).
func numberFrom(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case string:
		if number, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
			return number
		}
	}
	return -1
}
