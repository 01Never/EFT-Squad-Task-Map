// Command mock is an offline stand-in for json.tarkov.dev, the OpenAI API and the Tarkov wiki,
// for end-to-end tests. It is the Go port of v2's tests/mock-server.ts and answers the same way.
// Run it from the repo root: go run ./cmd/mock (see README.md for endpoints and settings).
package main

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// Same defaults as v2's mock.
const (
	defaultPort        = 7820
	idleTimeoutSeconds = 60
)

// settings come from environment variables, like the app's own STM_* settings.
type settings struct {
	port           int            // MOCK_PORT
	documentSource documentSource // MOCK_DOCS: "snapshot" (default) or "real"
	testdataFolder string         // MOCK_TESTDATA_DIR, default "testdata" (relative to the repo root)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "mock:", err)
		os.Exit(1)
	}
}

func run() error {
	settings, err := settingsFromEnvironment()
	if err != nil {
		return err
	}
	documents, err := loadDocuments(settings.testdataFolder, settings.documentSource)
	if err != nil {
		return fmt.Errorf("loading the %s json.tarkov.dev files (run from the repo root, or set "+
			"MOCK_TESTDATA_DIR): %w", settings.documentSource, err)
	}
	mock, err := newMockServer(documents)
	if err != nil {
		return err
	}

	address := net.JoinHostPort("127.0.0.1", strconv.Itoa(settings.port))
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return fmt.Errorf("listening on %s: %w", address, err)
	}
	// Printed once the port is open, like v2; scripts can wait for this line.
	fmt.Println("mock up")

	server := &http.Server{Handler: mock, IdleTimeout: idleTimeoutSeconds * time.Second}
	return server.Serve(listener)
}

func settingsFromEnvironment() (settings, error) {
	documentSource, err := documentSourceFromEnvironment()
	if err != nil {
		return settings{}, err
	}
	testdataFolder := os.Getenv("MOCK_TESTDATA_DIR")
	if testdataFolder == "" {
		testdataFolder = "testdata"
	}
	return settings{
		port:           portFromEnvironment(),
		documentSource: documentSource,
		testdataFolder: testdataFolder,
	}, nil
}

// portFromEnvironment reads MOCK_PORT. A missing, zero or unreadable value means the default,
// as v2's `Number(process.env.MOCK_PORT) || 7820` did.
func portFromEnvironment() int {
	port, err := strconv.Atoi(strings.TrimSpace(os.Getenv("MOCK_PORT")))
	if err != nil || port == 0 {
		return defaultPort
	}
	return port
}

// documentSourceFromEnvironment reads MOCK_DOCS. Anything but "", "snapshot" or "real" is an
// error, so a typo doesn't quietly serve the wrong files.
func documentSourceFromEnvironment() (documentSource, error) {
	switch value := os.Getenv("MOCK_DOCS"); value {
	case "", string(snapshotDocuments):
		return snapshotDocuments, nil
	case string(realDocuments):
		return realDocuments, nil
	default:
		return "", fmt.Errorf("MOCK_DOCS=%q: use %q (default) or %q",
			value, snapshotDocuments, realDocuments)
	}
}
