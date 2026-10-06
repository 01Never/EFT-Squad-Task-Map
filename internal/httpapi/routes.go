package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"squadtaskmap/internal/features/aicategorize"
	"squadtaskmap/internal/features/taskscan"
)

// Request bodies larger than this are refused (the biggest is a scan screenshot, ~2–5 MB).
const maxRequestBody = 32 << 20

// Server serves the page and its API.
type Server struct {
	backend Backend
	static  *staticFiles
	mux     *http.ServeMux
}

// NewServer builds the route table.
func NewServer(backend Backend, static *staticFiles) *Server {
	server := &Server{backend: backend, static: static, mux: http.NewServeMux()}
	routes := []struct {
		pattern string
		handler http.HandlerFunc
	}{
		// The page and its files.
		{"GET /{$}", static.serveIndex},
		{"GET /index.html", static.serveIndex},
		{"GET /js/", static.serveScript},
		{"GET /fonts/{name}", static.serveFont},
		{"GET /maps/{file}", static.serveMapArt},
		{"GET /api/config", static.serveMapsConfig},

		// Game data, status and live events.
		{"GET /api/data", server.gameData},
		{"GET /api/status", server.status},
		{"POST /api/data/refresh", server.refreshGameData},
		{"GET /api/events", server.events},
		{"POST /api/events/ack", server.acknowledgeEvents},

		// The page's saved data and the settings.
		{"GET /api/state", server.readState},
		{"PUT /api/state", server.writeState},
		{"PUT /api/settings", server.updateSettings},

		// OpenAI key and AI Categorize.
		{"PUT /api/ai/key", server.setAIKey},
		{"DELETE /api/ai/key", server.removeAIKey},
		{"POST /api/ai/categorize", server.startCategorize},
		{"GET /api/ai/job/{id}", server.job},

		// Scan tasks.
		{"POST /api/scan/start", server.startScan},
		{"POST /api/scan/stop", server.stopScan},
		{"POST /api/scan/cancel", server.cancelScan},
		{"POST /api/scan/remove", server.removeFromScan},
		{"GET /api/scan/image", server.scanImage},
		{"POST /api/scan/read", server.readScanImage},
		{"POST /api/scan/confirm", server.confirmScan},

		// Check for updates (every one of these starts from a click; see updates.go).
		{"POST /api/updates/check", server.checkForUpdates},
		{"POST /api/updates/download", server.downloadUpdate},
		{"POST /api/updates/cancel", server.cancelUpdateDownload},
		{"POST /api/updates/apply", server.applyUpdate},
		{"POST /api/updates/seen", server.updateNoticeSeen},
	}
	for _, route := range routes {
		server.mux.HandleFunc(route.pattern, route.handler)
	}
	// Anything else (or a known path with the wrong method), as v2 answered it.
	server.mux.HandleFunc("/", func(writer http.ResponseWriter, _ *http.Request) {
		http.Error(writer, "Not found", http.StatusNotFound)
	})
	return server
}

// ServeHTTP answers every request; unknown paths get "Not found".
func (server *Server) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(writer, request.Body, maxRequestBody)
	server.mux.ServeHTTP(writer, request)
}

// ---------------------------------------------------------------- game data, status, events

func (server *Server) gameData(writer http.ResponseWriter, _ *http.Request) {
	writeRawJSON(writer, http.StatusOK, server.backend.GameDataJSON())
}

func (server *Server) status(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, server.backend.Status())
}

func (server *Server) refreshGameData(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, server.backend.RefreshGameData())
}

func (server *Server) events(writer http.ResponseWriter, request *http.Request) {
	server.backend.ServeEvents(writer, request)
}

func (server *Server) acknowledgeEvents(writer http.ResponseWriter, request *http.Request) {
	body := readBody(request)
	if upTo, isNumber := body["upTo"].(float64); isNumber {
		server.backend.AcknowledgeEvents(upTo)
	}
	writeJSON(writer, http.StatusOK, okAnswer())
}

// ---------------------------------------------------------------- saved data and settings

func (server *Server) readState(writer http.ResponseWriter, _ *http.Request) {
	writeRawJSON(writer, http.StatusOK, []byte(server.backend.ReadState()))
}

func (server *Server) writeState(writer http.ResponseWriter, request *http.Request) {
	text, err := io.ReadAll(request.Body)
	if err == nil {
		err = server.backend.WriteState(text)
	}
	if err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(writer, http.StatusOK, okAnswer())
}

func (server *Server) updateSettings(writer http.ResponseWriter, request *http.Request) {
	body := readBody(request)
	change := SettingsChange{
		GameMode:        stringField(body, "gameMode"),
		LogsPath:        stringField(body, "logsPath"),
		ScreenshotsPath: stringField(body, "screenshotsPath"),
		FollowPosition:  boolField(body, "followPosition"),
		AutoCenter:      boolField(body, "autoCenter"),
	}
	writeJSON(writer, http.StatusOK, map[string]any{"ok": true, "status": server.backend.UpdateSettings(change)})
}

// ---------------------------------------------------------------- OpenAI key and AI Categorize

// setAIKey: an empty key keeps the saved one (changing only the model or effort). The backend checks
// the key and model shapes, then asks OpenAI whether they work.
func (server *Server) setAIKey(writer http.ResponseWriter, request *http.Request) {
	body := readBody(request)
	key := strings.TrimSpace(textField(body, "key"))
	model := strings.TrimSpace(textField(body, "model"))
	effort := textField(body, "effort")
	if effort != "" && effort != "low" && effort != "medium" && effort != "high" {
		effort = ""
	}
	aiStatus, err := server.backend.SetAIKey(request.Context(), key, model, effort)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err)
		return
	}
	answer := map[string]any{"ok": true}
	for field, value := range aiStatus.(map[string]any) {
		answer[field] = value
	}
	writeJSON(writer, http.StatusOK, answer)
}

func (server *Server) removeAIKey(writer http.ResponseWriter, _ *http.Request) {
	server.backend.RemoveAIKey()
	writeJSON(writer, http.StatusOK, okAnswer())
}

// Limits on what the page sends for AI Categorize.
const (
	maxInstructionLength = 2000
	maxHistoryTurns      = 8
	maxHistoryTurnLength = 4000
	maxCategories        = 50
	maxParts             = 500
)

func (server *Server) startCategorize(writer http.ResponseWriter, request *http.Request) {
	var body struct {
		Instruction any                     `json:"instruction"`
		History     []map[string]any        `json:"history"`
		MapName     any                     `json:"mapName"`
		Categories  []aicategorize.Category `json:"categories"`
		Parts       []aicategorize.Part     `json:"parts"`
	}
	_ = json.NewDecoder(request.Body).Decode(&body)
	categorizeRequest := aicategorize.Request{
		Instruction: limitRunes(strings.TrimSpace(textOrEmpty(body.Instruction)), maxInstructionLength),
		MapName:     textOrEmpty(body.MapName),
		Categories:  firstN(body.Categories, maxCategories),
		Parts:       firstN(body.Parts, maxParts),
	}
	history := body.History
	if len(history) > maxHistoryTurns {
		history = history[len(history)-maxHistoryTurns:]
	}
	for _, turn := range history {
		role := "user"
		if turn["role"] == "assistant" {
			role = "assistant"
		}
		categorizeRequest.History = append(categorizeRequest.History, aicategorize.Turn{Role: role, Content: limitRunes(textOrEmpty(turn["content"]), maxHistoryTurnLength)})
	}
	id, err := server.backend.StartCategorize(categorizeRequest)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"ok": true, "job": id})
}

func (server *Server) job(writer http.ResponseWriter, request *http.Request) {
	job, found := server.backend.Job(request.PathValue("id"))
	if !found {
		writeJSON(writer, http.StatusNotFound, map[string]any{"status": "error", "error": "Job not found"})
		return
	}
	writeJSON(writer, http.StatusOK, job)
}

// ---------------------------------------------------------------- scan tasks

func (server *Server) startScan(writer http.ResponseWriter, _ *http.Request) {
	if err := server.backend.Scan().Start(); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error(), "dir": optional(server.backend.ScanFolder())})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"ok": true, "dir": optional(server.backend.ScanFolder())})
}

func (server *Server) stopScan(writer http.ResponseWriter, _ *http.Request) {
	server.backend.Scan().Stop()
	writeJSON(writer, http.StatusOK, map[string]any{"ok": true, "files": server.backend.Scan().List()})
}

func (server *Server) cancelScan(writer http.ResponseWriter, _ *http.Request) {
	server.backend.Scan().Cancel()
	server.backend.ScanEnded("cancelled")
	writeJSON(writer, http.StatusOK, okAnswer())
}

func (server *Server) removeFromScan(writer http.ResponseWriter, request *http.Request) {
	server.backend.Scan().Remove(textOrEmpty(readBody(request)["name"]))
	writeJSON(writer, http.StatusOK, okAnswer())
}

func (server *Server) scanImage(writer http.ResponseWriter, request *http.Request) {
	data, contentType, found := server.backend.Scan().Image(request.URL.Query().Get("name"))
	if !found {
		http.Error(writer, "Not found", http.StatusNotFound)
		return
	}
	writer.Header().Set("Content-Type", contentType)
	writer.Header().Set("Cache-Control", "no-store")
	writer.Write(data)
}

func (server *Server) readScanImage(writer http.ResponseWriter, request *http.Request) {
	result, err := server.backend.ReadScanImage(request.Context(), textOrEmpty(readBody(request)["image"]))
	switch {
	case errors.Is(err, errNoAIKey), errors.Is(err, taskscan.ErrBadImage):
		writeError(writer, http.StatusBadRequest, err)
	case err != nil:
		writeError(writer, http.StatusBadGateway, err)
	default:
		writeJSON(writer, http.StatusOK, map[string]any{"ok": true, "rows": result.Rows, "usage": result.Usage})
	}
}

func (server *Server) confirmScan(writer http.ResponseWriter, request *http.Request) {
	var names []string
	for _, name := range asList(readBody(request)["names"]) {
		names = append(names, textOrEmpty(name))
	}
	deleted := server.backend.Scan().Confirm(names)
	server.backend.ScanEnded("done")
	writeJSON(writer, http.StatusOK, map[string]any{"ok": true, "deleted": deleted})
}

// errNoAIKey is what the backend returns when an AI feature is used without a key.
var errNoAIKey = errors.New("Add your OpenAI API key first")

// ErrNoAIKey is exported for the backend to return.
var ErrNoAIKey = errNoAIKey
