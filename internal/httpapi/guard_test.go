package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The test server pretends to listen on port 7777, as the app does by default.
var testHosts = AllowedHosts{"127.0.0.1:7777", "localhost:7777"}

func (backend *fakeBackend) ServeEvents(writer http.ResponseWriter, _ *http.Request) {
	writer.Header().Set("Content-Type", "text/event-stream")
	writer.Write([]byte(": connected\n\n"))
}

type guardedRequest struct {
	method      string
	path        string
	host        string
	headers     map[string]string
	contentType string
	body        string
}

func sendGuarded(t *testing.T, backend *fakeBackend, request guardedRequest) *httptest.ResponseRecorder {
	t.Helper()
	server := Guard(testHosts, newTestServer(t, backend, false))
	httpRequest := httptest.NewRequest(request.method, request.path, strings.NewReader(request.body))
	httpRequest.Host = request.host
	if request.body == "" {
		httpRequest.ContentLength = 0
	}
	if request.contentType != "" {
		httpRequest.Header.Set("Content-Type", request.contentType)
	}
	for name, value := range request.headers {
		httpRequest.Header.Set(name, value)
	}
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httpRequest)
	return recorder
}

func TestOnlyTheAppsOwnPageIsAnswered(t *testing.T) {
	const ourPage = "http://127.0.0.1:7777"
	cases := []struct {
		name       string
		request    guardedRequest
		wantStatus int
	}{
		// The page, its files and the live events, opened on our own host.
		{"the page on 127.0.0.1 is served", guardedRequest{method: "GET", path: "/", host: "127.0.0.1:7777"}, http.StatusOK},
		{"the page on localhost is served", guardedRequest{method: "GET", path: "/", host: "localhost:7777"}, http.StatusOK},
		{"a host name in capitals is the same host", guardedRequest{method: "GET", path: "/", host: "LOCALHOST:7777"}, http.StatusOK},
		{"a script is served", guardedRequest{method: "GET", path: "/js/app.js", host: "127.0.0.1:7777"}, http.StatusOK},
		{"the live events are served", guardedRequest{method: "GET", path: "/api/events", host: "127.0.0.1:7777"}, http.StatusOK},
		{"the saved data is read", guardedRequest{method: "GET", path: "/api/state", host: "127.0.0.1:7777"}, http.StatusOK},
		{"a GET from another site still passes (it can't read the answer)", guardedRequest{method: "GET", path: "/api/state", host: "127.0.0.1:7777", headers: map[string]string{"Origin": "http://evil.example", "Sec-Fetch-Site": "cross-site"}}, http.StatusOK},

		// Host: blocks DNS rebinding.
		{"a foreign host is refused", guardedRequest{method: "GET", path: "/api/state", host: "attacker.example:7777"}, http.StatusMisdirectedRequest},
		{"a foreign host is refused for the page too", guardedRequest{method: "GET", path: "/", host: "attacker.example"}, http.StatusMisdirectedRequest},
		{"a foreign host is refused for the live events", guardedRequest{method: "GET", path: "/api/events", host: "attacker.example:7777"}, http.StatusMisdirectedRequest},
		{"the port in the host must be ours", guardedRequest{method: "GET", path: "/", host: "127.0.0.1:7778"}, http.StatusMisdirectedRequest},
		{"a host without a port is refused", guardedRequest{method: "GET", path: "/", host: "127.0.0.1"}, http.StatusMisdirectedRequest},
		{"no host is refused", guardedRequest{method: "GET", path: "/", host: ""}, http.StatusMisdirectedRequest},

		// Origin on state-changing requests: blocks cross-site POSTs.
		{"our page's origin may change things", guardedRequest{method: "PUT", path: "/api/state", host: "127.0.0.1:7777", contentType: "application/json", body: "{}", headers: map[string]string{"Origin": ourPage}}, http.StatusOK},
		{"the localhost origin may change things", guardedRequest{method: "POST", path: "/api/events/ack", host: "localhost:7777", contentType: "application/json", body: "{}", headers: map[string]string{"Origin": "http://localhost:7777"}}, http.StatusOK},
		{"a foreign origin is refused", guardedRequest{method: "POST", path: "/api/events/ack", host: "127.0.0.1:7777", contentType: "application/json", body: "{}", headers: map[string]string{"Origin": "http://evil.example"}}, http.StatusForbidden},
		{"a null origin is refused", guardedRequest{method: "POST", path: "/api/events/ack", host: "127.0.0.1:7777", contentType: "application/json", body: "{}", headers: map[string]string{"Origin": "null"}}, http.StatusForbidden},
		{"our host on another port is a foreign origin", guardedRequest{method: "POST", path: "/api/events/ack", host: "127.0.0.1:7777", contentType: "application/json", body: "{}", headers: map[string]string{"Origin": "http://127.0.0.1:7778"}}, http.StatusForbidden},
		{"https is a foreign origin", guardedRequest{method: "POST", path: "/api/events/ack", host: "127.0.0.1:7777", contentType: "application/json", body: "{}", headers: map[string]string{"Origin": "https://127.0.0.1:7777"}}, http.StatusForbidden},
		{"a foreign origin is refused even without a body", guardedRequest{method: "POST", path: "/api/updates/check", host: "127.0.0.1:7777", headers: map[string]string{"Origin": "http://evil.example"}}, http.StatusForbidden},
		{"a foreign origin can't delete either", guardedRequest{method: "DELETE", path: "/api/ai/key", host: "127.0.0.1:7777", headers: map[string]string{"Origin": "http://evil.example"}}, http.StatusForbidden},

		// Sec-Fetch-Site when there's no Origin.
		{"same-origin without an Origin passes", guardedRequest{method: "POST", path: "/api/events/ack", host: "127.0.0.1:7777", contentType: "application/json", body: "{}", headers: map[string]string{"Sec-Fetch-Site": "same-origin"}}, http.StatusOK},
		{"a request typed by the user (none) passes", guardedRequest{method: "POST", path: "/api/events/ack", host: "127.0.0.1:7777", contentType: "application/json", body: "{}", headers: map[string]string{"Sec-Fetch-Site": "none"}}, http.StatusOK},
		{"cross-site without an Origin is refused", guardedRequest{method: "POST", path: "/api/events/ack", host: "127.0.0.1:7777", contentType: "application/json", body: "{}", headers: map[string]string{"Sec-Fetch-Site": "cross-site"}}, http.StatusForbidden},
		{"same-site without an Origin is refused", guardedRequest{method: "POST", path: "/api/events/ack", host: "127.0.0.1:7777", contentType: "application/json", body: "{}", headers: map[string]string{"Sec-Fetch-Site": "same-site"}}, http.StatusForbidden},
		{"a client that isn't a browser (no Origin, no Sec-Fetch-Site) passes", guardedRequest{method: "POST", path: "/api/events/ack", host: "127.0.0.1:7777", contentType: "application/json", body: "{}"}, http.StatusOK},

		// JSON bodies: a form or text/plain POST can't reach a JSON route.
		{"a text/plain body is refused", guardedRequest{method: "POST", path: "/api/events/ack", host: "127.0.0.1:7777", contentType: "text/plain", body: `{"upTo":1}`}, http.StatusUnsupportedMediaType},
		{"a form body is refused", guardedRequest{method: "PUT", path: "/api/state", host: "127.0.0.1:7777", contentType: "application/x-www-form-urlencoded", body: "a=1"}, http.StatusUnsupportedMediaType},
		{"a body without a Content-Type is refused", guardedRequest{method: "PUT", path: "/api/state", host: "127.0.0.1:7777", body: "{}"}, http.StatusUnsupportedMediaType},
		{"JSON with a charset is fine", guardedRequest{method: "PUT", path: "/api/state", host: "127.0.0.1:7777", contentType: "application/json; charset=utf-8", body: "{}"}, http.StatusOK},
		{"no body and no Content-Type is fine (read as {})", guardedRequest{method: "POST", path: "/api/events/ack", host: "127.0.0.1:7777"}, http.StatusOK},
		{"text/plain with an empty body is still refused", guardedRequest{method: "POST", path: "/api/events/ack", host: "127.0.0.1:7777", contentType: "text/plain"}, http.StatusUnsupportedMediaType},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			response := sendGuarded(t, &fakeBackend{state: "null"}, testCase.request)
			if response.Code != testCase.wantStatus {
				t.Errorf("status = %d (%s), want %d", response.Code, strings.TrimSpace(response.Body.String()), testCase.wantStatus)
			}
		})
	}
}

func TestARefusedRequestNeverReachesTheRoute(t *testing.T) {
	cases := []struct {
		name    string
		request guardedRequest
	}{
		{"a foreign host", guardedRequest{method: "PUT", path: "/api/state", host: "attacker.example:7777", contentType: "application/json", body: `{"v":1}`}},
		{"a foreign origin", guardedRequest{method: "PUT", path: "/api/state", host: "127.0.0.1:7777", contentType: "application/json", body: `{"v":1}`, headers: map[string]string{"Origin": "http://evil.example"}}},
		{"a text/plain body", guardedRequest{method: "PUT", path: "/api/state", host: "127.0.0.1:7777", contentType: "text/plain", body: `{"v":1}`}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			backend := &fakeBackend{}
			sendGuarded(t, backend, testCase.request)
			if len(backend.written) != 0 {
				t.Errorf("the saved data was written: %v", backend.written)
			}
		})
	}
}

func TestARefusalIsOnePlainTextLine(t *testing.T) {
	response := sendGuarded(t, &fakeBackend{}, guardedRequest{method: "GET", path: "/api/state", host: "attacker.example:7777"})
	body := response.Body.String()
	if !strings.HasPrefix(response.Header().Get("Content-Type"), "text/plain") || strings.Count(body, "\n") != 1 || !strings.HasSuffix(body, "\n") {
		t.Errorf("refusal = %q (%s), want one plain-text line", body, response.Header().Get("Content-Type"))
	}
}
