// Package extracts reads "my extracts" from the first in-raid screenshot: the player opens the
// in-game extract list (double-tap O) and takes a screenshot; the picture is shrunk, read by the
// OpenAI vision model, matched to the raid map's extracts and transits, and handed to the page,
// which marks them as the player's own. See README.md.
package extracts

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"squadtaskmap/internal/openai"
)

// readTimeout only stops a hung connection; a vision call normally takes a few seconds.
const readTimeout = 2 * time.Minute

// Folder is what the reader needs from the screenshots watcher.
type Folder interface {
	ReadFile(name string) ([]byte, error)
}

// Config is what the reader needs to know about the OpenAI settings each time it might read.
type Config struct {
	Key     string
	Model   string
	Enabled bool // the player's setting, with its default (see storage.Settings.IsReadExtractsOn)
}

// Result is what one successful read gives the app to hand to the page.
type Result struct {
	// Map is the raid's map key, or nil when the log didn't name it. With nil, Marked and Unknown
	// are empty and Read holds the names, for the page to match against the map it has open.
	Map     *string
	Marked  []Marked
	Unknown []string
	Read    []ReadExtract
}

// Reader holds one raid's state: whether it may still read, and how many screenshots it tried.
type Reader struct {
	folder     Folder
	ai         *openai.Client
	config     func() Config
	currentMap func() *string               // the raid's map (nil = unknown)
	mapNames   func(mapKey string) []string // that map's extract and transit names
	deliver    func(Result)

	mutex      sync.Mutex
	isInRaid   bool
	generation int // changes at every raid start and end, so an answer from an old raid is dropped
	attempts   Attempts
	isReading  bool
}

// New makes the reader. deliver is called (with the reader's lock held, so it can never come after
// RaidEnded) for a list that was read during the current raid.
func New(folder Folder, ai *openai.Client, config func() Config, currentMap func() *string, mapNames func(string) []string, deliver func(Result)) *Reader {
	return &Reader{folder: folder, ai: ai, config: config, currentMap: currentMap, mapNames: mapNames, deliver: deliver}
}

// RaidStarted: a new raid. The next in-raid screenshots may be read (up to MaxScreenshotsPerRaid).
func (reader *Reader) RaidStarted() {
	reader.mutex.Lock()
	defer reader.mutex.Unlock()
	reader.isInRaid = true
	reader.generation++
	reader.attempts = Attempts{}
}

// RaidEnded: nothing more is read, and an answer still on its way is dropped.
func (reader *Reader) RaidEnded() {
	reader.mutex.Lock()
	defer reader.mutex.Unlock()
	reader.isInRaid = false
	reader.generation++
}

// OnGPSShot is called for each settled in-raid screenshot. It returns at once; the reading happens
// in the background. Nothing is sent unless the setting is on and a key exists.
func (reader *Reader) OnGPSShot(name string) {
	config := reader.config()
	if !config.Enabled || config.Key == "" {
		return
	}
	reader.mutex.Lock()
	if !reader.isInRaid || reader.isReading || !reader.attempts.ShouldTry() {
		reader.mutex.Unlock()
		return
	}
	reader.isReading = true
	reader.attempts.Tried++
	generation := reader.generation
	reader.mutex.Unlock()
	go reader.read(generation, name, config)
}

// read sends one screenshot to the model and, if it shows an extract list, hands the result on.
func (reader *Reader) read(generation int, name string, config Config) {
	list, err := reader.askModel(name, config)
	reader.mutex.Lock()
	defer reader.mutex.Unlock()
	reader.isReading = false
	if generation != reader.generation {
		return // the raid ended (or another began) while the model was reading
	}
	if err != nil {
		log.Printf("Reading extracts from %s failed: %v", name, err)
		return
	}
	if len(list) == 0 {
		return // no extract list on this screenshot; the next one may be tried
	}
	reader.attempts.Found = true
	reader.deliver(reader.resultFor(list))
}

func (reader *Reader) resultFor(list []ReadExtract) Result {
	mapKey := reader.currentMap()
	if mapKey == nil {
		return Result{Read: list}
	}
	marked, unknown := MatchNames(list, reader.mapNames(*mapKey))
	return Result{Map: mapKey, Marked: marked, Unknown: unknown}
}

// ---------------------------------------------------------------- reading a screenshot with the AI

const readInstructions = `You read screenshots of Escape from Tarkov taken during a raid. The player may have the in-game extraction list open (a list of the extracts available to them on this map, each with a name and sometimes a status or requirement such as "Requires paracord" or "Available").
visible: true only if such an extract list is on screen; otherwise false and no extracts.
extracts: every extract in that list, each with name: the extract's name exactly as written, and note: the status or requirement text shown for it, or null if there is none.
Don't invent extracts, and don't list anything that isn't in the extract list (map labels, quest text, chat).`

var readSchema = map[string]any{
	"type": "object", "additionalProperties": false, "required": []string{"visible", "extracts"},
	"properties": map[string]any{
		"visible": map[string]any{"type": "boolean"},
		"extracts": map[string]any{"type": "array", "items": map[string]any{
			"type": "object", "additionalProperties": false, "required": []string{"name", "note"},
			"properties": map[string]any{
				"name": map[string]any{"type": "string"},
				"note": map[string]any{"type": []string{"string", "null"}},
			},
		}},
	},
}

// askModel shrinks the screenshot, sends it, and returns the cleaned extract list ("none visible"
// is an empty list).
func (reader *Reader) askModel(name string, config Config) ([]ReadExtract, error) {
	data, err := reader.folder.ReadFile(name)
	if err != nil {
		return nil, err
	}
	jpegData, err := ShrinkToJPEG(data)
	if err != nil {
		return nil, err
	}
	model := config.Model
	if model == "" {
		model = openai.DefaultModel
	}
	body := map[string]any{
		"model":        model,
		"instructions": readInstructions,
		"input": []any{map[string]any{"role": "user", "content": []any{
			map[string]any{"type": "input_text", "text": "Read the extract list in this screenshot."},
			map[string]any{"type": "input_image", "image_url": dataURL(jpegData), "detail": "high"},
		}}},
		"text": map[string]any{"format": map[string]any{"type": "json_schema", "name": "extract_list", "strict": true, "schema": readSchema}},
	}
	if openai.SupportsReasoning(model) {
		body["reasoning"] = map[string]any{"effort": "low"}
	}
	ctx, cancel := context.WithTimeout(context.Background(), readTimeout)
	defer cancel()
	response, err := reader.ai.Responses(ctx, config.Key, body)
	if err != nil {
		return nil, err
	}
	text, err := openai.OutputText(response)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Visible  bool          `json:"visible"`
		Extracts []ReadExtract `json:"extracts"`
	}
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		return nil, err
	}
	if !parsed.Visible {
		return nil, nil
	}
	return CleanRead(parsed.Extracts), nil
}
