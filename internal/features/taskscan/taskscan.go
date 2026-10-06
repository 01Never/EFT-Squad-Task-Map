// Package taskscan is "Scan tasks": while capture mode is on, new screenshots (other than in-raid
// GPS shots) are collected; the page shows them, has each one read by the OpenAI vision model, and
// on confirm the app deletes exactly the screenshots that were scanned. Cancel deletes nothing.
// Matching the names to tasks, and replacing the task list, happen in the page (web/js/scan.js).
package taskscan

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"squadtaskmap/internal/openai"
	"squadtaskmap/internal/screenshots"
)

// CapturedFile is one screenshot in the capture list, as the page sees it.
type CapturedFile struct {
	Name string  `json:"name"`
	T    float64 `json:"t"` // when the game wrote it, ms since 1970
	Size int64   `json:"size"`
}

// Folder is what the scan needs from the screenshots watcher.
type Folder interface {
	Status() screenshots.Status
	Dir() string
	ReadFile(name string) ([]byte, error)
	DeleteFile(name string) error
}

// Scan holds capture mode.
type Scan struct {
	mutex     sync.Mutex
	isActive  bool
	startedAt time.Time
	files     map[string]CapturedFile
	folder    Folder
	ai        *openai.Client
	onChange  func(files []CapturedFile) // the capture list changed: tell the page
}

// New makes the scan feature.
func New(folder Folder, ai *openai.Client, onChange func([]CapturedFile)) *Scan {
	return &Scan{folder: folder, ai: ai, onChange: onChange, files: map[string]CapturedFile{}}
}

// Start turns capture mode on (fails when the screenshots folder isn't being watched).
func (scan *Scan) Start() error {
	if status := scan.folder.Status(); !status.OK {
		return errors.New(status.Message)
	}
	scan.mutex.Lock()
	scan.isActive = true
	scan.startedAt = time.Now()
	scan.files = map[string]CapturedFile{}
	scan.mutex.Unlock()
	scan.onChange([]CapturedFile{})
	return nil
}

// Stop ends capture mode but keeps the list (the page is reading the shots).
func (scan *Scan) Stop() {
	scan.mutex.Lock()
	defer scan.mutex.Unlock()
	scan.isActive = false
}

// Cancel ends the scan and forgets the list. Nothing is deleted.
func (scan *Scan) Cancel() {
	scan.mutex.Lock()
	defer scan.mutex.Unlock()
	scan.isActive = false
	scan.files = map[string]CapturedFile{}
}

// IsActive reports whether capture mode is on.
func (scan *Scan) IsActive() bool {
	scan.mutex.Lock()
	defer scan.mutex.Unlock()
	return scan.isActive
}

// OnScreenshot is called for every settled screenshot that isn't a GPS shot.
func (scan *Scan) OnScreenshot(file screenshots.File) {
	scan.mutex.Lock()
	if !file.Exists {
		_, wasListed := scan.files[file.Name]
		delete(scan.files, file.Name)
		scan.mutex.Unlock()
		if wasListed {
			scan.onChange(scan.List())
		}
		return
	}
	if !scan.isActive || !IsTakenDuringCapture(file.Modified, scan.startedAt) {
		scan.mutex.Unlock()
		return
	}
	scan.files[file.Name] = CapturedFile{Name: file.Name, T: float64(file.Modified.UnixMilli()), Size: file.Size}
	scan.mutex.Unlock()
	scan.onChange(scan.List())
}

// List is the capture list, oldest first.
func (scan *Scan) List() []CapturedFile {
	scan.mutex.Lock()
	defer scan.mutex.Unlock()
	list := make([]CapturedFile, 0, len(scan.files))
	for _, file := range scan.files {
		list = append(list, file)
	}
	sort.Slice(list, func(a, b int) bool {
		if list[a].T != list[b].T {
			return list[a].T < list[b].T
		}
		// Same millisecond (never happens in the game, which writes one at a time): by name, which
		// follows Tarkov's own " (0)", " (1)" numbering.
		return list[a].Name < list[b].Name
	})
	return list
}

// Remove takes one screenshot off the list ("Don't use this one"). The file stays.
func (scan *Scan) Remove(name string) {
	scan.mutex.Lock()
	delete(scan.files, name)
	scan.mutex.Unlock()
	scan.onChange(scan.List())
}

// Image returns a captured screenshot for the page. Only files in the capture list are ever served.
func (scan *Scan) Image(name string) (data []byte, contentType string, ok bool) {
	scan.mutex.Lock()
	_, listed := scan.files[name]
	scan.mutex.Unlock()
	if !listed {
		return nil, "", false
	}
	data, err := scan.folder.ReadFile(name)
	if err != nil {
		return nil, "", false
	}
	return data, imageContentType(name), true
}

// Confirm deletes exactly the scanned screenshots (only names in the capture list), then ends the
// scan. Returns how many files were deleted.
func (scan *Scan) Confirm(names []string) int {
	scan.mutex.Lock()
	var toDelete []string
	for _, name := range names {
		if _, listed := scan.files[name]; listed {
			toDelete = append(toDelete, name)
			delete(scan.files, name)
		}
	}
	scan.isActive = false
	scan.files = map[string]CapturedFile{}
	scan.mutex.Unlock()
	deleted := 0
	for _, name := range toDelete {
		if scan.folder.DeleteFile(name) == nil {
			deleted++
		}
	}
	return deleted
}

// ---------------------------------------------------------------- reading a screenshot with the AI

// The model reads names only; matching to tasks happens in the page.
const readInstructions = `You read screenshots of the Escape from Tarkov in-game Tasks screen (columns: trader portrait, type, class, Task, Location, Status, Progress).
Return every row whose task name you can read. name: the task name exactly as written (keep punctuation such as " - Part 1"). trader: the trader's name only if it is written as text on screen, otherwise null. progress: the whole-number percent in the Progress column, or null if you can't read it.
Skip headers, menus and rows cut off so badly that the name can't be read. Don't invent rows.`

var readSchema = map[string]any{
	"type": "object", "additionalProperties": false, "required": []string{"rows"},
	"properties": map[string]any{"rows": map[string]any{"type": "array", "items": map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"name", "trader", "progress"},
		"properties": map[string]any{
			"name":     map[string]any{"type": "string"},
			"trader":   map[string]any{"type": []string{"string", "null"}},
			"progress": map[string]any{"type": []string{"integer", "null"}},
		},
	}}},
}

// Row is one task row the model read.
type Row struct {
	Name     string  `json:"name"`
	Trader   *string `json:"trader"`
	Progress *int    `json:"progress"`
}

// ReadResult is what /api/scan/read returns.
type ReadResult struct {
	Rows  []Row `json:"rows"`
	Usage any   `json:"usage"`
}

// ErrBadImage is returned for anything that isn't a reasonable image data URL.
var ErrBadImage = errors.New("Bad image")

// Read sends one screenshot (a data: URL from the page) to the vision model and returns the rows.
// Reasoning effort is "low" for models that support it (the scan doesn't need more).
func (scan *Scan) Read(ctx context.Context, key, model, dataURL string) (ReadResult, error) {
	if !imageDataURL.MatchString(dataURL) || len(dataURL) > maxImageDataURLLength {
		return ReadResult{}, ErrBadImage
	}
	body := map[string]any{
		"model":        model,
		"instructions": readInstructions,
		"input": []any{map[string]any{"role": "user", "content": []any{
			map[string]any{"type": "input_text", "text": "Read the task rows in this screenshot."},
			map[string]any{"type": "input_image", "image_url": dataURL, "detail": "high"},
		}}},
		"text": map[string]any{"format": map[string]any{"type": "json_schema", "name": "task_rows", "strict": true, "schema": readSchema}},
	}
	if openai.SupportsReasoning(model) {
		body["reasoning"] = map[string]any{"effort": "low"}
	}
	response, err := scan.ai.Responses(ctx, key, body)
	if err != nil {
		return ReadResult{}, err
	}
	// A refusal reads like any unusable answer here, as in v2.
	text, _ := openai.OutputText(response)
	var parsed struct {
		Rows []map[string]any `json:"rows"`
	}
	if json.Unmarshal([]byte(text), &parsed) != nil {
		return ReadResult{}, errors.New("The AI didn't return a readable list for this screenshot")
	}
	return ReadResult{Rows: cleanRows(parsed.Rows), Usage: response["usage"]}, nil
}
