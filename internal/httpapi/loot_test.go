package httpapi

import (
	"net/http"
	"testing"
)

// lootBackend answers /api/loot/<map> for "customs" only, and records what it was asked.
type lootBackend struct {
	fakeBackend
	askedFor []string
}

func (backend *lootBackend) LootJSON(mapKey string) ([]byte, bool) {
	backend.askedFor = append(backend.askedFor, mapKey)
	if mapKey != "customs" {
		return nil, false
	}
	return []byte(`{"map":"customs","available":true}`), true
}

func TestLootIsServedOnlyForMapKeys(t *testing.T) {
	cases := []struct {
		name        string
		path        string
		wantStatus  int
		wantAskedOf bool // the backend was asked at all
	}{
		{"a map the data knows", "/api/loot/customs", http.StatusOK, true},
		{"a well-formed key the data doesn't know", "/api/loot/woods", http.StatusNotFound, true},
		{"upper case isn't a map key", "/api/loot/Customs", http.StatusNotFound, false},
		{"an encoded path isn't a map key", "/api/loot/..%2Fsettings", http.StatusNotFound, false},
		{"a dot isn't a map key", "/api/loot/customs.json", http.StatusNotFound, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			backend := &lootBackend{}
			response := get(newTestServer(t, backend, false), testCase.path, nil)
			if response.Code != testCase.wantStatus {
				t.Errorf("status %d, want %d", response.Code, testCase.wantStatus)
			}
			if wasAsked := len(backend.askedFor) > 0; wasAsked != testCase.wantAskedOf {
				t.Errorf("backend asked for %v", backend.askedFor)
			}
			if response.Code == http.StatusOK && response.Header().Get("Content-Type") != "application/json" {
				t.Errorf("content type %q", response.Header().Get("Content-Type"))
			}
		})
	}
}
