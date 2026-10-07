// The fake assets.tarkov.dev (ticket 07): item icons for the icon cache. Point the app at it with
// STM_ASSETS_BASE=http://127.0.0.1:7820/assets.

package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
)

const (
	assetsPrefix     = "/assets/"
	iconsLogPath     = "/icons-log"
	iconsMissingPath = "/icons-missing"
)

// /assets/<24 hex>-icon.webp
var iconPathPattern = regexp.MustCompile(`^/assets/([0-9a-f]{24})-icon\.webp$`)

// mockIcon is a small valid 64x64 WebP (a box on a dark ground), so browsers decode it like a real icon
// and screenshots show something.
var mockIcon, _ = base64.StdEncoding.DecodeString("UklGRqgAAABXRUJQVlA4TJwAAAAvP8APACdAmG0kMJF9R3P+IqdBIGnTarnGCj7aCbONFPYcws4f8OY//neDWIqAUSRJio4MLAjYOAWkgPyLou6e4/tF9J+R27aR1HZ4mn3mE/WPGBkcSano4SiVGlyfJAmSDEGKIIcqQFUgShA1oEYyeaTjmsVR3TLnBlvROScFXVDCOqeE3HD/zLvZn7v5vR353h/gu7zAf/WDRw0=")

// iconState is what the icon stand-in remembers (guarded by mockServer.mutex).
type iconState struct {
	requested []string        // ids asked for, oldest first
	missing   map[string]bool // ids that answer 404, set by POST /icons-missing
}

// handleIcon answers GET /assets/<id>-icon.webp: a tiny WebP, or 404 for an id marked missing.
// The request is logged in /icons-log (separate from /log, so existing log checks are unchanged).
func (mock *mockServer) handleIcon(writer http.ResponseWriter, path string) {
	match := iconPathPattern.FindStringSubmatch(path)
	if match == nil {
		writeText(writer, http.StatusNotFound, "nf")
		return
	}
	mock.mutex.Lock()
	mock.icons.requested = append(mock.icons.requested, match[1])
	isMissing := mock.icons.missing[match[1]]
	mock.mutex.Unlock()
	if isMissing {
		writeText(writer, http.StatusNotFound, "nf")
		return
	}
	writer.Header().Set("Content-Type", "image/webp")
	writer.Write(mockIcon)
}

// handleIconsLog answers GET /icons-log: the ids requested so far, oldest first.
func (mock *mockServer) handleIconsLog(writer http.ResponseWriter) {
	mock.mutex.Lock()
	requested := append([]string{}, mock.icons.requested...)
	mock.mutex.Unlock()
	body, _ := json.Marshal(requested)
	writer.Header().Set("Content-Type", jsonContentType)
	writer.Write(body)
}

// handleIconsMissing answers POST /icons-missing {"ids": [...]}: those ids answer 404 from now on
// (an empty list makes every icon available again), and the icon log is cleared.
func (mock *mockServer) handleIconsMissing(writer http.ResponseWriter, request *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
		writeText(writer, http.StatusBadRequest, err.Error())
		return
	}
	missing := map[string]bool{}
	for _, id := range body.IDs {
		missing[strings.TrimSpace(id)] = true
	}
	mock.mutex.Lock()
	mock.icons = iconState{missing: missing}
	mock.mutex.Unlock()
	writeOK(writer)
}
