package main

import (
	"strings"
	"testing"
)

const extractListRequest = `{"model":"gpt-5.4-mini","input":[{"role":"user","content":[` +
	`{"type":"input_text","text":"Read the extract list in this screenshot."},` +
	`{"type":"input_image","image_url":"data:,"}]}]}`

func TestAnExtractListScreenshotGetsThePresetListUntilSetExtractsReplacesIt(t *testing.T) {
	mock := newTestMock(t)

	defaultText := outputText(t, send(mock, "POST", "/v1/responses", extractListRequest, goodKey))
	if !strings.Contains(defaultText, `"visible":true`) || !strings.Contains(defaultText, `"Crossroads"`) {
		t.Errorf("default list %s should be visible and include Crossroads", defaultText)
	}

	send(mock, "POST", "/set-extracts", `{"visible":false,"extracts":[]}`, nil)
	noList := outputText(t, send(mock, "POST", "/v1/responses", extractListRequest, goodKey))
	if want := `{"visible":false,"extracts":[]}`; noList != want {
		t.Errorf("after /set-extracts: %s, want %s", noList, want)
	}
}

func TestExtractReadsAreMarkedInTheLogAndTaskScansAreNot(t *testing.T) {
	mock := newTestMock(t)
	send(mock, "POST", "/v1/responses", extractListRequest, goodKey)
	scanRequest := `{"model":"gpt-5.4-mini","input":[{"role":"user","content":[` +
		`{"type":"input_text","text":"Read the task rows in this screenshot."},{"type":"input_image","image_url":"data:,"}]}]}`
	send(mock, "POST", "/v1/responses", scanRequest, goodKey)

	log := send(mock, "GET", "/log", "", nil).Body.String()
	if strings.Count(log, "extracts=true") != 1 {
		t.Errorf("log %s should mark exactly the extract read", log)
	}
}
