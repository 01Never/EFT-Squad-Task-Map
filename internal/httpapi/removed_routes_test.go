package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTheRemovedAICategorizeRoutesAreNotFound(t *testing.T) {
	cases := []struct {
		method string
		path   string
	}{
		{"POST", "/api/ai/categorize"},
		{"GET", "/api/ai/job/abc123"},
	}
	for _, testCase := range cases {
		t.Run(testCase.method+" "+testCase.path, func(t *testing.T) {
			server := newTestServer(t, &fakeBackend{}, false)
			request := httptest.NewRequest(testCase.method, testCase.path, strings.NewReader("{}"))
			recorder := httptest.NewRecorder()
			server.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusNotFound && recorder.Code != http.StatusMethodNotAllowed {
				t.Errorf("status %d, want 404", recorder.Code)
			}
		})
	}
}
