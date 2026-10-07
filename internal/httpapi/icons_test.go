package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"squadtaskmap/internal/features/icons"
)

// iconBackend answers IconPath from one folder and records which ids it was asked for.
type iconBackend struct {
	Backend
	dir   string
	asked []string
}

func (backend *iconBackend) IconPath(_ context.Context, itemID string) (string, error) {
	backend.asked = append(backend.asked, itemID)
	path := filepath.Join(backend.dir, itemID+".webp")
	if _, err := os.Stat(path); err != nil {
		return "", icons.ErrUnavailable
	}
	return path, nil
}

func TestIconsAreServedAsWebpAndMissingOnesAre404(t *testing.T) {
	dir := t.TempDir()
	const have = "5991b51486f77447b112d44f"
	os.WriteFile(filepath.Join(dir, have+".webp"), []byte("RIFF\x00\x00\x00\x00WEBP"), 0o644)
	backend := &iconBackend{dir: dir}
	server := newTestServer(t, backend, false)

	get := func(path string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		server.ServeHTTP(recorder, httptest.NewRequest("GET", path, nil))
		return recorder
	}
	found := get("/icons/" + have + ".webp")
	if found.Code != http.StatusOK || found.Header().Get("Content-Type") != "image/webp" {
		t.Errorf("found icon: %d %q", found.Code, found.Header().Get("Content-Type"))
	}
	missing := get("/icons/6575a6ca8778e96ded05a802.webp")
	if missing.Code != http.StatusNotFound || missing.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("missing icon: %d, cache %q", missing.Code, missing.Header().Get("Cache-Control"))
	}
	for _, path := range []string{"/icons/ABC.webp", "/icons/" + have + ".png", "/icons/" + have} {
		if recorder := get(path); recorder.Code != http.StatusNotFound {
			t.Errorf("%s: %d, want 404", path, recorder.Code)
		}
	}
	if len(backend.asked) != 2 {
		t.Errorf("the backend was asked for %v; only the two well-formed ids should reach it", backend.asked)
	}
}
