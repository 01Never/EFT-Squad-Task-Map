package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"squadtaskmap/internal/features/updates"
)

// fakeRepo writes the three files that hold the version, all saying `version`.
func fakeRepo(t *testing.T, version string) string {
	t.Helper()
	root := t.TempDir()
	write := func(path, text string) {
		full := filepath.Join(root, path)
		os.MkdirAll(filepath.Dir(full), 0o755)
		if err := os.WriteFile(full, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("internal/app/run.go", "package app\n\n// Version is the app's version.\nconst Version = \""+version+"\"\n")
	write("package.json", `{"name":"x","version":"`+version+`"}`)
	write("winres/winres.json", `{"RT_VERSION":{"#1":{"0000":{
		"fixed":{"file_version":"`+version+`.0","product_version":"`+version+`.0"},
		"info":{"0409":{"FileVersion":"`+version+`","ProductVersion":"`+version+`"}}}}}}`)
	return root
}

func TestTheVersionMustBeTheSameInEveryFileBeforeReleasing(t *testing.T) {
	root := fakeRepo(t, "2.6.0")
	found, err := readProjectVersions(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := checkVersionsMatch("2.6.0", found); err != nil {
		t.Fatalf("matching versions: %v", err)
	}

	err = checkVersionsMatch("2.7.0", found)
	if err == nil {
		t.Fatal("a version that isn't in the files must be refused")
	}
	for _, place := range []string{"run.go", "package.json", "file_version", "product_version", "FileVersion", "ProductVersion"} {
		if !strings.Contains(err.Error(), place) {
			t.Errorf("the message should name %s: %v", place, err)
		}
	}
}

func TestOneFileLeftBehindIsNamed(t *testing.T) {
	root := fakeRepo(t, "2.6.0")
	os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"version":"2.5.0"}`), 0o644)

	found, _ := readProjectVersions(root)
	err := checkVersionsMatch("2.6.0", found)

	if err == nil || !strings.Contains(err.Error(), "package.json version is \"2.5.0\"") || strings.Contains(err.Error(), "run.go") {
		t.Fatalf("error = %v", err)
	}
}

func TestMissingVersionFilesAreReported(t *testing.T) {
	if _, err := readProjectVersions(t.TempDir()); err == nil {
		t.Fatal("an empty folder is not the repo root")
	}
}

func TestKeyGenerationWritesAPrivateFileAndPrintsThePublicKeyAsAConstant(t *testing.T) {
	keyPath := filepath.Join(t.TempDir(), "keys", "release-private-key.txt")
	var output bytes.Buffer

	if err := run([]string{"-init-keys", "-key-out", keyPath}, &output); err != nil {
		t.Fatalf("-init-keys: %v", err)
	}

	privateKey, err := loadPrivateKey(keyPath)
	if err != nil {
		t.Fatalf("the written key must load: %v", err)
	}
	wantLine := `const EmbeddedPublicKey = "` + updates.EncodeKey(privateKey.Public().(ed25519.PublicKey)) + `"`
	if !strings.Contains(output.String(), wantLine) {
		t.Fatalf("output should contain %s:\n%s", wantLine, output.String())
	}
	if !strings.Contains(output.String(), keyPath) || !strings.Contains(output.String(), "STM_RELEASE_KEY") {
		t.Fatalf("output should say where the key is and how to use it:\n%s", output.String())
	}
	if info, _ := os.Stat(keyPath); info.Mode().Perm() != 0o600 && os.PathSeparator == '/' {
		t.Fatalf("the private key must be readable by its owner only, mode is %v", info.Mode().Perm())
	}
}

func TestAnExistingKeyIsNeverOverwritten(t *testing.T) {
	keyPath := filepath.Join(t.TempDir(), "key.txt")
	os.WriteFile(keyPath, []byte("precious"), 0o600)

	err := run([]string{"-init-keys", "-key-out", keyPath}, &bytes.Buffer{})

	if err == nil || !strings.Contains(err.Error(), "not overwriting") {
		t.Fatalf("error = %v", err)
	}
	if data, _ := os.ReadFile(keyPath); string(data) != "precious" {
		t.Fatal("the existing key was changed")
	}
}

func TestTheKeyMustBeTheOneBuiltIntoTheApp(t *testing.T) {
	publicKey, privateKey, _ := ed25519.GenerateKey(nil)
	otherPublicKey, _, _ := ed25519.GenerateKey(nil)
	tests := []struct {
		name     string
		appKey   string
		wantFail string // "" means accepted
	}{
		{"the app has the matching public key", updates.EncodeKey(publicKey), ""},
		{"the app still has the placeholder", "TODO-paste-the-public-key-printed-by-cmd-release-init-keys", "no public key yet"},
		{"the app has another owner's key", updates.EncodeKey(otherPublicKey), "doesn't match the public key built into the app"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			appPublicKey = test.appKey
			t.Cleanup(func() { appPublicKey = updates.EmbeddedPublicKey })

			err := checkKeyMatchesApp(privateKey)
			if test.wantFail == "" && err != nil {
				t.Fatalf("unexpected: %v", err)
			}
			if test.wantFail != "" && (err == nil || !strings.Contains(err.Error(), test.wantFail)) {
				t.Fatalf("error = %v, want %q", err, test.wantFail)
			}
		})
	}
}

func TestTheNotesAreReadWithUnixLineEndingsAndMustNotBeEmpty(t *testing.T) {
	folder := t.TempDir()
	notesPath := filepath.Join(folder, "notes.md")
	os.WriteFile(notesPath, []byte("• One\r\n• Two\r\n\r\n"), 0o644)
	notes, err := readNotes(notesPath)
	if err != nil || notes != "• One\n• Two" {
		t.Fatalf("notes = %q, %v", notes, err)
	}

	os.WriteFile(notesPath, []byte("  \n"), 0o644)
	if _, err := readNotes(notesPath); err == nil {
		t.Fatal("empty notes must be refused")
	}
}

func TestTheSignedManifestDescribesTheExeAndVerifiesWithTheAppsFunctions(t *testing.T) {
	publicKey, privateKey, _ := ed25519.GenerateKey(nil)
	exePath := filepath.Join(t.TempDir(), "SquadTaskMap.exe")
	exe := []byte("pretend this is an exe")
	os.WriteFile(exePath, exe, 0o644)

	manifest, err := buildSignedManifest("2.6.0", "2026-10-20", "• Notes", exePath, privateKey)
	if err != nil {
		t.Fatal(err)
	}

	sum := sha256.Sum256(exe)
	if manifest.File.Size != int64(len(exe)) || manifest.File.Name != "SquadTaskMap.exe" || manifest.File.SHA256 != hex.EncodeToString(sum[:]) {
		t.Fatalf("file = %+v", manifest.File)
	}
	if !updates.VerifySignature(manifest, publicKey) {
		t.Fatal("the app's verify function must accept what the tool signed")
	}
}

func TestAnUnbuildableManifestIsNotWritten(t *testing.T) {
	_, privateKey, _ := ed25519.GenerateKey(nil)
	empty := filepath.Join(t.TempDir(), "SquadTaskMap.exe")
	os.WriteFile(empty, nil, 0o644)

	if _, err := buildSignedManifest("2.6.0", "2026-10-20", "notes", empty, privateKey); err == nil {
		t.Fatal("an empty exe would be refused by the app, so the tool refuses it first")
	}
	if _, err := buildSignedManifest("2.6.0", "2026-10-20", "notes", filepath.Join(t.TempDir(), "missing.exe"), privateKey); err == nil {
		t.Fatal("a missing exe must be reported")
	}
}

func TestAFullReleaseWritesTheExeManifestAndPrintsBothWaysToPublish(t *testing.T) {
	root := fakeRepo(t, "2.6.0")
	folder := t.TempDir()
	exePath := filepath.Join(folder, "prebuilt.exe")
	os.WriteFile(exePath, []byte("exe bytes"), 0o644)
	notesPath := filepath.Join(folder, "notes.md")
	os.WriteFile(notesPath, []byte("• Check for updates\r\n"), 0o644)
	outDir := filepath.Join(folder, "dist")
	publicKey, privateKey, _ := ed25519.GenerateKey(nil)
	keyPath := filepath.Join(folder, "key.txt")
	os.WriteFile(keyPath, []byte(updates.EncodeKey(privateKey)), 0o600)
	t.Setenv("STM_RELEASE_KEY", keyPath)
	appPublicKey = updates.EncodeKey(publicKey)
	t.Cleanup(func() { appPublicKey = updates.EmbeddedPublicKey })
	var output bytes.Buffer

	err := publish(options{
		version: "2.6.0", notesPath: notesPath, root: root, outDir: outDir, date: "2026-10-20",
		skipTests: true, skipBuild: true, exePath: exePath,
	}, &output)
	if err != nil {
		t.Fatalf("publish: %v\n%s", err, output.String())
	}

	// What the app would download from GitHub must pass the app's own checks.
	data, err := os.ReadFile(filepath.Join(outDir, "latest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var published updates.Manifest
	if err := json.Unmarshal(data, &published); err != nil {
		t.Fatal(err)
	}
	if !updates.VerifySignature(published, publicKey) || updates.ValidateManifest(published) != nil {
		t.Fatalf("latest.json must pass the app's checks: %s", data)
	}
	if published.Version != "2.6.0" || published.Released != "2026-10-20" || published.Notes != "• Check for updates" {
		t.Fatalf("manifest = %+v", published)
	}
	for _, want := range []string{
		`gh release create v2.6.0`,
		"--notes-file " + filepath.ToSlash(notesPath),
		"https://github.com/01Never/EFT-Squad-Task-Map/releases/new",
		"pre-release",
	} {
		if !strings.Contains(output.String(), want) {
			t.Errorf("output should contain %q:\n%s", want, output.String())
		}
	}
}

func TestAReleaseWithTheWrongKeyWritesNothing(t *testing.T) {
	root := fakeRepo(t, "2.6.0")
	folder := t.TempDir()
	notesPath := filepath.Join(folder, "notes.md")
	os.WriteFile(notesPath, []byte("notes"), 0o644)
	_, privateKey, _ := ed25519.GenerateKey(nil)
	keyPath := filepath.Join(folder, "key.txt")
	os.WriteFile(keyPath, []byte(updates.EncodeKey(privateKey)), 0o600)
	t.Setenv("STM_RELEASE_KEY", keyPath)
	outDir := filepath.Join(folder, "dist")

	err := publish(options{version: "2.6.0", notesPath: notesPath, root: root, outDir: outDir, skipTests: true, skipBuild: true}, &bytes.Buffer{})

	if err == nil || !strings.Contains(err.Error(), "public key") {
		t.Fatalf("error = %v", err)
	}
	if _, statErr := os.Stat(outDir); statErr == nil {
		t.Fatal("nothing may be written when the key check fails")
	}
}

func TestAReleaseStopsBeforeBuildingWhenTheVersionsDisagree(t *testing.T) {
	root := fakeRepo(t, "2.5.0") // the files still say 2.5.0
	err := publish(options{version: "2.6.0", root: root, outDir: filepath.Join(t.TempDir(), "dist")}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "isn't 2.6.0 everywhere") {
		t.Fatalf("error = %v", err)
	}
}

func TestTheFlagsAreChecked(t *testing.T) {
	tests := []struct {
		name string
		args []string
		fail string
	}{
		{"no version", []string{"-notes", "n.md"}, "-version and -notes are required"},
		{"no notes", []string{"-version", "2.6.0"}, "-version and -notes are required"},
		{"a version with a v", []string{"-version", "v2.6.0", "-notes", "n.md"}, "-version"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := parseFlags(test.args, &bytes.Buffer{})
			if err == nil || !strings.Contains(err.Error(), test.fail) {
				t.Fatalf("error = %v, want %q", err, test.fail)
			}
		})
	}
}
