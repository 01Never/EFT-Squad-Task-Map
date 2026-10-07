package app

import (
	"bytes"
	"fmt"
	"net"
	"net/http"
	"testing"

	"squadtaskmap/internal/httpapi"
)

// guardedServer serves the app's real routes behind the same Guard as Run, for the port it
// actually listens on.
func guardedServer(t *testing.T, rig *updateRoutesRig) (int, string) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	server := &http.Server{Handler: httpapi.Guard(localPageHosts(port), httpapi.NewServer(rig.app, nil))}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close() })
	return port, fmt.Sprintf("http://127.0.0.1:%d", port)
}

func TestTheAllowedHostsUseThePortTheServerListensOn(t *testing.T) {
	got := localPageHosts(7970)
	want := httpapi.AllowedHosts{"127.0.0.1:7970", "localhost:7970"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("localPageHosts(7970) = %v, want %v", got, want)
	}
}

func TestASecondLaunchStillFindsTheRunningCopyBehindTheGuard(t *testing.T) {
	rig := newUpdateRoutesRig(t)
	port, _ := guardedServer(t, rig)
	rememberRunningCopy(rig.files, port)

	url, running := runningCopy(rig.files)
	if !running || url != fmt.Sprintf("http://127.0.0.1:%d/", port) {
		t.Errorf("runningCopy = %q, %v; want the running copy's page", url, running)
	}
}

func TestACrossSitePostCantCheckForUpdates(t *testing.T) {
	rig := newUpdateRoutesRig(t)
	_, base := guardedServer(t, rig)

	request, _ := http.NewRequest(http.MethodPost, base+"/api/updates/check", bytes.NewBufferString("{}"))
	request.Header.Set("Origin", "http://evil.example")
	request.Header.Set("Content-Type", "text/plain")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403", response.StatusCode)
	}
	if rig.requests.Load() != 0 {
		t.Errorf("GitHub was asked %d times, want 0", rig.requests.Load())
	}
}
