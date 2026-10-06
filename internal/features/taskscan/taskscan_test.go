package taskscan

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"squadtaskmap/internal/screenshots"
)

// fakeFolder stands in for the screenshots watcher and records what the scan asked of it.
type fakeFolder struct {
	status  screenshots.Status
	files   map[string][]byte
	read    []string
	deleted []string
}

func newFakeFolder(names ...string) *fakeFolder {
	folder := &fakeFolder{status: screenshots.Status{OK: true, Message: "Watching"}, files: map[string][]byte{}}
	for _, name := range names {
		folder.files[name] = []byte("picture " + name)
	}
	return folder
}

func (folder *fakeFolder) Status() screenshots.Status { return folder.status }
func (folder *fakeFolder) Dir() string                { return `C:\Users\me\Documents\Escape From Tarkov\Screenshots` }

func (folder *fakeFolder) ReadFile(name string) ([]byte, error) {
	folder.read = append(folder.read, name)
	data, found := folder.files[name]
	if !found {
		return nil, os.ErrNotExist
	}
	return data, nil
}

func (folder *fakeFolder) DeleteFile(name string) error {
	folder.deleted = append(folder.deleted, name)
	if _, found := folder.files[name]; !found {
		return os.ErrNotExist
	}
	delete(folder.files, name)
	return nil
}

// startedScan is a scan in capture mode; changes collects every capture list sent to the page.
func startedScan(t *testing.T, folder *fakeFolder) (*Scan, *[][]CapturedFile) {
	t.Helper()
	var changes [][]CapturedFile
	scan := New(folder, nil, func(files []CapturedFile) { changes = append(changes, files) })
	if err := scan.Start(); err != nil {
		t.Fatal(err)
	}
	return scan, &changes
}

// shot is a settled screenshot written at the given time.
func shot(name string, written time.Time) screenshots.File {
	return screenshots.File{Name: name, Exists: true, Modified: written, Size: 1234}
}

func names(files []CapturedFile) []string {
	list := []string{}
	for _, file := range files {
		list = append(list, file.Name)
	}
	return list
}

func TestAScanStartsOnlyWhenTheScreenshotsFolderIsWatched(t *testing.T) {
	cases := []struct {
		name      string
		status    screenshots.Status
		wantError string
	}{
		{"watched", screenshots.Status{OK: true, Message: "Watching"}, ""},
		{"not found yet", screenshots.Status{OK: false, Message: "Screenshots folder not found yet (it appears after your first screenshot)"}, "Screenshots folder not found yet (it appears after your first screenshot)"},
		{"unknown", screenshots.Status{OK: false, Message: "Screenshots folder unknown — set it in Settings"}, "Screenshots folder unknown — set it in Settings"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			folder := newFakeFolder()
			folder.status = testCase.status
			var changes [][]CapturedFile
			scan := New(folder, nil, func(files []CapturedFile) { changes = append(changes, files) })
			err := scan.Start()
			if testCase.wantError == "" {
				if err != nil || !scan.IsActive() {
					t.Fatalf("err = %v, active = %v; want a running scan", err, scan.IsActive())
				}
				if len(changes) != 1 || changes[0] == nil || len(changes[0]) != 0 {
					t.Errorf("the page should get one empty list, got %v", changes)
				}
				return
			}
			if err == nil || err.Error() != testCase.wantError || scan.IsActive() {
				t.Errorf("err = %v, active = %v; want %q and no scan", err, scan.IsActive(), testCase.wantError)
			}
			if len(changes) != 0 {
				t.Errorf("the page was told about a scan that didn't start: %v", changes)
			}
		})
	}
}

func TestOnlyScreenshotsTakenAfterScanTasksCount(t *testing.T) {
	cases := []struct {
		name         string
		writtenAgo   time.Duration // before now (the scan started a moment ago)
		wantCaptured bool
	}{
		{"taken after the click", -time.Second, true},
		{"a second before the click: within the clock slack", time.Second, true},
		{"three seconds before the click: an old screenshot", 3 * time.Second, false},
		{"an hour old", time.Hour, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			scan, changes := startedScan(t, newFakeFolder())
			scan.OnScreenshot(shot("shot.png", time.Now().Add(-testCase.writtenAgo)))
			if captured := len(scan.List()) == 1; captured != testCase.wantCaptured {
				t.Errorf("captured = %v, want %v", captured, testCase.wantCaptured)
			}
			if wantChanges := map[bool]int{true: 2, false: 1}[testCase.wantCaptured]; len(*changes) != wantChanges {
				t.Errorf("the page got %d lists, want %d", len(*changes), wantChanges)
			}
		})
	}
}

func TestNothingIsCapturedOutsideCaptureMode(t *testing.T) {
	cases := []struct {
		name  string
		setUp func(scan *Scan)
	}{
		{"never started", func(*Scan) {}},
		{"stopped", func(scan *Scan) { scan.Start(); scan.Stop() }},
		{"cancelled", func(scan *Scan) { scan.Start(); scan.Cancel() }},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			scan := New(newFakeFolder(), nil, func([]CapturedFile) {})
			testCase.setUp(scan)
			scan.OnScreenshot(shot("shot.png", time.Now()))
			if list := scan.List(); len(list) != 0 {
				t.Errorf("captured %v", names(list))
			}
		})
	}
}

func TestTheIsTakenDuringCaptureRule(t *testing.T) {
	started := time.Date(2026, 10, 1, 14, 6, 0, 0, time.UTC)
	cases := []struct {
		name    string
		written time.Time
		want    bool
	}{
		{"after the click", started.Add(5 * time.Second), true},
		{"exactly at the edge of the slack", started.Add(-captureClockSlack), true},
		{"just past the slack", started.Add(-captureClockSlack - time.Millisecond), false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := IsTakenDuringCapture(testCase.written, started); got != testCase.want {
				t.Errorf("got %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestTheListIsOldestFirstAndSameTimeShotsGoByName(t *testing.T) {
	scan, _ := startedScan(t, newFakeFolder())
	now := time.Now().Truncate(time.Millisecond)
	// They arrive out of order (settle timers fire in any order).
	scan.OnScreenshot(shot("2026-10-01[14-07]_b (1).png", now.Add(time.Second)))
	scan.OnScreenshot(shot("2026-10-01[14-07]_b (0).png", now.Add(time.Second)))
	scan.OnScreenshot(shot("2026-10-01[14-06]_z.png", now))
	want := []string{"2026-10-01[14-06]_z.png", "2026-10-01[14-07]_b (0).png", "2026-10-01[14-07]_b (1).png"}
	if got := names(scan.List()); !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestARemovedOrDiscardedScreenshotLeavesTheList(t *testing.T) {
	folder := newFakeFolder("a.png", "b.png")
	scan, changes := startedScan(t, folder)
	scan.OnScreenshot(shot("a.png", time.Now()))
	scan.OnScreenshot(shot("b.png", time.Now()))
	before := len(*changes)

	scan.OnScreenshot(screenshots.File{Name: "a.png", Exists: false}) // deleted on disk
	scan.OnScreenshot(screenshots.File{Name: "never-listed.png", Exists: false})
	if got := names(scan.List()); !reflect.DeepEqual(got, []string{"b.png"}) {
		t.Errorf("after the delete: %v", got)
	}
	if len(*changes) != before+1 {
		t.Errorf("the page got %d new lists, want 1 (an unlisted file's removal says nothing)", len(*changes)-before)
	}

	scan.Remove("b.png") // "Don't use this one"
	if len(scan.List()) != 0 || len(folder.deleted) != 0 {
		t.Errorf("list %v, deleted %v; want an empty list and the file kept", names(scan.List()), folder.deleted)
	}
}

func TestOnlyListedScreenshotsAreServedWithTheirContentType(t *testing.T) {
	folder := newFakeFolder("a.png", "b.JPG", "c.bmp", "d.jpeg", "old.png")
	scan, _ := startedScan(t, folder)
	for _, name := range []string{"a.png", "b.JPG", "c.bmp", "d.jpeg", "gone.png"} {
		scan.OnScreenshot(shot(name, time.Now()))
	}
	cases := []struct {
		name, file      string
		wantOK          bool
		wantContentType string
	}{
		{"a PNG", "a.png", true, "image/png"},
		{"a JPEG with an upper-case extension", "b.JPG", true, "image/jpeg"},
		{"a BMP", "c.bmp", true, "image/bmp"},
		{"a .jpeg", "d.jpeg", true, "image/jpeg"},
		{"a file in the folder but not in the list", "old.png", false, ""},
		{"a path out of the folder", "../secret.png", false, ""},
		{"a listed file that can't be read", "gone.png", false, ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			data, contentType, ok := scan.Image(testCase.file)
			if ok != testCase.wantOK || contentType != testCase.wantContentType {
				t.Errorf("ok = %v, type = %q; want %v, %q", ok, contentType, testCase.wantOK, testCase.wantContentType)
			}
			if ok && string(data) != "picture "+testCase.file {
				t.Errorf("data = %q", data)
			}
		})
	}
	for _, read := range folder.read {
		if read == "old.png" || read == "../secret.png" {
			t.Errorf("an unlisted file was read from disk: %q", read)
		}
	}
}

func TestConfirmDeletesOnlyTheScannedScreenshotsInTheListAndEndsTheScan(t *testing.T) {
	folder := newFakeFolder("a.png", "b.png", "c.png", "old.png")
	scan, _ := startedScan(t, folder)
	for _, name := range []string{"a.png", "b.png", "lost.png"} {
		scan.OnScreenshot(shot(name, time.Now()))
	}

	deleted := scan.Confirm([]string{"a.png", "a.png", "old.png", "../c.png", "c.png", "lost.png"})
	// a.png: listed (once); lost.png: listed but already gone, so not counted; the rest aren't listed.
	if want := []string{"a.png", "lost.png"}; !reflect.DeepEqual(folder.deleted, want) {
		t.Errorf("asked to delete %v, want %v", folder.deleted, want)
	}
	if deleted != 1 {
		t.Errorf("deleted = %d, want 1", deleted)
	}
	if _, kept := folder.files["b.png"]; !kept {
		t.Error("b.png was in the list but not confirmed, and must stay")
	}
	if scan.IsActive() || len(scan.List()) != 0 {
		t.Errorf("after confirm: active = %v, list = %v", scan.IsActive(), names(scan.List()))
	}
}

func TestCancelDeletesNothing(t *testing.T) {
	folder := newFakeFolder("a.png", "b.png")
	scan, _ := startedScan(t, folder)
	scan.OnScreenshot(shot("a.png", time.Now()))
	scan.OnScreenshot(shot("b.png", time.Now()))
	scan.Cancel()
	if len(folder.deleted) != 0 || len(folder.files) != 2 {
		t.Errorf("cancel deleted %v", folder.deleted)
	}
	if scan.IsActive() || len(scan.List()) != 0 {
		t.Errorf("after cancel: active = %v, list = %v", scan.IsActive(), names(scan.List()))
	}
	if _, _, ok := scan.Image("a.png"); ok {
		t.Error("a cancelled scan still serves its screenshots")
	}
}

func TestStopEndsCaptureButKeepsTheList(t *testing.T) {
	scan, _ := startedScan(t, newFakeFolder())
	scan.OnScreenshot(shot("a.png", time.Now()))
	scan.Stop()
	scan.OnScreenshot(shot("b.png", time.Now()))
	if got := names(scan.List()); !reflect.DeepEqual(got, []string{"a.png"}) || scan.IsActive() {
		t.Errorf("list = %v, active = %v; want [a.png] and capture off", got, scan.IsActive())
	}
}

func TestTheModelsRowsAreCleaned(t *testing.T) {
	longName := strings.Repeat("é", 130)
	cases := []struct {
		name string
		raw  string // the model's rows, as JSON
		want string // the cleaned rows, as JSON
	}{
		{"a normal row", `[{"name":"Debut","trader":"Prapor","progress":40}]`, `[{"name":"Debut","trader":"Prapor","progress":40}]`},
		{"names are trimmed", `[{"name":"  Shootout Picnic \n","trader":null,"progress":null}]`, `[{"name":"Shootout Picnic","trader":null,"progress":null}]`},
		{"rows without a name are dropped", `[{"name":"","trader":"Prapor"},{"name":"   "},{"trader":"Skier"},{"name":5},{"name":"Kept"}]`, `[{"name":"Kept","trader":null,"progress":null}]`},
		{"long names are cut at 120 characters", `[{"name":"` + longName + `"}]`, `[{"name":"` + strings.Repeat("é", 120) + `","trader":null,"progress":null}]`},
		{"long trader names are cut at 40", `[{"name":"A","trader":"` + strings.Repeat("t", 50) + `"}]`, `[{"name":"A","trader":"` + strings.Repeat("t", 40) + `","progress":null}]`},
		{"an empty trader is null", `[{"name":"A","trader":""}]`, `[{"name":"A","trader":null,"progress":null}]`},
		{"progress above 100 is 100", `[{"name":"A","progress":250}]`, `[{"name":"A","trader":null,"progress":100}]`},
		{"progress below 0 is 0", `[{"name":"A","progress":-5}]`, `[{"name":"A","trader":null,"progress":0}]`},
		{"0 and 100 stay", `[{"name":"A","progress":0},{"name":"B","progress":100}]`, `[{"name":"A","trader":null,"progress":0},{"name":"B","trader":null,"progress":100}]`},
		{"a fraction isn't a percent", `[{"name":"A","progress":12.5}]`, `[{"name":"A","trader":null,"progress":null}]`},
		{"progress as text isn't a number", `[{"name":"A","progress":"50"}]`, `[{"name":"A","trader":null,"progress":null}]`},
		{"no rows give an empty list, not null", `[]`, `[]`},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			var raw []map[string]any
			if err := json.Unmarshal([]byte(testCase.raw), &raw); err != nil {
				t.Fatal(err)
			}
			got, _ := json.Marshal(cleanRows(raw))
			if string(got) != testCase.want {
				t.Errorf("got  %s\nwant %s", got, testCase.want)
			}
		})
	}
}

func TestOnlyJPEGPNGAndWebPImagesAreSentToTheModel(t *testing.T) {
	cases := []struct {
		name    string
		dataURL string
		want    bool
	}{
		{"JPEG", "data:image/jpeg;base64,/9j/4AAQ", true},
		{"PNG", "data:image/png;base64,iVBORw0K", true},
		{"WebP", "data:image/webp;base64,UklGR", true},
		{"GIF", "data:image/gif;base64,R0lGOD", false},
		{"not base64", "data:image/png,<svg>", false},
		{"a web link", "https://example.com/shot.png", false},
		{"text before the data URL", " data:image/png;base64,iVBORw0K", false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := imageDataURL.MatchString(testCase.dataURL); got != testCase.want {
				t.Errorf("got %v, want %v", got, testCase.want)
			}
		})
	}
}
