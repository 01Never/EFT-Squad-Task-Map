package httpapi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

var fontBytes = []byte("wOF2 pretend font")

// builtInFiles is a small stand-in for the files built into the exe.
func builtInFiles() fstest.MapFS {
	fonts, _ := json.Marshal(map[string]string{
		"Bender.woff2": base64.StdEncoding.EncodeToString(fontBytes),
		"Broken.woff2": "this isn't base64!",
	})
	return fstest.MapFS{
		"web/index.html":              {Data: []byte("<!doctype html><title>Squad Task Map</title>")},
		"web/js/app.js":               {Data: []byte("export const app = 1;")},
		"web/js/logic/rules.js":       {Data: []byte("export const rules = 1;")},
		"web/js/logic/rules.test.js":  {Data: []byte("test('x')")},
		"web/js/app/event-names.json": {Data: []byte("{}")},
		"web/js/features/x/README.md": {Data: []byte("# x")},
		"web/js/features/x/x.css":     {Data: []byte(".x{color:red}")},
		"web/css/base.css":            {Data: []byte(":root{--player:#ff3fd2}")},
		"web/css/notes.txt":           {Data: []byte("notes")},
		"assets/Customs.svg":          {Data: []byte("<svg/>")},
		"assets/Customs.png":          {Data: []byte("png")},
		"assets/maps-config.json":     {Data: []byte(`[{"key":"customs"}]`)},
		"assets/fonts.json":           {Data: fonts},
	}
}

func newTestServer(t *testing.T, backend Backend, isDev bool) *Server {
	t.Helper()
	static, err := NewStatic(builtInFiles(), "2.4.0", isDev)
	if err != nil {
		t.Fatal(err)
	}
	return NewServer(backend, static)
}

func get(server http.Handler, path string, header map[string]string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, path, nil)
	for name, value := range header {
		request.Header.Set(name, value)
	}
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	return recorder
}

func TestThePageAndItsFilesAreServedWithExplicitContentTypes(t *testing.T) {
	server := newTestServer(t, nil, false)
	cases := []struct {
		name            string
		path            string
		wantContentType string
		wantBody        string
		wantCache       string
	}{
		{"the page", "/", "text/html; charset=utf-8", "<!doctype html><title>Squad Task Map</title>", "no-cache"},
		{"the page by name", "/index.html", "text/html; charset=utf-8", "<!doctype html><title>Squad Task Map</title>", "no-cache"},
		{"a script", "/js/app.js", "text/javascript; charset=utf-8", "export const app = 1;", "no-cache"},
		{"a script in a subfolder", "/js/logic/rules.js", "text/javascript; charset=utf-8", "export const rules = 1;", "no-cache"},
		{"a feature's stylesheet next to its scripts", "/js/features/x/x.css", "text/css; charset=utf-8", ".x{color:red}", "no-cache"},
		{"a shared stylesheet", "/css/base.css", "text/css; charset=utf-8", ":root{--player:#ff3fd2}", "no-cache"},
		{"map art (cached for an hour)", "/maps/Customs.svg", "image/svg+xml", "<svg/>", "max-age=3600"},
		{"the maps config", "/api/config", "application/json", `[{"key":"customs"}]`, "no-cache"},
		{"a font from fonts.json (cached for a day)", "/fonts/Bender.woff2", "font/woff2", string(fontBytes), "max-age=86400"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			response := get(server, testCase.path, nil)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", response.Code)
			}
			if got := response.Header().Get("Content-Type"); got != testCase.wantContentType {
				t.Errorf("content type = %q, want %q", got, testCase.wantContentType)
			}
			if got := response.Body.String(); got != testCase.wantBody {
				t.Errorf("body = %q, want %q", got, testCase.wantBody)
			}
			if got := response.Header().Get("Cache-Control"); got != testCase.wantCache {
				t.Errorf("cache control = %q, want %q", got, testCase.wantCache)
			}
		})
	}
}

func TestOnlyTheRoutedFilesAreServed(t *testing.T) {
	server := newTestServer(t, nil, false)
	cases := []struct{ name, method, path string }{
		{"a test file under /js/", http.MethodGet, "/js/logic/rules.test.js"},
		{"a non-script under /js/", http.MethodGet, "/js/app/event-names.json"},
		{"a script that doesn't exist", http.MethodGet, "/js/missing.js"},
		{"a README under /js/", http.MethodGet, "/js/features/x/README.md"},
		{"a stylesheet that doesn't exist", http.MethodGet, "/css/missing.css"},
		{"a non-stylesheet under /css/", http.MethodGet, "/css/notes.txt"},
		{"a script under /css/", http.MethodGet, "/css/app.js"},
		{"map art that isn't an svg", http.MethodGet, "/maps/Customs.png"},
		{"map art that doesn't exist", http.MethodGet, "/maps/Atlantis.svg"},
		{"a font that isn't in fonts.json", http.MethodGet, "/fonts/Missing.woff2"},
		{"a font whose base64 was broken", http.MethodGet, "/fonts/Broken.woff2"},
		{"the built-in files by their own path", http.MethodGet, "/web/index.html"},
		{"the fonts file itself", http.MethodGet, "/assets/fonts.json"},
		{"an unknown path", http.MethodGet, "/nope"},
		{"an unknown API", http.MethodGet, "/api/nope"},
		{"a known path with the wrong method, as v2 answered it", http.MethodPost, "/index.html"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			server.ServeHTTP(recorder, httptest.NewRequest(testCase.method, testCase.path, nil))
			if recorder.Code != http.StatusNotFound || strings.TrimSpace(recorder.Body.String()) != "Not found" {
				t.Errorf("got %d %q, want 404 Not found", recorder.Code, recorder.Body.String())
			}
		})
	}
}

// The route table cleans "/css/../x" before it reaches a handler, so these call the handlers
// directly: their own path check must still refuse anything outside their folder.
func TestTheFileHandlersRefusePathsOutsideTheirFolder(t *testing.T) {
	static, err := NewStatic(builtInFiles(), "2.4.0", false)
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name    string
		handler http.HandlerFunc
		path    string
	}{
		{"a stylesheet path that climbs out of web/css", static.serveStylesheet, "/css/../js/features/x/x.css"},
		{"a stylesheet path that climbs out to the page", static.serveStylesheet, "/css/../../web/css/base.css"},
		{"a script path that climbs out of web/js", static.servePageCode, "/js/../css/base.css"},
		{"an absolute stylesheet path", static.serveStylesheet, "/css//web/css/base.css"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			request.URL.Path = testCase.path
			recorder := httptest.NewRecorder()
			testCase.handler(recorder, request)
			if recorder.Code != http.StatusNotFound {
				t.Errorf("got %d %q, want 404", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestBuiltInFilesAreReCheckedByVersion(t *testing.T) {
	cases := []struct {
		name        string
		isDev       bool
		ifNoneMatch string
		wantStatus  int
		wantETag    string
		wantCache   string
	}{
		{"first load gets the file tagged with the version", false, "", http.StatusOK, `"2.4.0"`, "no-cache"},
		{"the same version is answered with 304", false, `"2.4.0"`, http.StatusNotModified, `"2.4.0"`, "no-cache"},
		{"after an update the new file is sent", false, `"2.3.0"`, http.StatusOK, `"2.4.0"`, "no-cache"},
		{"in development nothing is cached", true, `"2.4.0"`, http.StatusOK, "", "no-cache, no-store"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			server := newTestServer(t, nil, testCase.isDev)
			header := map[string]string{}
			if testCase.ifNoneMatch != "" {
				header["If-None-Match"] = testCase.ifNoneMatch
			}
			response := get(server, "/js/app.js", header)
			if response.Code != testCase.wantStatus {
				t.Errorf("status = %d, want %d", response.Code, testCase.wantStatus)
			}
			if got := response.Header().Get("ETag"); got != testCase.wantETag {
				t.Errorf("ETag = %q, want %q", got, testCase.wantETag)
			}
			if got := response.Header().Get("Cache-Control"); got != testCase.wantCache {
				t.Errorf("cache control = %q, want %q", got, testCase.wantCache)
			}
			if wantBody := testCase.wantStatus == http.StatusOK; (response.Body.Len() > 0) != wantBody {
				t.Errorf("body = %q", response.Body.String())
			}
		})
	}
}

func TestTheStaticFilesNeedTheFontsFile(t *testing.T) {
	files := builtInFiles()
	delete(files, "assets/fonts.json")
	if _, err := NewStatic(files, "2.4.0", false); err == nil {
		t.Error("NewStatic should fail without assets/fonts.json")
	}
}

// ---------------------------------------------------------------- a few API routes

// fakeBackend implements the routes these tests use; any other route would panic on the nil Backend.
type fakeBackend struct {
	Backend
	state        string
	written      []string
	acknowledged []float64
}

func (backend *fakeBackend) ReadState() string { return backend.state }

func (backend *fakeBackend) WriteState(text []byte) error {
	if !json.Valid(text) {
		return errors.New("the saved data isn't valid JSON")
	}
	backend.written = append(backend.written, string(text))
	return nil
}

func (backend *fakeBackend) AcknowledgeEvents(upToID float64) {
	backend.acknowledged = append(backend.acknowledged, upToID)
}

func send(server http.Handler, method, path string, body []byte) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json") // as the page sends it
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	return recorder
}

func TestTheSavedDataIsReadAndWrittenAsJSONText(t *testing.T) {
	cases := []struct {
		name        string
		body        []byte
		wantStatus  int
		wantAnswer  string
		wantWritten int
	}{
		{"JSON is saved", []byte(`{"version":2}`), http.StatusOK, `{"ok":true}`, 1},
		{"anything else is refused", []byte(`{"version":`), http.StatusBadRequest, `{"error":"the saved data isn't valid JSON","ok":false}`, 0},
		{"a body over 32 MB is refused", append(append([]byte(`"`), bytes.Repeat([]byte("x"), maxRequestBody)...), '"'), http.StatusBadRequest, "", 0},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			backend := &fakeBackend{}
			server := newTestServer(t, backend, false)
			response := send(server, http.MethodPut, "/api/state", testCase.body)
			if response.Code != testCase.wantStatus {
				t.Errorf("status = %d, want %d", response.Code, testCase.wantStatus)
			}
			if testCase.wantAnswer != "" && response.Body.String() != testCase.wantAnswer {
				t.Errorf("answer = %s, want %s", response.Body.String(), testCase.wantAnswer)
			}
			if len(backend.written) != testCase.wantWritten {
				t.Errorf("saved %d times, want %d", len(backend.written), testCase.wantWritten)
			}
		})
	}

	backend := &fakeBackend{state: "null"}
	response := get(newTestServer(t, backend, false), "/api/state", nil)
	if response.Body.String() != "null" || response.Header().Get("Content-Type") != "application/json" {
		t.Errorf("GET /api/state = %q (%s), want null as JSON", response.Body.String(), response.Header().Get("Content-Type"))
	}
}

func TestAnAcknowledgementNeedsANumericId(t *testing.T) {
	cases := []struct {
		name string
		body string
		want []float64
	}{
		{"a number", `{"upTo":7}`, []float64{7}},
		{"text isn't an id", `{"upTo":"7"}`, nil},
		{"no id", `{}`, nil},
		{"not JSON", `nope`, nil},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			backend := &fakeBackend{}
			response := send(newTestServer(t, backend, false), http.MethodPost, "/api/events/ack", []byte(testCase.body))
			if response.Code != http.StatusOK || response.Body.String() != `{"ok":true}` {
				t.Errorf("answer = %d %s, want 200 {\"ok\":true}", response.Code, response.Body.String())
			}
			if len(backend.acknowledged) != len(testCase.want) || (len(testCase.want) == 1 && backend.acknowledged[0] != testCase.want[0]) {
				t.Errorf("acknowledged %v, want %v", backend.acknowledged, testCase.want)
			}
		})
	}
}
