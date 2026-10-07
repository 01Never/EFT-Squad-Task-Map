package main

import (
	"net/http"
	"strings"
	"testing"
)

const someItem = "5991b51486f77447b112d44f"

func TestIconsAreWebpUntilAnIdIsMarkedMissing(t *testing.T) {
	mock := newTestMock(t)
	icon := send(mock, "GET", "/assets/"+someItem+"-icon.webp", "", nil)
	if icon.Code != http.StatusOK || icon.Header().Get("Content-Type") != "image/webp" || !strings.HasPrefix(icon.Body.String(), "RIFF") {
		t.Fatalf("icon: %d %q", icon.Code, icon.Header().Get("Content-Type"))
	}

	send(mock, "POST", "/icons-missing", `{"ids":["`+someItem+`"]}`, nil)
	if missing := send(mock, "GET", "/assets/"+someItem+"-icon.webp", "", nil); missing.Code != http.StatusNotFound {
		t.Errorf("a missing icon answered %d", missing.Code)
	}
	if other := send(mock, "GET", "/assets/not-an-id-icon.webp", "", nil); other.Code != http.StatusNotFound {
		t.Errorf("a bad name answered %d", other.Code)
	}
}

func TestTheIconLogListsRequestsAndLeavesTheMainLogAlone(t *testing.T) {
	mock := newTestMock(t)
	send(mock, "GET", "/assets/"+someItem+"-icon.webp", "", nil)
	if log := send(mock, "GET", "/icons-log", "", nil).Body.String(); log != `["`+someItem+`"]` {
		t.Errorf("icon log %s", log)
	}
	if log := send(mock, "GET", "/log", "", nil).Body.String(); log != "[]" {
		t.Errorf("main log %s", log)
	}
}
