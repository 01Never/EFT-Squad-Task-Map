package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"squadtaskmap/internal/features/updates"
	"squadtaskmap/internal/gamedata"
	"squadtaskmap/internal/httpapi"
	"squadtaskmap/internal/storage"
)

// Version is the app's version, shown in Settings and used by "Check for updates".
const Version = "2.7.0"

// The page is served on the first free port from 7777 (PORT overrides the start) up to 7800.
const (
	defaultPort = 7777
	lastPort    = 7800
)

// Run starts the app and blocks until it's closed. builtIn holds the files compiled into the exe
// (web/ and assets/).
func Run(builtIn fs.FS) error {
	files := storage.FilesIn(storage.DataDir())
	assets, isDev := pageFiles(builtIn)

	// An update started this copy: the old one is still closing its port. Wait for it first,
	// or the check below would find the old copy and just open its page. (Ticket 04c.)
	updatedFrom := updates.UpdatedFromArgument(os.Args[1:])
	if updatedFrom != "" {
		waitForOldCopy(files)
	}

	if url, running := runningCopy(files); running {
		fmt.Println("\n  Squad Task Map is already running: " + url)
		openBrowser(url)
		return nil
	}

	loadMapNames(assets)
	app := newApp(Version, updatedFrom, files, builtInGameData(builtIn))
	app.gameData.Start(app.currentSettings().GameModeOrDefault())

	static, err := httpapi.NewStatic(assets, Version, isDev)
	if err != nil {
		return fmt.Errorf("reading the page files: %w", err)
	}
	listener, port, err := listenOnFreePort()
	if err != nil {
		return err
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/", port)
	rememberRunningCopy(files, port)
	defer forgetRunningCopy(files)

	// Only the app's own page may use the server (ticket 04d): see localPageHosts.
	handler := httpapi.Guard(localPageHosts(port), httpapi.NewServer(app, static))
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	// Goroutine: the web server; ends when server.Shutdown is called below.
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fmt.Println("  Web server stopped:", err)
		}
	}()

	app.startWatchers()
	app.startSquad() // only when the player is in a squad (ticket 05)
	printBanner(app, url, isDev)
	if updatedFrom == "" {
		// After an update the page that clicked "Download and restart" is still open and
		// reconnects by itself; a second tab would be noise.
		openBrowser(url)
	}

	waitForClose(app.exitRequested)
	app.squad.Stop() // close friends' streams and the squad network (nothing is deleted)
	app.hub.Close()  // end the live-event streams, so the server stops at once
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = server.Shutdown(ctx)
	return nil
}

// pageFiles: the files built into the exe; or, while developing (STM_ASSETS_DIR, or `go run`
// from the repo), the files on disk, so a page edit shows on reload.
func pageFiles(builtIn fs.FS) (fs.FS, bool) {
	dir := os.Getenv("STM_ASSETS_DIR")
	if dir == "" && runningUnderGoRun() && storage.FileExists(filepath.Join("web", "index.html")) {
		dir = "."
	}
	if dir == "" {
		return builtIn, false
	}
	return os.DirFS(dir), true
}

func runningUnderGoRun() bool {
	exe, err := os.Executable()
	return err == nil && strings.Contains(strings.ToLower(exe), "go-build")
}

// builtInGameData converts the snapshot in the exe once, the first time it's needed.
func builtInGameData(builtIn fs.FS) func() (gamedata.GameData, error) {
	var once sync.Once
	var converted gamedata.GameData
	var err error
	return func() (gamedata.GameData, error) {
		once.Do(func() {
			var data []byte
			data, err = fs.ReadFile(builtIn, "assets/game-data.json")
			if err == nil {
				converted, err = gamedata.FromAny(data, "regular")
			}
		})
		return converted, err
	}
}

// loadMapNames reads each map's display name from assets/maps-config.json (for AI Categorize).
func loadMapNames(assets fs.FS) {
	data, err := fs.ReadFile(assets, "assets/maps-config.json")
	if err != nil {
		return
	}
	var maps []struct {
		Key  string `json:"key"`
		Name string `json:"name"`
	}
	if json.Unmarshal(data, &maps) != nil {
		return
	}
	for _, info := range maps {
		mapDisplayNames[info.Key] = info.Name
	}
}

func listenOnFreePort() (net.Listener, int, error) {
	first := defaultPort
	if fromEnv, err := strconv.Atoi(os.Getenv("PORT")); err == nil && fromEnv > 0 {
		first = fromEnv
	}
	var lastErr error
	for port := first; port <= max(first, lastPort); port++ {
		listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			return listener, port, nil
		}
		lastErr = err
	}
	return nil, 0, fmt.Errorf("no free port from %d to %d: %w", first, lastPort, lastErr)
}

// localPageHosts: the names the page is opened with, on the port this copy listens on. The
// server answers no other Host, and takes state-changing requests only from these origins.
// (Ticket 05's peer API is a separate listener with its own caller check, internal/features/squad.)
func localPageHosts(port int) httpapi.AllowedHosts {
	return httpapi.AllowedHosts{
		fmt.Sprintf("127.0.0.1:%d", port),
		fmt.Sprintf("localhost:%d", port),
	}
}

// ---------------------------------------------------------------- one copy at a time

// Two copies on the same data folder would both watch the logs and overwrite each other's saved
// data. A second launch just opens the page of the copy that's already running, then exits.
// (Copies with different STM_DATA_DIR folders can run side by side, for testing.)
type runningCopyInfo struct {
	Port int `json:"port"`
	PID  int `json:"pid"`
}

func runningCopy(files storage.Files) (string, bool) {
	data, err := os.ReadFile(files.Instance)
	if err != nil {
		return "", false
	}
	var info runningCopyInfo
	if json.Unmarshal(data, &info) != nil || info.Port == 0 {
		return "", false
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/", info.Port)
	client := http.Client{Timeout: time.Second}
	response, err := client.Get(url + "api/status")
	if err != nil {
		return "", false
	}
	defer response.Body.Close()
	var status struct {
		StatePath string `json:"statePath"`
	}
	if json.NewDecoder(response.Body).Decode(&status) != nil || status.StatePath != files.State {
		return "", false // something else is on that port now
	}
	return url, true
}

// forgetRunningCopy removes the instance file, but only if it is still ours: after an update the
// new copy has already written its own while this one finishes shutting down.
func forgetRunningCopy(files storage.Files) {
	data, err := os.ReadFile(files.Instance)
	if err != nil {
		return
	}
	var info runningCopyInfo
	if json.Unmarshal(data, &info) == nil && info.PID != os.Getpid() {
		return
	}
	_ = os.Remove(files.Instance)
}

// waitForOldCopy gives the copy that started this one (after an update) time to close its port.
func waitForOldCopy(files storage.Files) {
	data, err := os.ReadFile(files.Instance)
	if err != nil {
		return
	}
	var info runningCopyInfo
	if json.Unmarshal(data, &info) != nil || info.Port == 0 {
		return
	}
	updates.WaitUntilPortIsFree(info.Port, updates.WaitForOldCopy)
}

func rememberRunningCopy(files storage.Files, port int) {
	data, _ := json.Marshal(runningCopyInfo{Port: port, PID: os.Getpid()})
	_ = storage.WriteFileAtomic(files.Instance, data)
}

// ---------------------------------------------------------------- console and browser

func printBanner(app *App, url string, isDev bool) {
	dataStatus := app.gameData.Status()
	gameData := dataStatus.Origin
	if dataStatus.Generated != nil && len(*dataStatus.Generated) >= 10 {
		gameData += " (" + (*dataStatus.Generated)[:10] + ")"
	}
	logs := app.logs.Status()
	shots := app.screenshots.Status()
	fmt.Printf("\n  Squad Task Map %s is running\n", Version)
	fmt.Println("  Open: " + url)
	fmt.Println("  Your data:        " + app.files.State)
	fmt.Println("  Game data:        " + gameData)
	fmt.Println("  Game logs:        " + folderOrMessage(logs.OK, logs.Dir, logs.Message))
	fmt.Println("  Screenshots:      " + folderOrMessage(shots.OK, shots.Dir, shots.Message))
	if isDev {
		fmt.Println("  Page files:       from disk (development)")
	}
	fmt.Println("\n  Close this window to stop.")
}

func folderOrMessage(ok bool, dir *string, message string) string {
	if ok && dir != nil {
		return *dir
	}
	return message
}

// openBrowser opens the page in the default browser, unless STM_NO_BROWSER is set.
func openBrowser(url string) {
	if os.Getenv("STM_NO_BROWSER") != "" {
		return
	}
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		command = exec.Command("open", url)
	default:
		command = exec.Command("xdg-open", url)
	}
	_ = command.Start() // the URL is printed above if this fails
}

// waitForClose blocks until Ctrl+C, the console window is closed, or an update asks the app to
// exit (the exitRequested channel is closed once the new copy has been started).
func waitForClose(exitRequested <-chan struct{}) {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	select {
	case <-signals:
	case <-exitRequested:
	}
}
