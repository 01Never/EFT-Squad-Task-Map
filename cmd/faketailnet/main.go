// Command faketailnet is a stand-in for Tailscale's servers, for end-to-end squad tests: a
// coordination server (Tailscale's own testcontrol, with invite codes, tags, unique names, an ACL
// and the admin console's actions on top), a DERP relay and a STUN server, all on 127.0.0.1.
// Copies of the app join it with STM_SQUAD_CONTROL_URL. Test-only: never built into the app.
// See README.md for the admin API.
package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"tailscale.com/envknob"
	"tailscale.com/net/netns"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "faketailnet:", err)
		os.Exit(1)
	}
}

func run() error {
	listenAddress := flag.String("listen", "127.0.0.1:0",
		"address of the control server and admin API (127.0.0.1 only)")
	stateRoot := flag.String("state", "",
		"folder for the test nodes' state (default: a new temporary folder, removed at exit)")
	flag.Parse()

	host, _, err := net.SplitHostPort(*listenAddress)
	if err != nil || (host != "127.0.0.1" && host != "::1") {
		return fmt.Errorf("-listen must be on 127.0.0.1 or ::1, got %q", *listenAddress)
	}
	removeStateAtExit := *stateRoot == ""
	if removeStateAtExit {
		if *stateRoot, err = os.MkdirTemp("", "faketailnet-"); err != nil {
			return err
		}
	}
	// The test nodes are real Tailscale nodes: no log uploads to Tailscale, logs in our folder.
	envknob.SetNoLogsNoSupport()
	_ = os.Setenv("TS_LOGS_DIR", *stateRoot)
	// As tsnet_test.go does: no routing marks on sockets (they need extra rights on Linux).
	netns.SetEnabled(false)

	return serve(*listenAddress, *stateRoot, removeStateAtExit)
}

func serve(listenAddress, stateRoot string, removeStateAtExit bool) error {
	listener, err := net.Listen("tcp", listenAddress)
	if err != nil {
		return fmt.Errorf("listening on %s: %w", listenAddress, err)
	}
	baseURL := "http://" + listener.Addr().String()

	counters := newRelayCounters()
	derpMap, stopRelay, err := startRelay(counters)
	if err != nil {
		return err
	}
	defer stopRelay()
	network := newTailnet(derpMap, baseURL)
	counters.isRelayOnly = func() bool { return network.currentSettings().RelayOnly }
	counters.nodeNameForKey = network.nodeNameByKey
	nodes := &testNodes{controlURL: baseURL, stateRoot: stateRoot, nodes: map[string]*testNode{}}
	admin := newAdminAPI(network, counters, nodes)

	handler := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if strings.HasPrefix(request.URL.Path, "/admin/") {
			admin.ServeHTTP(writer, request)
			return
		}
		if !isControlPath(request.URL.Path) {
			// testcontrol panics on paths it doesn't know (a browser's /favicon.ico, say).
			http.NotFound(writer, request)
			return
		}
		network.control.ServeHTTP(writer, request)
	})
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ErrorLog:          discardLogger(),
	}

	// Lines a test harness waits for (stdout).
	fmt.Printf("faketailnet: control %s\n", baseURL)
	fmt.Printf("faketailnet: admin %s/admin/\n", baseURL)
	fmt.Printf("faketailnet: invite codes tagged=%s expired=%s untagged=%s\n",
		TaggedInviteCode, ExpiredInviteCode, UntaggedInviteCode)
	fmt.Println("faketailnet: ready")

	stopped := make(chan os.Signal, 1)
	signal.Notify(stopped, os.Interrupt, syscall.SIGTERM)
	// Goroutine note: serves until the listener is closed below.
	go server.Serve(listener)
	<-stopped
	nodes.stopAll()
	server.Close()
	if removeStateAtExit {
		_ = os.RemoveAll(stateRoot)
	}
	return nil
}

// isControlPath: the paths Tailscale clients ask for in the clear: the server's key, the Noise
// upgrade and the captive-portal check. Everything else (/machine/…) travels inside the Noise
// channel, which testcontrol serves itself.
func isControlPath(path string) bool {
	return path == "/key" || path == "/ts2021" || path == "/generate_204"
}

func discardLogger() *log.Logger { return log.New(discard{}, "", 0) }

type discard struct{}

func (discard) Write(bytes []byte) (int, error) { return len(bytes), nil }
