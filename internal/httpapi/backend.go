// Package httpapi is the web server the page talks to, on 127.0.0.1 only: the route table, the
// static files (page, maps, fonts) and thin handlers that decode a request, call the app, and
// encode the answer. The behaviour lives in the features; internal/app connects them.
package httpapi

import (
	"context"
	"net/http"

	"squadtaskmap/internal/features/aicategorize"
	"squadtaskmap/internal/features/taskscan"
	"squadtaskmap/internal/gamedata"
)

// Backend is everything the routes need. internal/app implements it.
type Backend interface {
	// Status is /api/status: data, settings, folders, raid, position, scan and AI status.
	Status() any
	// GameDataJSON is /api/data: the tasks and maps for the page.
	GameDataJSON() []byte
	// RefreshGameData downloads fresh game data now ("Update game data now").
	RefreshGameData() gamedata.RefreshResult

	// ServeEvents keeps the page's live-event stream open (Server-Sent Events).
	ServeEvents(writer http.ResponseWriter, request *http.Request)
	// AcknowledgeEvents: the page applied every queued event up to this id.
	AcknowledgeEvents(upToID float64)

	// ReadState is the page's saved data ("null" when there's none yet).
	ReadState() string
	// WriteState saves the page's data (refused when it isn't JSON).
	WriteState(text []byte) error

	// UpdateSettings applies the fields that were sent and returns the new status.
	UpdateSettings(change SettingsChange) any

	// SetAIKey checks and saves the OpenAI key, model and reasoning effort; returns the AI status.
	SetAIKey(ctx context.Context, key, model, effort string) (any, error)
	// RemoveAIKey forgets the OpenAI key.
	RemoveAIKey()
	// StartCategorize starts an AI Categorize job and returns its id.
	StartCategorize(request aicategorize.Request) (string, error)
	// Job reports a running or finished AI Categorize job.
	Job(id string) (*aicategorize.Job, bool)

	// Scan is "Scan tasks" (capture mode, reading, confirm/cancel).
	Scan() *taskscan.Scan
	// ScanFolder is the screenshots folder being watched (shown when the scan can't start).
	ScanFolder() string
	// ReadScanImage has one captured screenshot read by the AI (needs the OpenAI key).
	ReadScanImage(ctx context.Context, dataURL string) (taskscan.ReadResult, error)
	// ScanEnded tells the page the scan finished (confirmed or cancelled).
	ScanEnded(how string)
}

// SettingsChange holds the settings fields a PUT /api/settings sent; nil means "not sent".
type SettingsChange struct {
	GameMode        *string `json:"gameMode"`
	LogsPath        *string `json:"logsPath"`
	ScreenshotsPath *string `json:"screenshotsPath"`
	FollowPosition  *bool   `json:"followPosition"`
	AutoCenter      *bool   `json:"autoCenter"`
}
