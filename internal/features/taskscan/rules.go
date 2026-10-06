// The task scan's rules, as plain functions: which screenshots belong to a scan, how the model's
// rows are cleaned, which images are accepted. taskscan.go keeps the state and does the I/O.

package taskscan

import (
	"regexp"
	"strings"
	"time"
)

// A screenshot counts for the scan if the game wrote it after "Scan tasks" was clicked (with this
// much slack for the PC clock vs the file time).
const captureClockSlack = 2 * time.Second

var imageDataURL = regexp.MustCompile(`^data:image/(jpeg|png|webp);base64,`)

// maxImageDataURLLength refuses absurd uploads (the page sends ≤2048 px JPEGs, well under this).
const maxImageDataURLLength = 25_000_000

// cleanRows keeps rows with a name, trims and limits the text, and keeps progress within 0–100.
func cleanRows(raw []map[string]any) []Row {
	rows := []Row{}
	for _, row := range raw {
		name, _ := row["name"].(string)
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		cleaned := Row{Name: limitRunes(name, 120)}
		if trader, ok := row["trader"].(string); ok && trader != "" {
			limited := limitRunes(trader, 40)
			cleaned.Trader = &limited
		}
		if progress, ok := row["progress"].(float64); ok && progress == float64(int(progress)) {
			value := int(progress)
			value = max(0, min(100, value))
			cleaned.Progress = &value
		}
		rows = append(rows, cleaned)
	}
	return rows
}

func limitRunes(text string, limit int) string {
	runes := []rune(text)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return text
}

// IsTakenDuringCapture: a screenshot belongs to the scan if the game wrote it after "Scan tasks"
// was clicked (minus captureClockSlack for the file time vs the PC clock).
func IsTakenDuringCapture(written, captureStarted time.Time) bool {
	return !written.Before(captureStarted.Add(-captureClockSlack))
}

// imageContentType is the content type for a screenshot file name (Tarkov writes PNG, JPEG or BMP).
func imageContentType(name string) string {
	lower := strings.ToLower(name)
	switch {
	case strings.HasSuffix(lower, ".png"):
		return "image/png"
	case strings.HasSuffix(lower, ".bmp"):
		return "image/bmp"
	default:
		return "image/jpeg"
	}
}
