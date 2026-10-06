// Tests for the mock's endpoints, driven through ServeHTTP. The side-by-side check against
// v2's Bun mock is described in README.md.

package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

const testTasksDocument = `{"data":{"tasks":{}}}`

var goodKey = map[string]string{"Authorization": "Bearer " + acceptedAPIKey}

func newTestMock(t *testing.T) *mockServer {
	t.Helper()
	mock, err := newMockServer(map[string][]byte{"tasks": []byte(testTasksDocument)})
	if err != nil {
		t.Fatal(err)
	}
	return mock
}

func send(mock *mockServer, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	recorder := httptest.NewRecorder()
	mock.ServeHTTP(recorder, request)
	return recorder
}

// outputText digs the answer text out of a Responses API reply.
func outputText(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	var reply struct {
		Output []struct {
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &reply); err != nil {
		t.Fatalf("reading the reply %s: %v", recorder.Body.String(), err)
	}
	return reply.Output[0].Content[0].Text
}

func TestGameDataFiles(t *testing.T) {
	tests := []struct {
		name       string
		path       string
		wantStatus int
		wantBody   string
	}{
		{"a known file is served unchanged", "/regular/tasks", 200, testTasksDocument},
		{"every game mode gets the same files", "/pve/tasks", 200, testTasksDocument},
		{"pvp-season is a game mode too", "/pvp-season/tasks", 200, testTasksDocument},
		{"an unknown file name is 404 nf", "/regular/quests", 404, "nf"},
		{"an unknown game mode is 404 nf", "/arena/tasks", 404, "nf"},
		{"a deeper path is not a file", "/regular/tasks/x", 404, "nf"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := send(newTestMock(t), "GET", test.path, "", nil)
			if recorder.Code != test.wantStatus || recorder.Body.String() != test.wantBody {
				t.Errorf("GET %s = %d %q, want %d %q", test.path,
					recorder.Code, recorder.Body.String(), test.wantStatus, test.wantBody)
			}
		})
	}
}

func TestFailSimulatesAJsonTarkovDevOutage(t *testing.T) {
	mock := newTestMock(t)
	send(mock, "POST", "/fail", `{"fail":true}`, nil)
	duringOutage := send(mock, "GET", "/regular/tasks", "", nil)
	if duringOutage.Code != 503 || duringOutage.Body.String() != "down" {
		t.Errorf("during the outage: %d %q, want 503 \"down\"",
			duringOutage.Code, duringOutage.Body.String())
	}

	send(mock, "POST", "/fail", `{"fail":false}`, nil)
	afterOutage := send(mock, "GET", "/regular/tasks", "", nil)
	if afterOutage.Code != 200 {
		t.Errorf("after the outage: %d, want 200", afterOutage.Code)
	}
}

func TestOpenAIAcceptsOnlyTheTestKey(t *testing.T) {
	refusal := `{"error":{"message":"Incorrect API key provided"}}`
	tests := []struct {
		name       string
		headers    map[string]string
		wantStatus int
		wantBody   string
	}{
		{"the test key can read a model", goodKey, 200, `{"id":"gpt-5.4-mini"}`},
		{"another key is refused", map[string]string{"Authorization": "Bearer sk-other"}, 401, refusal},
		{"no key is refused", nil, 401, refusal},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := send(newTestMock(t), "GET", "/v1/models/gpt-5.4-mini", "", test.headers)
			if recorder.Code != test.wantStatus || recorder.Body.String() != test.wantBody {
				t.Errorf("got %d %s, want %d %s",
					recorder.Code, recorder.Body.String(), test.wantStatus, test.wantBody)
			}
		})
	}
}

func TestVisionReturnsThePresetRowsUntilSetRowsReplacesThem(t *testing.T) {
	mock := newTestMock(t)
	visionRequest := `{"model":"gpt-5.4-mini","input":[{"role":"user",` +
		`"content":[{"type":"input_image","image_url":"data:,"}]}]}`

	defaultText := outputText(t, send(mock, "POST", "/v1/responses", visionRequest, goodKey))
	misspelledRow := `{"name":"Seizing the Initative","trader":null,"progress":0}`
	if !strings.Contains(defaultText, misspelledRow) {
		t.Errorf("default rows %s don't include the misspelled task", defaultText)
	}

	send(mock, "POST", "/set-rows", `[{"name":"Shortage","progress":1.50}]`, nil)
	newText := outputText(t, send(mock, "POST", "/v1/responses", visionRequest, goodKey))
	if want := `{"rows":[{"name":"Shortage","progress":1.5}]}`; newText != want {
		t.Errorf("after /set-rows: %s, want %s", newText, want)
	}
}

func TestCategorizeMovesOnlyPartsThatNeedKeys(t *testing.T) {
	parts := `[` +
		`{"id":"p1","objectives":[{"type":"visit"},` +
		`{"type":"giveItem","keys":["Dorm room 314 marked key","Other"]}]},` +
		`{"id":"p2","objectives":[{"type":"findItem","count":3}]},` +
		`{"id":"p3","objectives":[{"type":"visit","keys":null}]}` +
		`]`
	context, _ := json.Marshal("MAP / SCOPE: Customs\n\nPARTS:\n" + parts)
	request := `{"model":"gpt-5.4","input":[{"role":"user","content":` + string(context) + `}]}`

	recorder := send(newTestMock(t), "POST", "/v1/responses", request, goodKey)
	want := `{"reply":"Moved 1 parts that need keys.",` +
		`"new_categories":[{"name":"Key runs","color":"#4dabf7","icon":"star"}],` +
		`"assignments":[{"part_id":"p1","category":"Key runs",` +
		`"reason":"Needs Dorm room 314 marked key"}]}`
	if got := outputText(t, recorder); got != want {
		t.Errorf("categorize answer:\n got %s\nwant %s", got, want)
	}
}

func TestRequestLogListsRequestsInOrder(t *testing.T) {
	mock := newTestMock(t)
	send(mock, "GET", "/regular/tasks", "", nil)
	send(mock, "GET", "/wiki?page=Dandies", "", nil)
	visionRequest := `{"model":"gpt-5.4-mini","reasoning":{"effort":"low"},"input":"input_image <&>"}`
	send(mock, "POST", "/v1/responses", visionRequest, goodKey)
	send(mock, "POST", "/v1/responses", `{"input":[]}`, goodKey)
	send(mock, "GET", "/v1/models/x", "", nil) // refused requests aren't logged

	recorder := send(mock, "GET", "/log", "", nil)
	// imgBytes is the input's length as JSON: "input_image <&>" with its quotes is 17.
	want := `["json /regular/tasks","wiki Dandies",` +
		`"responses model=gpt-5.4-mini vision=true reasoning={\"effort\":\"low\"} imgBytes=17",` +
		`"responses model=undefined vision=false reasoning=null imgBytes=0"]`
	if got := recorder.Body.String(); got != want {
		t.Errorf("log:\n got %s\nwant %s", got, want)
	}
}

func TestWikiAnswersTheSamePageForEveryTitle(t *testing.T) {
	recorder := send(newTestMock(t), "GET", "/wiki?page=Dandies", "", nil)
	want := `{"parse":{"title":"Dandies",` +
		`"wikitext":"==Objectives==\n*Do the thing\n==Guide==\nIt's upstairs."}}`
	contentType := recorder.Header().Get("Content-Type")
	if recorder.Body.String() != want || contentType != jsonContentType {
		t.Errorf("got %s (%s), want %s", recorder.Body.String(), contentType, want)
	}
}

func TestBadJSONBodiesAnswer500(t *testing.T) {
	for _, path := range []string{"/set-rows", "/fail", "/v1/responses"} {
		recorder := send(newTestMock(t), "POST", path, "not json", goodKey)
		if recorder.Code != http.StatusInternalServerError {
			t.Errorf("POST %s with bad JSON = %d, want 500", path, recorder.Code)
		}
	}
}

func TestLoadDocumentsFromTheRepoTestdata(t *testing.T) {
	testdataFolder := filepath.Join("..", "..", "testdata")
	for _, source := range []documentSource{snapshotDocuments, realDocuments} {
		t.Run(string(source), func(t *testing.T) {
			documents, err := loadDocuments(testdataFolder, source)
			if err != nil {
				t.Fatal(err)
			}
			for _, name := range documentNames {
				document := documents[name.urlName]
				if !json.Valid(document) || !bytes.HasPrefix(document, []byte(`{"data":`)) {
					t.Errorf("%s: not a json.tarkov.dev file: %.40s", name.urlName, document)
				}
			}
		})
	}
}
