package app

import (
	"context"
	"net/http"
	"strings"

	"squadtaskmap/internal/events"
	"squadtaskmap/internal/features/aicategorize"
	"squadtaskmap/internal/features/taskscan"
	"squadtaskmap/internal/features/updates"
	"squadtaskmap/internal/gamedata"
	"squadtaskmap/internal/httpapi"
	"squadtaskmap/internal/openai"
	"squadtaskmap/internal/storage"
)

// This file is what the page can ask for (httpapi.Backend).

var _ httpapi.Backend = (*App)(nil)

// Map names for AI Categorize's prompt (the page's map list plus maps without a page).
func (app *App) mapName(key string) string {
	if name, known := mapDisplayNames[key]; known {
		return name
	}
	return key
}

// mapDisplayNames is filled from assets/maps-config.json at start-up.
var mapDisplayNames = map[string]string{"the-lab": "The Lab", "labyrinth": "The Labyrinth", "terminal": "Terminal"}

// Status is /api/status.
func (app *App) Status() any {
	settings := app.currentSettings()
	position, trail := app.position.Current()
	app.keybindMutex.Lock()
	keybind := app.keybind
	app.keybindMutex.Unlock()
	return map[string]any{
		"version":   app.version,
		"statePath": app.files.State,
		"home":      app.files.Dir,
		"data":      app.gameData.Status(),
		"settings": map[string]any{
			"gameMode":        settings.GameModeOrDefault(),
			"logsPath":        settings.LogsPath,
			"screenshotsPath": settings.ScreenshotsPath,
			"followPosition":  settings.IsFollowPositionOn(),
			"autoCenter":      settings.IsAutoCenterOn(),
			"readExtracts":    settings.ReadExtractsChoice(),
			"extractsNotice":  settings.NeedsExtractsNotice(),
		},
		"logs":        app.logs.Status(),
		"screenshots": app.screenshots.Status(),
		"keybind":     keybind,
		"raid":        app.raid.Status(),
		"gps":         position,
		"trail":       trail,
		"capture":     map[string]any{"active": app.scan.IsActive(), "files": app.scan.List()},
		"ai":          app.aiStatus(settings),
		"updates":     app.updates.Status(),
	}
}

func (app *App) aiStatus(settings storage.Settings) map[string]any {
	model := settings.OpenAIModel
	if model == "" {
		model = openai.DefaultModel
	}
	return map[string]any{"hasKey": settings.OpenAIKey != "", "key": storage.MaskKey(settings.OpenAIKey), "model": model, "effort": settings.OpenAIEffort}
}

// GameDataJSON is /api/data.
func (app *App) GameDataJSON() []byte { return app.gameData.JSON() }

// RefreshGameData downloads fresh data now.
func (app *App) RefreshGameData() gamedata.RefreshResult { return app.gameData.Refresh() }

// ServeEvents keeps the page's live-event stream open.
func (app *App) ServeEvents(writer http.ResponseWriter, request *http.Request) {
	app.hub.ServeSSE(writer, request)
}

// AcknowledgeEvents drops queued events the page has applied.
func (app *App) AcknowledgeEvents(upToID float64) { app.hub.Acknowledge(upToID) }

// ReadState is the page's saved data.
func (app *App) ReadState() string { return storage.ReadStateText(app.files.State) }

// WriteState saves the page's data.
func (app *App) WriteState(text []byte) error { return storage.WriteStateText(app.files.State, text) }

// UpdateSettings applies a settings change. A new game mode switches the game data; new folders
// restart the watchers.
func (app *App) UpdateSettings(change httpapi.SettingsChange) any {
	app.settingsMutex.Lock()
	previous := app.settings
	next := app.settings
	if change.GameMode != nil && isGameMode(*change.GameMode) {
		next.GameMode = *change.GameMode
	}
	if change.LogsPath != nil {
		next.LogsPath = strings.TrimSpace(*change.LogsPath)
	}
	if change.ScreenshotsPath != nil {
		next.ScreenshotsPath = strings.TrimSpace(*change.ScreenshotsPath)
	}
	if change.FollowPosition != nil {
		next.FollowPosition = change.FollowPosition
	}
	if change.AutoCenter != nil {
		next.AutoCenter = change.AutoCenter
	}
	if change.ReadExtracts != nil {
		next.ReadExtracts = change.ReadExtracts
	}
	if change.ExtractsNoticeSeen != nil {
		next.ExtractsNoticeSeen = *change.ExtractsNoticeSeen
	}
	app.settings = next
	app.settingsMutex.Unlock()
	_ = storage.WriteSettings(app.files.Settings, next)

	if next.GameModeOrDefault() != previous.GameModeOrDefault() {
		app.gameData.SetMode(next.GameModeOrDefault(), true)
	}
	if next.LogsPath != previous.LogsPath || next.ScreenshotsPath != previous.ScreenshotsPath {
		app.startWatchers()
	}
	return app.Status()
}

func isGameMode(mode string) bool { return mode == "regular" || mode == "pve" || mode == "pvp-season" }

// SetAIKey checks and saves the OpenAI key (an empty key keeps the saved one), model and effort.
func (app *App) SetAIKey(ctx context.Context, key, model, effort string) (any, error) {
	settings := app.currentSettings()
	if key == "" {
		key = settings.OpenAIKey
	}
	if model == "" {
		model = openai.DefaultModel
	}
	if err := openai.CheckKeyShape(key); err != nil {
		return nil, err
	}
	if err := openai.CheckModelName(model); err != nil {
		return nil, err
	}
	if err := app.ai.CheckKey(ctx, key, model); err != nil {
		return nil, err
	}
	app.settingsMutex.Lock()
	app.settings.OpenAIKey, app.settings.OpenAIModel, app.settings.OpenAIEffort = key, model, effort
	saved := app.settings
	app.settingsMutex.Unlock()
	_ = storage.WriteSettings(app.files.Settings, saved)
	return app.aiStatus(saved), nil
}

// RemoveAIKey forgets the key.
func (app *App) RemoveAIKey() {
	app.settingsMutex.Lock()
	app.settings.OpenAIKey = ""
	saved := app.settings
	app.settingsMutex.Unlock()
	_ = storage.WriteSettings(app.files.Settings, saved)
}

// StartCategorize starts an AI Categorize job.
func (app *App) StartCategorize(request aicategorize.Request) (string, error) {
	settings := app.currentSettings()
	if settings.OpenAIKey == "" {
		return "", httpapi.ErrNoAIKey
	}
	if request.Instruction == "" {
		return "", errType("Type an instruction")
	}
	tasksByID := map[string]gamedata.Task{}
	for _, task := range app.gameData.Current().Tasks {
		tasksByID[task.ID] = task
	}
	model := settings.OpenAIModel
	if model == "" {
		model = openai.DefaultModel
	}
	id := app.jobs.Start(func(report func(string)) (aicategorize.Result, error) {
		ctx, cancel := context.WithTimeout(context.Background(), aicategorize.JobTimeout)
		defer cancel()
		return app.categorizer.Categorize(ctx, request, tasksByID, app.mapName, settings.OpenAIKey, model, settings.OpenAIEffort, report)
	})
	return id, nil
}

// Job reports an AI Categorize job.
func (app *App) Job(id string) (*aicategorize.Job, bool) { return app.jobs.Get(id) }

// Scan is the task scan.
func (app *App) Scan() *taskscan.Scan { return app.scan }

// IconPath is an item icon's file, downloaded on first use (ticket 07).
func (app *App) IconPath(ctx context.Context, itemID string) (string, error) {
	return app.icons.Path(ctx, itemID)
}

// ScanFolder is the watched screenshots folder.
func (app *App) ScanFolder() string { return app.screenshots.Dir() }

// ReadScanImage has a captured screenshot read by the AI.
func (app *App) ReadScanImage(ctx context.Context, dataURL string) (taskscan.ReadResult, error) {
	settings := app.currentSettings()
	if settings.OpenAIKey == "" {
		return taskscan.ReadResult{}, httpapi.ErrNoAIKey
	}
	model := settings.OpenAIModel
	if model == "" {
		model = openai.DefaultModel
	}
	return app.scan.Read(ctx, settings.OpenAIKey, model, dataURL)
}

// ScanEnded tells the page the scan finished: "done" (confirmed) or "cancelled".
func (app *App) ScanEnded(how string) {
	app.hub.Broadcast(events.New(events.Capture, map[string]any{"files": []taskscan.CapturedFile{}, how: true}))
}

// Updates is "Check for updates" (check, download, cancel, install).
func (app *App) Updates() *updates.Updater { return app.updates }

type errType string

func (e errType) Error() string { return string(e) }
