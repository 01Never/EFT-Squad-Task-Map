package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"squadtaskmap/internal/features/updates"
)

// readNotes reads the release notes. Windows line endings become \n, so the signed text is the
// same wherever the file was saved.
func readNotes(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("reading the release notes: %w", err)
	}
	notes := strings.ReplaceAll(string(data), "\r\n", "\n")
	notes = strings.TrimSpace(notes)
	if notes == "" {
		return "", fmt.Errorf("%s is empty: say what's new", path)
	}
	return notes, nil
}

// runTests runs the server tests and, when Node is installed, the page tests. A release is not
// built from a tree whose tests fail.
func runTests(root string, output io.Writer) error {
	fmt.Fprintln(output, "\nRunning go test ./... ...")
	if err := runCommand(root, output, nil, "go", "test", "./..."); err != nil {
		return fmt.Errorf("go test failed: %w", err)
	}
	if _, err := exec.LookPath("npm"); err != nil {
		fmt.Fprintln(output, "npm isn't installed here: skipping the page tests (npm test).")
		return nil
	}
	fmt.Fprintln(output, "\nRunning npm test ...")
	if err := runCommand(root, output, nil, "npm", "test"); err != nil {
		return fmt.Errorf("npm test failed: %w", err)
	}
	return nil
}

// buildWindowsExe builds the 64-bit Windows exe, like the release checklist in docs/HANDOFF.md.
func buildWindowsExe(root, exePath string, output io.Writer) error {
	fmt.Fprintln(output, "\nBuilding the Windows exe ...")
	absolute, err := filepath.Abs(exePath)
	if err != nil {
		return err
	}
	environment := []string{"GOOS=windows", "GOARCH=amd64", "CGO_ENABLED=0"}
	err = runCommand(root, output, environment, "go", "build", "-trimpath", "-ldflags", "-s -w", "-o", absolute, ".")
	if err != nil {
		return fmt.Errorf("go build failed: %w", err)
	}
	return nil
}

func runCommand(folder string, output io.Writer, extraEnvironment []string, name string, args ...string) error {
	command := exec.Command(name, args...)
	command.Dir = folder
	command.Env = append(os.Environ(), extraEnvironment...)
	command.Stdout = output
	command.Stderr = output
	return command.Run()
}

// buildSignedManifest measures the exe and signs the manifest for it. It checks its own work
// with the same functions the app uses, so a release that the app would refuse is never written.
func buildSignedManifest(version, released, notes, exePath string, privateKey ed25519.PrivateKey) (updates.Manifest, error) {
	size, checksum, err := measureFile(exePath)
	if err != nil {
		return updates.Manifest{}, err
	}
	manifest := updates.Manifest{
		Version:  version,
		Released: released,
		Notes:    notes,
		File:     updates.FileInfo{Name: updates.ExeFileName, Size: size, SHA256: checksum},
	}
	if err := updates.ValidateManifest(manifest); err != nil {
		return updates.Manifest{}, fmt.Errorf("the manifest would be refused by the app: %w", err)
	}
	signed := updates.SignManifest(manifest, privateKey)
	if !updates.VerifySignature(signed, privateKey.Public().(ed25519.PublicKey)) {
		return updates.Manifest{}, fmt.Errorf("the signature doesn't verify against its own key (this is a bug)")
	}
	return signed, nil
}

// measureFile returns a file's size and lower-case hex SHA-256.
func measureFile(path string) (int64, string, error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, "", fmt.Errorf("opening the exe: %w", err)
	}
	defer file.Close()
	hash := sha256.New()
	size, err := io.Copy(hash, file)
	if err != nil {
		return 0, "", fmt.Errorf("reading the exe: %w", err)
	}
	return size, hex.EncodeToString(hash.Sum(nil)), nil
}

// writeManifest writes latest.json, indented so it's readable on GitHub. The app reads the JSON
// and rebuilds the signed bytes with updates.CanonicalBytes, so the layout doesn't matter.
func writeManifest(path string, manifest updates.Manifest) error {
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

// printNextSteps says how to publish: with the GitHub CLI, or by hand in the browser.
// Nothing is uploaded by this tool.
func printNextSteps(output io.Writer, options options, exePath, manifestPath string) {
	tag := "v" + options.version
	fmt.Fprintf(output, `
Next: publish the release on GitHub (it is not published yet).

With the GitHub CLI (gh), run:
  gh release create %s %s %s --title "%s" --notes-file %s

Or by hand:
  1. Open https://github.com/%s/releases/new
  2. Choose a new tag: %s
  3. Title: %s. Paste the notes from %s.
  4. Attach %s and %s.
  5. Leave "Set as a pre-release" and "Save as draft" OFF, then "Publish release".
     (Drafts and pre-releases are skipped by "Check for updates": use them to stage a release.)

The app only offers this update once the release is published as the latest one.
`,
		tag, filepath.ToSlash(exePath), filepath.ToSlash(manifestPath), options.version, filepath.ToSlash(options.notesPath),
		updates.GitHubRepo, tag, options.version, options.notesPath, exePath, manifestPath)
}
