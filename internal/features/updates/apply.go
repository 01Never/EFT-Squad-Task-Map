// Installing a downloaded update: back up the saved data, swap the exe, start the new copy, and
// exit. If a step fails, everything done so far is undone and the old copy keeps running.
package updates

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Apply installs the verified download and restarts into it. In order:
//  1. check again that the download is still exactly what the manifest says (size, SHA-256);
//  2. copy squad-task-map-data.json to squad-task-map-data.before-<version>.json;
//  3. write the release notes where the new copy will find them;
//  4. swap the exes (SwapInNewExe) and start the new one with --updated-from=<this version>;
//  5. ask the app to exit, so the new copy can take the port.
//
// If step 4's start fails, the swap is undone. The saved data is never modified.
// On success the caller's response should be sent before the app exits (Exit only signals).
func (updater *Updater) Apply() (Status, error) {
	manifest, paths, err := updater.beginApply()
	if err != nil {
		return updater.Status(), err
	}
	if err := updater.installAndStart(manifest, paths); err != nil {
		return updater.failApply(err)
	}
	updater.mutex.Lock()
	updater.announceLocked()
	status := updater.statusLocked()
	updater.mutex.Unlock()
	if updater.config.Exit != nil {
		updater.config.Exit()
	}
	return status, nil
}

// beginApply moves to "applying" (so nothing else can start) when a verified download exists.
func (updater *Updater) beginApply() (Manifest, ExePaths, error) {
	updater.mutex.Lock()
	defer updater.mutex.Unlock()
	if updater.phase != PhaseReady || updater.manifest == nil {
		if updater.phase == PhaseIdle || updater.phase == PhaseReady {
			return Manifest{}, ExePaths{}, errNothingToApply()
		}
		return Manifest{}, ExePaths{}, errBusy()
	}
	if updater.config.ExePath == "" {
		return Manifest{}, ExePaths{}, errDevBuild()
	}
	updater.phase = PhaseApplying
	updater.lastError = nil
	updater.announceLocked()
	return *updater.manifest, PathsBeside(updater.config.ExePath), nil
}

func (updater *Updater) installAndStart(manifest Manifest, paths ExePaths) error {
	if err := VerifyFile(paths.Download, manifest.File); err != nil {
		_ = updater.config.Files.Remove(paths.Download) // not what was verified: never keep it
		return err
	}
	if err := updater.config.Files.CheckWritable(filepath.Dir(paths.Current)); err != nil {
		return errFolderNotWritable(ReleasePageURL(updater.config.Source.Base, manifest.Version))
	}
	if updater.config.BackupData != nil {
		if err := updater.config.BackupData(manifest.Version); err != nil {
			return errApplyFailed("Couldn't back up your saved data first (" + err.Error() + "). Nothing was changed.")
		}
	}
	updater.writeNotice(manifest)

	if err := SwapInNewExe(updater.config.Files, paths); err != nil {
		return err
	}
	arguments := []string{"--updated-from=" + updater.config.CurrentVersion}
	if err := updater.config.StartNewCopy(paths.Current, arguments); err != nil {
		if undoErr := UndoSwap(updater.config.Files, paths); undoErr != nil {
			return undoErr
		}
		return errApplyFailed("The new version couldn't be started (" + err.Error() + "). The old version is still in place.")
	}
	FinishSwap(updater.config.Files, paths)
	return nil
}

// writeNotice leaves the release notes for the new copy ("Updated to X" with what's new).
// Best effort: without the file the new copy just shows no notes.
func (updater *Updater) writeNotice(manifest Manifest) {
	if updater.config.NoticePath == "" {
		return
	}
	notice := Notice{
		From:     updater.config.CurrentVersion,
		To:       manifest.Version,
		Released: manifest.Released,
		Notes:    manifest.Notes,
	}
	data, err := json.Marshal(notice)
	if err != nil {
		return
	}
	_ = os.WriteFile(updater.config.NoticePath, data, 0o644)
}

// failApply returns to "ready" when the verified download is still there (the page can retry),
// else to idle, and keeps the error for the page.
func (updater *Updater) failApply(err error) (Status, error) {
	updater.mutex.Lock()
	defer updater.mutex.Unlock()
	if updater.config.NoticePath != "" {
		_ = os.Remove(updater.config.NoticePath) // nothing was installed, so nothing to announce
	}
	updater.lastError = asError(err)
	updater.phase = PhaseIdle
	updater.progress = nil
	paths := PathsBeside(updater.config.ExePath)
	if updater.config.Files.Exists(paths.Download) {
		updater.phase = PhaseReady
		updater.progress = &Progress{BytesDone: updater.manifest.File.Size, BytesTotal: updater.manifest.File.Size}
	}
	updater.announceLocked()
	return updater.statusLocked(), err
}
