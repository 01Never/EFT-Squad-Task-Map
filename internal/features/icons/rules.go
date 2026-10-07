// Package icons keeps item pictures for the page: the first request for an item downloads
// <id>-icon.webp from assets.tarkov.dev into squad-task-map-icons/, every later one is served from
// that folder. Task markers, the Bring list and (ticket 09) keys all use it through /icons/<id>.webp.
// This file holds the rules; cache.go does the downloading and the files.
package icons

import (
	"regexp"
	"time"
)

// DefaultAssetsBase is where icons come from. STM_ASSETS_BASE points tests at the mock instead.
const DefaultAssetsBase = "https://assets.tarkov.dev"

// MaxIconBytes is the biggest icon accepted (real ones are 1–10 KB). Anything bigger is refused
// rather than stored.
const MaxIconBytes = 256 << 10

// RetryFailedAfter is how long a failed download is remembered. Nothing is retried before that,
// so a missing icon (or no network) costs one request, not one per marker per redraw.
const RetryFailedAfter = 10 * time.Minute

var itemIDPattern = regexp.MustCompile(`^[0-9a-f]{24}$`)

// iconFilePattern is the file part of a request path: an item id and ".webp".
var iconFilePattern = regexp.MustCompile(`^([0-9a-f]{24})\.webp$`)

// IsItemID reports whether text is an item id: exactly 24 lower-case hex digits. Nothing else is
// ever put into a URL or a file name.
func IsItemID(text string) bool { return itemIDPattern.MatchString(text) }

// ItemIDFromFileName reads the id out of "<id>.webp" (the last part of /icons/<id>.webp).
func ItemIDFromFileName(fileName string) (string, bool) {
	match := iconFilePattern.FindStringSubmatch(fileName)
	if match == nil {
		return "", false
	}
	return match[1], true
}

// IconURL is where an item's icon is downloaded from.
func IconURL(assetsBase, itemID string) string {
	return assetsBase + "/" + itemID + "-icon.webp"
}

// IsWebP reports whether data starts like a WebP file ("RIFF", 4 size bytes, "WEBP"), so a
// redirect page or an error body is never stored as an icon.
func IsWebP(data []byte) bool {
	return len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP"
}

// MayTryAgain says whether a download that failed at failedAt may be tried again at now.
func MayTryAgain(failedAt, now time.Time) bool {
	return now.Sub(failedAt) >= RetryFailedAfter
}
