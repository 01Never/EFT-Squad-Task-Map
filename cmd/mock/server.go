// The mock's HTTP side: one handler that checks paths in the same order as v2's
// tests/mock-server.ts, plus the test controls (/log, /set-rows, /fail), the json.tarkov.dev
// files and the wiki. The fake OpenAI API is in openai.go.

package main

import (
	"crypto/ed25519"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
)

// v2's mock answered with Bun's Response.json() and new Response(text); these are the content
// types Bun sets for those.
const (
	jsonContentType = "application/json;charset=utf-8"
	textContentType = "text/plain;charset=utf-8"
)

// json.tarkov.dev serves each game mode's files at /<mode>/<name>, e.g. /pve/tasks_en.
var gameDataPathPattern = regexp.MustCompile(`^/(regular|pve|pvp-season)/(\w+)$`)

// The page text every wiki request gets: one objective and a short guide.
const fakeWikiText = "==Objectives==\n*Do the thing\n==Guide==\nIt's upstairs."

// What the fake vision model "reads" from a screenshot until a test replaces it with
// POST /set-rows. Kept exactly as v2's mock had them: the misspelled "Seizing the Initative"
// and the made-up "Some Story Chapter" exercise the page's name matching.
const defaultVisionRowsJSON = `[
	{"name": "Ballet Lover", "trader": null, "progress": 0},
	{"name": "A Fuel Matter", "trader": null, "progress": 0},
	{"name": "Anesthesia", "trader": null, "progress": 33},
	{"name": "Dandies", "trader": null, "progress": 0},
	{"name": "The Good Times - Part 1", "trader": null, "progress": 40},
	{"name": "Seizing the Initative", "trader": null, "progress": 0},
	{"name": "Booze", "trader": null, "progress": 10},
	{"name": "Some Story Chapter", "trader": null, "progress": null}
]`

// mockServer holds what the tests can change and read back. Go serves requests in parallel
// (Bun didn't), so the mutex guards the three fields below it.
type mockServer struct {
	documents map[string][]byte // json.tarkov.dev files by URL name ("tasks_en"); read-only

	mutex      sync.Mutex
	requestLog []string    // one line per json.tarkov.dev, wiki and /v1/responses request
	visionRows jsValue     // what the fake vision model answers; POST /set-rows replaces it
	isFailing  bool        // set by POST /fail: json.tarkov.dev answers 503 while true
	github     githubState // what the fake GitHub Releases serves (github.go); POST /github-set changes it

	signingKey ed25519.PrivateKey // the test key manifests are signed with; read-only after start-up
}

func newMockServer(documents map[string][]byte) (*mockServer, error) {
	visionRows, err := parseJavaScriptJSON([]byte(defaultVisionRowsJSON))
	if err != nil {
		return nil, fmt.Errorf("default vision rows: %w", err)
	}
	return &mockServer{documents: documents, visionRows: visionRows, github: defaultGitHubState()}, nil
}

// ServeHTTP checks the paths in v2's order. Like v2 it ignores the HTTP method, and it matches
// the path as sent (still percent-encoded), as v2's URL.pathname did.
func (mock *mockServer) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	path := request.URL.EscapedPath()
	switch {
	case path == "/log":
		mock.handleLog(writer)
	case path == "/set-rows":
		mock.handleSetRows(writer, request)
	case path == "/fail":
		mock.handleFail(writer, request)
	case path == githubControlPath:
		mock.handleGitHubSet(writer, request)
	case strings.HasPrefix(path, githubPrefix), strings.HasPrefix(path, downloadHostPrefix):
		mock.handleGitHub(writer, request, path)
	case gameDataPathPattern.MatchString(path):
		mock.handleGameDataFile(writer, path)
	case path == "/wiki":
		mock.handleWiki(writer, request)
	case strings.HasPrefix(path, "/v1/"):
		mock.handleOpenAI(writer, request, path)
	default:
		writeText(writer, http.StatusNotFound, "nf")
	}
}

// handleLog answers GET /log with every request line so far, oldest first.
func (mock *mockServer) handleLog(writer http.ResponseWriter) {
	mock.mutex.Lock()
	lines := make([]jsValue, len(mock.requestLog))
	for i, line := range mock.requestLog {
		lines[i] = jsStringValue(line)
	}
	mock.mutex.Unlock()
	writeJSON(writer, http.StatusOK, jsArrayValue(lines...))
}

// handleSetRows answers POST /set-rows: the JSON body becomes what the vision model reads.
func (mock *mockServer) handleSetRows(writer http.ResponseWriter, request *http.Request) {
	rows, err := readJSONBody(request)
	if err != nil {
		writeServerError(writer, err)
		return
	}
	mock.mutex.Lock()
	mock.visionRows = rows
	mock.mutex.Unlock()
	writeOK(writer)
}

// handleFail answers POST /fail {"fail": true|false}: a json.tarkov.dev outage on or off.
// "fail" is read with JavaScript truthiness, as v2 did.
func (mock *mockServer) handleFail(writer http.ResponseWriter, request *http.Request) {
	body, err := readJSONBody(request)
	if err != nil {
		writeServerError(writer, err)
		return
	}
	if body.kind == jsNull {
		writeServerError(writer, fmt.Errorf("the /fail body is null"))
		return
	}
	mock.mutex.Lock()
	mock.isFailing = body.get("fail").isTruthy()
	mock.mutex.Unlock()
	writeOK(writer)
}

// handleGameDataFile serves a json.tarkov.dev file, or 503 "down" during a simulated outage.
// The request is logged either way, so tests can see the app tried.
func (mock *mockServer) handleGameDataFile(writer http.ResponseWriter, path string) {
	mock.mutex.Lock()
	mock.requestLog = append(mock.requestLog, "json "+path)
	isFailing := mock.isFailing
	mock.mutex.Unlock()

	if isFailing {
		writeText(writer, http.StatusServiceUnavailable, "down")
		return
	}
	name := gameDataPathPattern.FindStringSubmatch(path)[2]
	document, isKnown := mock.documents[name]
	if !isKnown {
		writeText(writer, http.StatusNotFound, "nf")
		return
	}
	writer.Header().Set("Content-Type", jsonContentType)
	writer.WriteHeader(http.StatusOK)
	writer.Write(document)
}

// handleWiki answers like the MediaWiki parse API: GET /wiki?page=<title> gets the same short
// page for every title. Without ?page= the title is null and the log says "wiki null", as in v2.
func (mock *mockServer) handleWiki(writer http.ResponseWriter, request *http.Request) {
	title := jsNullValue()
	pageValues := request.URL.Query()["page"]
	if len(pageValues) > 0 {
		title = jsStringValue(pageValues[0])
	}

	mock.addToLog("wiki " + title.toJavaScriptString())
	answer := jsObjectValue(field("parse", jsObjectValue(
		field("title", title),
		field("wikitext", jsStringValue(fakeWikiText)),
	)))
	writeJSON(writer, http.StatusOK, answer)
}

func (mock *mockServer) addToLog(line string) {
	mock.mutex.Lock()
	mock.requestLog = append(mock.requestLog, line)
	mock.mutex.Unlock()
}

// readJSONBody reads the request body like Bun's request.json(): JSON.parse of the whole body.
func readJSONBody(request *http.Request) (jsValue, error) {
	body, err := io.ReadAll(request.Body)
	if err != nil {
		return jsValue{}, fmt.Errorf("reading the request body: %w", err)
	}
	return parseJavaScriptJSON(body)
}

func writeJSON(writer http.ResponseWriter, status int, value jsValue) {
	writer.Header().Set("Content-Type", jsonContentType)
	writer.WriteHeader(status)
	io.WriteString(writer, value.stringify())
}

func writeText(writer http.ResponseWriter, status int, text string) {
	writer.Header().Set("Content-Type", textContentType)
	writer.WriteHeader(status)
	io.WriteString(writer, text)
}

func writeOK(writer http.ResponseWriter) {
	writeJSON(writer, http.StatusOK, jsObjectValue(field("ok", jsBooleanValue(true))))
}

// writeServerError answers a request that would have thrown in v2's mock. Bun answered those
// with a 500 and its HTML error page; this sends a 500 with the error as plain text.
func writeServerError(writer http.ResponseWriter, err error) {
	writeText(writer, http.StatusInternalServerError, err.Error())
}
