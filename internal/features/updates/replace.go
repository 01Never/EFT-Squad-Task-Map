// Replacing the running exe with the downloaded one, and putting the old one back if anything
// goes wrong. A running exe can't be overwritten on Windows, but it can be renamed, so the swap
// is two renames. The file operations sit behind a small interface so the steps and their
// rollback are tested on any OS.
package updates

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// FileOps is every file operation the swap needs.
type FileOps interface {
	// Rename moves a file (on Windows, a running exe may be renamed).
	Rename(oldPath, newPath string) error
	// Remove deletes a file; a file that isn't there is not an error.
	Remove(path string) error
	// Exists reports whether a regular file is there.
	Exists(path string) bool
	// CheckWritable returns an error unless a file can be created in the folder.
	CheckWritable(folder string) error
}

// ExePaths are the three files involved, all in the exe's folder.
type ExePaths struct {
	Current  string // SquadTaskMap.exe: the running exe, and then the new one
	Download string // SquadTaskMap.download.exe: the verified download
	Previous string // SquadTaskMap.previous.exe: the old exe, kept for a manual way back
	// PreviousOld is the earlier "previous", set aside during an update and deleted once the
	// new copy has started, so a failed update never loses it.
	PreviousOld string
}

// PathsBeside returns the paths for an exe: the download and the previous copy sit next to it.
func PathsBeside(currentExe string) ExePaths {
	folder := filepath.Dir(currentExe)
	return ExePaths{
		Current:     currentExe,
		Download:    filepath.Join(folder, "SquadTaskMap.download.exe"),
		Previous:    filepath.Join(folder, "SquadTaskMap.previous.exe"),
		PreviousOld: filepath.Join(folder, "SquadTaskMap.previous.old.exe"),
	}
}

// SwapInNewExe makes the downloaded file the exe, keeping the old one as "previous":
//  1. set an older "previous" aside as "previous.old" (kept until the new copy has started);
//  2. rename the current exe to "previous";
//  3. rename the download to the current exe's name.
//
// If step 3 fails, steps 2 and 1 are undone, so everything is as it was. The caller then starts
// the new exe and calls FinishSwap (or UndoSwap if the start fails).
func SwapInNewExe(ops FileOps, paths ExePaths) error {
	if !ops.Exists(paths.Download) {
		return errNothingToApply()
	}

	// Step 1: the older "previous" is moved aside, not deleted: if this update fails later,
	// it is the only way back to an even older version.
	if err := setOlderPreviousAside(ops, paths); err != nil {
		return errApplyFailed(fmt.Sprintf("Couldn't set the old backup copy aside (%v). Nothing was changed.", err))
	}

	// Step 2: the running exe is renamed, not overwritten. The process keeps running from it.
	if err := ops.Rename(paths.Current, paths.Previous); err != nil {
		restoreOlderPrevious(ops, paths)
		return errApplyFailed(fmt.Sprintf("Couldn't set the current exe aside (%v). Nothing was changed.", err))
	}

	// Step 3: the new exe takes the current name.
	if err := ops.Rename(paths.Download, paths.Current); err != nil {
		// Roll back step 2: the old exe goes back under its own name.
		if undoErr := ops.Rename(paths.Previous, paths.Current); undoErr != nil {
			return errApplyFailed(fmt.Sprintf(
				"The update failed halfway and the old exe couldn't be put back. "+
					"Rename %q to %q by hand. (%v; %v)",
				paths.Previous, paths.Current, err, undoErr))
		}
		restoreOlderPrevious(ops, paths)
		return errApplyFailed(fmt.Sprintf("Couldn't put the new exe in place (%v). The old version is still in place.", err))
	}
	return nil
}

// setOlderPreviousAside moves an existing "previous" to "previous.old" (nothing to do without one).
func setOlderPreviousAside(ops FileOps, paths ExePaths) error {
	if !ops.Exists(paths.Previous) {
		return nil
	}
	if err := ops.Remove(paths.PreviousOld); err != nil { // a leftover from an earlier crash
		return err
	}
	return ops.Rename(paths.Previous, paths.PreviousOld)
}

// restoreOlderPrevious puts "previous.old" back as "previous" (best effort; nothing to do
// when there was no older one).
func restoreOlderPrevious(ops FileOps, paths ExePaths) {
	if ops.Exists(paths.PreviousOld) {
		_ = ops.Rename(paths.PreviousOld, paths.Previous)
	}
}

// FinishSwap is called once the new copy has started: the older "previous" is no longer needed.
func FinishSwap(ops FileOps, paths ExePaths) {
	_ = ops.Remove(paths.PreviousOld)
}

// UndoSwap reverses SwapInNewExe after the new exe failed to start: the new exe goes back to its
// download name (or is deleted if that fails), the previous exe takes its name again, and the
// older previous copy (if any) comes back too.
func UndoSwap(ops FileOps, paths ExePaths) error {
	if err := ops.Rename(paths.Current, paths.Download); err != nil {
		if removeErr := ops.Remove(paths.Current); removeErr != nil {
			return errApplyFailed(fmt.Sprintf(
				"The new version didn't start, and the old exe couldn't be put back. "+
					"Delete %q and rename %q to %q by hand.",
				paths.Current, paths.Previous, paths.Current))
		}
	}
	if err := ops.Rename(paths.Previous, paths.Current); err != nil {
		return errApplyFailed(fmt.Sprintf(
			"The new version didn't start, and the old exe couldn't be put back. "+
				"Rename %q to %q by hand. (%v)", paths.Previous, paths.Current, err))
	}
	restoreOlderPrevious(ops, paths)
	return nil
}

// osFileOps is FileOps on the real file system.
type osFileOps struct{}

// OSFileOps returns the real file operations.
func OSFileOps() FileOps { return osFileOps{} }

func (osFileOps) Rename(oldPath, newPath string) error { return os.Rename(oldPath, newPath) }

func (osFileOps) Remove(path string) error {
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (osFileOps) Exists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

// CheckWritable creates and deletes a small probe file, which is what "can I write here" means
// for the renames that follow.
func (osFileOps) CheckWritable(folder string) error {
	probe, err := os.CreateTemp(folder, "SquadTaskMap.write-test-*")
	if err != nil {
		return err
	}
	name := probe.Name()
	probe.Close()
	return os.Remove(name)
}
