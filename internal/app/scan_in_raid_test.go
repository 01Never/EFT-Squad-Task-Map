package app

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"squadtaskmap/internal/features/gamelog"
	"squadtaskmap/internal/gamedata"
	"squadtaskmap/internal/screenshots"
	"squadtaskmap/internal/storage"
)

// A position-named shot, as the game writes it in a raid.
const positionShotName = "2026-09-21[17-56]_-153.40, 2.16, -63.31_0.04621, 0.54697, -0.02860, 0.83539_7.65 (0).png"

// A menu-style shot: no position in the name.
const menuShotName = "2026-10-04[15-44] (0).png"

// screenshotRig is an app watching a scratch screenshots folder.
type screenshotRig struct {
	t      *testing.T
	app    *App
	folder string
}

func newScreenshotRig(t *testing.T) *screenshotRig {
	t.Helper()
	notNeeded := func() (gamedata.GameData, error) { return gamedata.GameData{}, errors.New("not needed") }
	app := newApp("2.5.0", "", storage.FilesIn(t.TempDir()), notNeeded)
	folder := t.TempDir()
	app.screenshots.Start(folder)
	t.Cleanup(app.screenshots.Stop)
	return &screenshotRig{t: t, app: app, folder: folder}
}

// takeShot writes the picture and hands it to the app, as the watcher does once it has settled.
func (rig *screenshotRig) takeShot(name string) {
	rig.t.Helper()
	path := filepath.Join(rig.folder, name)
	if err := os.WriteFile(path, []byte("png"), 0o644); err != nil {
		rig.t.Fatal(err)
	}
	rig.app.onScreenshot(screenshots.File{Name: name, Exists: true, Modified: time.Now(), Size: 3})
}

func (rig *screenshotRig) fileExists(name string) bool {
	_, err := os.Stat(filepath.Join(rig.folder, name))
	return err == nil
}

func (rig *screenshotRig) captured(name string) bool {
	for _, file := range rig.app.scan.List() {
		if file.Name == name {
			return true
		}
	}
	return false
}

func (rig *screenshotRig) startCapture() {
	rig.t.Helper()
	if err := rig.app.scan.Start(); err != nil {
		rig.t.Fatal(err)
	}
}

func (rig *screenshotRig) logEvent(kind string) {
	rig.app.onLogEvent(gamelog.Event{Kind: kind})
}

func TestACapturedPositionShotJoinsTheScanAndMovesTheMarkerButIsNotARaidShot(t *testing.T) {
	rig := newScreenshotRig(t)
	rig.startCapture()

	rig.takeShot(positionShotName)

	if !rig.captured(positionShotName) {
		t.Error("the position-named shot should be in the capture list")
	}
	if position, _ := rig.app.position.Current(); position == nil {
		t.Error("the captured shot should still move the marker")
	}
	if rig.app.raid.ShouldEndOnMenuReturn() {
		t.Error("a captured shot must not count as a GPS shot for EndsOnMenuReturn")
	}

	rig.logEvent(gamelog.KindProfileSelected)

	if !rig.fileExists(positionShotName) {
		t.Error("a profile-select line must not delete the captured shot")
	}
}

func TestACapturedPositionShotInARaidIsNotDeletedAtRaidEnd(t *testing.T) {
	rig := newScreenshotRig(t)
	rig.logEvent(gamelog.KindRaidStart)
	rig.startCapture()

	rig.takeShot(positionShotName)
	rig.logEvent(gamelog.KindRaidLeft) // the raid is active, so this really ends it

	if !rig.captured(positionShotName) {
		t.Error("the shot taken in the raid should be captured")
	}
	if !rig.fileExists(positionShotName) {
		t.Error("raid end must not delete a captured shot")
	}
}

func TestAPositionShotWithoutAScanIsAGPSShotAndIsDeletedAtRaidEnd(t *testing.T) {
	rig := newScreenshotRig(t)
	rig.logEvent(gamelog.KindRaidStart)

	rig.takeShot(positionShotName)
	rig.logEvent(gamelog.KindRaidLeft)

	if rig.captured(positionShotName) {
		t.Error("nothing is captured while no scan runs")
	}
	if rig.fileExists(positionShotName) {
		t.Error("the raid's GPS shot should be deleted at raid end")
	}
}

func TestAMenuStyleShotIsCapturedAsBefore(t *testing.T) {
	rig := newScreenshotRig(t)
	rig.startCapture()

	rig.takeShot(menuShotName)

	if !rig.captured(menuShotName) {
		t.Error("the menu-style shot should be in the capture list")
	}
	if position, _ := rig.app.position.Current(); position != nil {
		t.Error("a shot without a position must not move the marker")
	}
}
