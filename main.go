// Squad Task Map: a map helper for Escape from Tarkov that runs on your PC.
// It serves the map page on http://127.0.0.1:7777, watches the game's logs and screenshots, and
// keeps your task list. Everything starts in internal/app (read internal/app/app.go first).
package main

import (
	"fmt"
	"os"

	"squadtaskmap/internal/app"
)

func main() {
	if err := app.Run(builtInFiles); err != nil {
		fmt.Fprintln(os.Stderr, "Squad Task Map couldn't start:", err)
		fmt.Fprintln(os.Stderr, "Press Enter to close.")
		fmt.Scanln()
		os.Exit(1)
	}
}
