// Command release is the owner's tool for publishing an update (ticket 04c):
//
//	go run ./cmd/release -init-keys                      once: make the signing key pair
//	go run ./cmd/release -version 2.6.0 -notes notes.md  per release: check, test, build, sign
//
// It writes dist/SquadTaskMap.exe and the signed dist/latest.json, then prints how to attach
// both to a GitHub release. It never uploads anything and never contacts the network itself.
// See README.md (and docs/HANDOFF.md, "Publishing an update").
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"squadtaskmap/internal/features/updates"
)

// options are the command-line flags.
type options struct {
	initKeys  bool
	keyOut    string // -init-keys: where to write the private key
	version   string
	notesPath string
	root      string // the repo root (where internal/app/run.go is)
	outDir    string // where the exe and latest.json go
	date      string // the "released" date, YYYY-MM-DD (default: today)
	skipTests bool
	skipBuild bool
	exePath   string // with -skip-build: the exe to publish instead of building one
}

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "release:", err)
		os.Exit(1)
	}
}

func run(args []string, output io.Writer) error {
	options, err := parseFlags(args, output)
	if err != nil {
		return err
	}
	if options.initKeys {
		return initKeys(options.keyOut, output)
	}
	return publish(options, output)
}

func parseFlags(args []string, output io.Writer) (options, error) {
	var options options
	flags := flag.NewFlagSet("release", flag.ContinueOnError)
	flags.SetOutput(output)
	flags.BoolVar(&options.initKeys, "init-keys", false, "create the signing key pair (once) and print the public key to paste into the code")
	flags.StringVar(&options.keyOut, "key-out", "", "with -init-keys: where to write the private key (default: your user config folder)")
	flags.StringVar(&options.version, "version", "", "the version to publish, e.g. 2.6.0")
	flags.StringVar(&options.notesPath, "notes", "", "a text/markdown file with the release notes")
	flags.StringVar(&options.root, "root", ".", "the repo root")
	flags.StringVar(&options.outDir, "out", "dist", "where to write SquadTaskMap.exe and latest.json")
	flags.StringVar(&options.date, "date", time.Now().Format("2006-01-02"), "the release date")
	flags.BoolVar(&options.skipTests, "skip-tests", false, "don't run go test / npm test (only for trying the tool; never for a real release)")
	flags.BoolVar(&options.skipBuild, "skip-build", false, "don't build the exe; use -exe instead (only for the tool's own tests)")
	flags.StringVar(&options.exePath, "exe", "", "with -skip-build: the exe to publish")
	if err := flags.Parse(args); err != nil {
		return options, err
	}
	if !options.initKeys {
		if options.version == "" || options.notesPath == "" {
			return options, fmt.Errorf("-version and -notes are required (or -init-keys); see go run ./cmd/release -h")
		}
		if _, err := updates.ParseVersion(options.version); err != nil {
			return options, fmt.Errorf("-version: %w", err)
		}
	}
	return options, nil
}

// publish is the whole release: every step stops the release on its first problem.
func publish(options options, output io.Writer) error {
	// 1. The version must be the same everywhere before anything is built.
	found, err := readProjectVersions(options.root)
	if err != nil {
		return err
	}
	if err := checkVersionsMatch(options.version, found); err != nil {
		return err
	}
	fmt.Fprintf(output, "Version %s matches run.go, package.json and winres.json.\n", options.version)

	// 2. The key must exist, and must be the one built into the app.
	privateKey, err := loadPrivateKeyFromEnvironment()
	if err != nil {
		return err
	}
	if err := checkKeyMatchesApp(privateKey); err != nil {
		return err
	}
	notes, err := readNotes(options.notesPath)
	if err != nil {
		return err
	}

	// 3. Tests, then the Windows exe.
	if !options.skipTests {
		if err := runTests(options.root, output); err != nil {
			return err
		}
	}
	if err := os.MkdirAll(options.outDir, 0o755); err != nil {
		return err
	}
	exePath := filepath.Join(options.outDir, updates.ExeFileName)
	if options.skipBuild {
		exePath = options.exePath
	} else if err := buildWindowsExe(options.root, exePath, output); err != nil {
		return err
	}

	// 4. The manifest: size and SHA-256 of the exe, signed.
	manifest, err := buildSignedManifest(options.version, options.date, notes, exePath, privateKey)
	if err != nil {
		return err
	}
	manifestPath := filepath.Join(options.outDir, updates.ManifestFileName)
	if err := writeManifest(manifestPath, manifest); err != nil {
		return err
	}
	fmt.Fprintf(output, "\nWrote %s (%d bytes, sha256 %s)\n", exePath, manifest.File.Size, manifest.File.SHA256)
	fmt.Fprintf(output, "Wrote %s (signed)\n", manifestPath)

	printNextSteps(output, options, exePath, manifestPath)
	return nil
}
