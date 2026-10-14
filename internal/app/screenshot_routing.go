// Where a screenshot goes. This file only decides; app.onScreenshot does the work.
package app

// screenshotRoute says which features get a screenshot.
type screenshotRoute int

const (
	// routeToScan: only the task scan (a menu-style name, or a file that was removed).
	routeToScan screenshotRoute = iota

	// routeToGPS: a position-named shot with no scan running. It moves the marker, counts as one of
	// the raid's GPS shots (deleted at raid end) and may feed the extracts reader.
	routeToGPS

	// routeToScanAndPosition: a position-named shot while "Scan tasks" is capturing. The scan owns
	// the file (only Confirm deletes it); it also moves the marker, but is not a raid GPS shot.
	routeToScanAndPosition
)

// routeScreenshot decides where one settled screenshot goes.
//
// Owner decision (ticket 21): while a scan is capturing, every new picture belongs to the scan,
// even when the game put a position in its name. In a raid you can open the task screen, and the
// game can also think it's still in a raid in the menus. Treating those shots as GPS shots would
// delete them at raid end and make the next profile line look like a raid end.
func routeScreenshot(exists, hasPosition, isScanCapturing bool) screenshotRoute {
	if !exists {
		return routeToScan // the scan forgets removed files; nothing else cares
	}
	if isScanCapturing && hasPosition {
		return routeToScanAndPosition
	}
	if hasPosition {
		return routeToGPS
	}
	return routeToScan
}
