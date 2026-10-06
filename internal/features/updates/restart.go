// Starting the new copy after an update, and the new copy waiting for the old one to let go of
// its port. This is the only polling in the feature, and it runs for a few seconds, once, at the
// start of a copy that an update launched.
package updates

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// StartNewCopy starts the exe with the given arguments in its own folder, sharing this
// console window, and doesn't wait for it. (Windows keeps a console window open while any
// process uses it, so the window survives the old copy exiting.)
func StartNewCopy(exePath string, arguments []string) error {
	command := exec.Command(exePath, arguments...)
	command.Dir = filepath.Dir(exePath)
	command.Stdin = os.Stdin
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Start(); err != nil {
		return err
	}
	return command.Process.Release()
}

// Waiting for the old copy: how long, and how often to look.
const (
	// WaitForOldCopy: the new copy gives the old one this long to close its port.
	WaitForOldCopy   = 15 * time.Second
	portPollInterval = 200 * time.Millisecond
)

// WaitUntilPortIsFree blocks until nothing accepts connections on 127.0.0.1:port, or the timeout
// passes. It returns true when the port is free. The new copy calls it before looking for a
// running copy, because the old one is still shutting down when the new one starts.
func WaitUntilPortIsFree(port int, timeout time.Duration) bool {
	return waitUntilFree(func() bool { return nothingListensOn(port) }, timeout, portPollInterval)
}

// waitUntilFree polls isFree until it's true or the timeout passes (separate for tests).
func waitUntilFree(isFree func() bool, timeout, interval time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for {
		if isFree() {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(interval)
	}
}

func nothingListensOn(port int) bool {
	address := fmt.Sprintf("127.0.0.1:%d", port)
	connection, err := net.DialTimeout("tcp", address, portPollInterval)
	if err != nil {
		return true
	}
	connection.Close()
	return false
}
