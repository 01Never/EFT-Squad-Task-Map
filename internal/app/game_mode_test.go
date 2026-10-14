package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"squadtaskmap/internal/features/gamelog"
	"squadtaskmap/internal/gamedata"
	"squadtaskmap/internal/storage"
)

// The task in the test game data. tarkov.dev uses the same task ids in every game mode.
const knownTaskID = "5936d90786f7742b1420ba5b"

// newGameModeRig is an app whose game data (for the Settings mode, "regular") comes from a fresh
// cache file, so nothing is downloaded, and whose Settings say the given game mode.
func newGameModeRig(t *testing.T, settingMode string) (*App, storage.Files) {
	t.Helper()
	files := storage.FilesIn(t.TempDir())
	writeFreshGameDataCache(t, files, settingMode)
	settings := fmt.Sprintf(`{"gameMode":%q}`, settingMode)
	if err := os.WriteFile(files.Settings, []byte(settings), 0o644); err != nil {
		t.Fatal(err)
	}
	notNeeded := func() (gamedata.GameData, error) { return gamedata.GameData{}, errors.New("not needed in this test") }
	app := newApp("2.9.0", "", files, notNeeded)
	t.Cleanup(app.squad.Stop)
	app.gameData.SetMode(settingMode, false)
	return app, files
}

// writeFreshGameDataCache saves game data the store accepts without downloading: more than 100
// tasks, fetched just now, with loot spots.
func writeFreshGameDataCache(t *testing.T, files storage.Files, mode string) {
	t.Helper()
	tasks := []gamedata.Task{{ID: knownTaskID, Name: "Debut"}}
	for i := 0; i < 120; i++ {
		tasks = append(tasks, gamedata.Task{ID: fmt.Sprintf("filler-task-%d", i)})
	}
	cache := map[string]any{
		"fetchedAt": float64(time.Now().UnixMilli()),
		"data":      gamedata.GameData{Format: "stm-v2", Mode: mode, Tasks: tasks, Maps: []gamedata.MapInfo{}},
		"loot":      map[string]any{},
	}
	data, err := json.Marshal(cache)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(files.GameDataCache(mode), data, 0o644); err != nil {
		t.Fatal(err)
	}
}

// queuedEvents reads the events waiting for the page (the pending file Deliver writes).
func queuedEvents(t *testing.T, files storage.Files) []map[string]any {
	t.Helper()
	data, err := os.ReadFile(files.Pending)
	if err != nil {
		return nil
	}
	var queued []map[string]any
	if err := json.Unmarshal(data, &queued); err != nil {
		t.Fatal(err)
	}
	return queued
}

func taskEvent(taskID string) gamelog.Event {
	return gamelog.Event{Kind: gamelog.KindTask, TaskID: taskID, Status: "finished"}
}

func modeEvent(mode string) gamelog.Event {
	return gamelog.Event{Kind: gamelog.KindMode, Mode: mode}
}

func TestATaskEventInAnotherGameModeIsDeliveredWithThatMode(t *testing.T) {
	cases := []struct {
		name        string
		settingMode string
		sessionMode string // "": the log hasn't said yet
		wantMode    string
	}{
		{"a PvE task while Settings say PvP goes to the PvE list", "regular", "pve", "pve"},
		{"a PvP Season task while Settings say PvE goes to the PvP Season list", "pve", "pvp-season", "pvp-season"},
		{"the same mode as Settings", "pve", "pve", "pve"},
		{"unknown session mode: the Settings mode", "pve", "", "pve"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			app, files := newGameModeRig(t, testCase.settingMode)
			if testCase.sessionMode != "" {
				app.onLogEvent(modeEvent(testCase.sessionMode))
			}
			app.onLogEvent(taskEvent(knownTaskID))

			queued := queuedEvents(t, files)
			if len(queued) != 1 {
				t.Fatalf("queued %d events, want 1: %v", len(queued), queued)
			}
			got := queued[0]
			if got["type"] != "task" || got["taskId"] != knownTaskID || got["status"] != "finished" {
				t.Errorf("event = %v, want a finished task %s", got, knownTaskID)
			}
			if got["mode"] != testCase.wantMode {
				t.Errorf("mode = %v, want %q", got["mode"], testCase.wantMode)
			}
		})
	}
}

func TestATaskThatIsNotInTheGameDataIsStillDropped(t *testing.T) {
	app, files := newGameModeRig(t, "regular")
	app.onLogEvent(modeEvent("pve"))
	app.onLogEvent(taskEvent("a-daily-task"))
	if queued := queuedEvents(t, files); len(queued) != 0 {
		t.Errorf("queued %v, want nothing", queued)
	}
}

func TestTheRaidEndCarriesTheGameModeOfThatRaid(t *testing.T) {
	cases := []struct {
		name        string
		settingMode string
		sessionMode string
		wantMode    string
	}{
		{"a PvE raid while Settings say PvP", "regular", "pve", "pve"},
		{"unknown session mode: the Settings mode", "pvp-season", "", "pvp-season"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			app, files := newGameModeRig(t, testCase.settingMode)
			if testCase.sessionMode != "" {
				app.onLogEvent(modeEvent(testCase.sessionMode))
			}
			app.onLogEvent(gamelog.Event{Kind: gamelog.KindRaidStart})
			app.onLogEvent(gamelog.Event{Kind: gamelog.KindRaidLeft})

			queued := queuedEvents(t, files)
			if len(queued) != 1 || queued[0]["type"] != "raidEnd" {
				t.Fatalf("queued %v, want one raidEnd", queued)
			}
			if got := queued[0]["mode"]; got != testCase.wantMode {
				t.Errorf("mode = %v, want %q", got, testCase.wantMode)
			}
			if _, hasMap := queued[0]["map"]; !hasMap {
				t.Errorf("raidEnd lost its map field: %v", queued[0])
			}
			if got := queued[0]["deleted"]; got != float64(0) {
				t.Errorf("deleted = %v, want 0", got)
			}
		})
	}
}
