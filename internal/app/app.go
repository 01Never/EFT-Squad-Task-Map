// Package app creates every feature and connects them: what happens when the game log says
// something, when a screenshot appears, and what the page can ask for. Read this file first.
//
//	Tarkov logs ──(5 s size check)──► gamelog ──┐
//	Screenshots ──(file notifications)► screenshots ─┤                      ┌─► page (SSE events)
//	json.tarkov.dev ──(hourly check)──► gamedata ───┼─► app (this package) ─┤
//	OpenAI ◄──(scan, categorize)────── taskscan / aicategorize ─┘           └─◄ page (HTTP API)
//	Friends ◄─(tailnet peer API, only when joined)─► squad ─► app (squad.go) ─► page ("squad" event)
package app

import (
	"sync"

	"squadtaskmap/internal/events"
	"squadtaskmap/internal/features/aicategorize"
	"squadtaskmap/internal/features/extracts"
	"squadtaskmap/internal/features/gamelog"
	"squadtaskmap/internal/features/gps"
	"squadtaskmap/internal/features/icons"
	"squadtaskmap/internal/features/raid"
	"squadtaskmap/internal/features/squad"
	"squadtaskmap/internal/features/taskscan"
	"squadtaskmap/internal/features/updates"
	"squadtaskmap/internal/gamedata"
	"squadtaskmap/internal/gamefolders"
	"squadtaskmap/internal/openai"
	"squadtaskmap/internal/screenshots"
	"squadtaskmap/internal/storage"
)

// App holds every part of the running program.
type App struct {
	version string
	files   storage.Files

	settingsMutex sync.Mutex
	settings      storage.Settings

	hub         *events.Hub
	gameData    *gamedata.Store
	logs        *gamelog.Watcher
	screenshots *screenshots.Watcher
	raid        *raid.Tracker
	position    *gps.Tracker
	scan        *taskscan.Scan
	extracts    *extracts.Reader // ticket 06: my extracts from the first raid screenshot
	categorizer *aicategorize.Categorizer
	jobs        *aicategorize.Jobs
	ai          *openai.Client
	updates     *updates.Updater
	squad       *squad.Squad // ticket 05: started only when the player is in a squad (squad.go)
	icons       *icons.Cache // ticket 07: item pictures for markers and the Bring list

	// raidAndPosition keeps a raid end and a new position from interleaving: the log and the
	// screenshots folder are watched on different goroutines, and a position must never arrive
	// after the raid-end that deleted its screenshot.
	raidAndPosition sync.Mutex

	keybindMutex sync.Mutex
	keybind      *keybindStatus // nil until the log shows the control settings

	// exitRequested is closed when an update has started the new copy and this one must close.
	exitRequested chan struct{}
	exitOnce      sync.Once
}

type keybindStatus struct {
	OK      bool    `json:"ok"`
	Warning *string `json:"warning"`
}

// newApp creates the features and connects them. Nothing is watched yet; see startWatchers.
// updatedFrom is the old version when an update started this copy ("" otherwise).
func newApp(version, updatedFrom string, files storage.Files, builtInGameData func() (gamedata.GameData, error)) *App {
	userAgent := "SquadTaskMap/" + version + " (personal local map tool)"
	app := &App{version: version, files: files, raid: &raid.Tracker{}, position: &gps.Tracker{}, exitRequested: make(chan struct{})}

	storage.BackupV1IfNeeded(files)
	app.settings = storage.ReadSettings(files.Settings)
	app.hub = events.NewHub(files.Pending)
	app.ai = openai.NewClient(userAgent)
	app.jobs = aicategorize.NewJobs()
	app.categorizer = aicategorize.New(app.ai, aicategorize.NewWiki(files.WikiCache, userAgent))

	app.gameData = gamedata.NewStore(files, builtInGameData, userAgent, app.onGameDataChanged)
	app.logs = gamelog.NewWatcher(app.onLogEvent)
	app.screenshots = screenshots.NewWatcher(gps.IsImageFile, app.onScreenshot)
	app.scan = taskscan.New(app.screenshots, app.ai, app.onCaptureListChanged)
	app.extracts = newExtractsReader(app)
	app.updates = newUpdater(app, updatedFrom, userAgent)
	app.squad = newSquad(app)
	app.icons = icons.NewCacheFromEnvironment(files.Icons, userAgent)
	app.icons.Known = app.gameData.ItemKnown // only items in the game data are ever fetched
	return app
}

// startWatchers (re)starts the log and screenshot watchers on the folders from Settings, or the
// ones found on this PC.
func (app *App) startWatchers() {
	settings := app.currentSettings()
	logsDir := settings.LogsPath
	if logsDir == "" {
		logsDir = gamefolders.LogsDir()
	}
	screenshotsDir := settings.ScreenshotsPath
	if screenshotsDir == "" {
		screenshotsDir = gamefolders.ScreenshotsDir()
	}
	app.logs.Start(logsDir)
	app.screenshots.Start(screenshotsDir)
}

// ---------------------------------------------------------------- the game log

// onLogEvent reacts to one event from Tarkov's logs.
func (app *App) onLogEvent(event gamelog.Event) {
	switch event.Kind {
	case gamelog.KindTask:
		app.onTaskChanged(event)
	case gamelog.KindMode:
		app.raid.SetSessionMode(event.Mode)
		app.hub.Broadcast(events.New(events.Mode, map[string]any{"mode": event.Mode, "dataMode": app.currentSettings().GameModeOrDefault()}))
	case gamelog.KindMapLoading:
		mapKey := app.gameData.MapFromScene(event.Scene)
		app.raid.MapLoading(mapKey)
		app.hub.Broadcast(events.New(events.RaidMap, map[string]any{"map": mapKey}))
	case gamelog.KindMapLoaded:
		app.raid.MapLoaded(app.gameData.MapFromNameID(event.NameID))
	case gamelog.KindRaidStart:
		mapKey := app.raid.Start()
		app.position.ClearTrail()
		app.extracts.RaidStarted()
		app.hub.Broadcast(events.New(events.RaidStart, map[string]any{"map": mapKey}))
	case gamelog.KindRaidLeft, gamelog.KindProfileSelected:
		if app.raid.ShouldEndOnMenuReturn() {
			app.endRaid()
		}
	case gamelog.KindMatchingAborted:
		app.raid.MatchingAborted()
	case gamelog.KindKeybind:
		app.onScreenshotKeyChecked(event)
	}
}

// onTaskChanged: a task started, finished or failed in the game. It reaches the page (and stays
// queued until the page has it) when it's in the chosen game mode and in the task data; daily and
// weekly tasks aren't.
func (app *App) onTaskChanged(event gamelog.Event) {
	if !raid.ModeMatches(app.raid.SessionMode(), app.currentSettings().GameModeOrDefault()) {
		return
	}
	if !app.gameData.TaskExists(event.TaskID) {
		return
	}
	app.hub.Deliver(events.New(events.Task, map[string]any{"taskId": event.TaskID, "status": event.Status}))
}

// endRaid: back in the menus after a raid. Delete that raid's GPS screenshots, forget the position,
// and tell the page (queued, so it resets bag counts and extract marks even if it was closed).
func (app *App) endRaid() {
	app.raidAndPosition.Lock()
	defer app.raidAndPosition.Unlock()
	app.extracts.RaidEnded() // before the raidEnd below, so a late answer can't mark the next raid's map
	mapKey, deleted := app.raid.End(gps.IsGPSFileName, app.screenshots.DeleteFile)
	app.hub.Deliver(events.New(events.RaidEnd, map[string]any{"map": mapKey, "deleted": deleted}))
	app.position.Clear()
}

func (app *App) onScreenshotKeyChecked(event gamelog.Event) {
	status := &keybindStatus{OK: event.OK}
	if !event.OK {
		warning := event.Warning
		status.Warning = &warning
	}
	app.keybindMutex.Lock()
	app.keybind = status
	app.keybindMutex.Unlock()
	app.hub.Broadcast(events.New(events.Keybind, map[string]any{"ok": status.OK, "warning": status.Warning}))
}

// ---------------------------------------------------------------- screenshots

// onScreenshot: a picture appeared (or disappeared) in the screenshots folder. In-raid shots carry
// a position in their name; everything else may belong to a task scan.
func (app *App) onScreenshot(file screenshots.File) {
	if !file.Exists {
		app.scan.OnScreenshot(file)
		return
	}
	fix, hasPosition := gps.ParseFileName(file.Name)
	if !hasPosition {
		app.scan.OnScreenshot(file)
		return
	}
	app.raidAndPosition.Lock()
	defer app.raidAndPosition.Unlock()
	app.raid.NoteGPSShot(file.Name)
	app.extracts.OnGPSShot(file.Name)
	position, trail := app.position.Update(fix, app.raid.CurrentMap())
	app.hub.Broadcast(events.New(events.GPS, map[string]any{"gps": position, "trail": trail}))
}

func (app *App) onCaptureListChanged(files []taskscan.CapturedFile) {
	app.hub.Broadcast(events.New(events.Capture, map[string]any{"files": files}))
}

// ---------------------------------------------------------------- game data

func (app *App) onGameDataChanged() {
	app.hub.Broadcast(events.New(events.Data, map[string]any{"status": app.gameData.Status()}))
}

// ---------------------------------------------------------------- updates

// onUpdateStatusChanged tells the open page how "Check for updates" is going (check result,
// download progress, installing). Live only: a page opened later reads /api/status.
func (app *App) onUpdateStatusChanged(status updates.Status) {
	app.hub.Broadcast(events.New(events.Updates, map[string]any{"status": status}))
}

// ---------------------------------------------------------------- settings

func (app *App) currentSettings() storage.Settings {
	app.settingsMutex.Lock()
	defer app.settingsMutex.Unlock()
	return app.settings
}
