package updates

import (
	"net/url"
	"strings"
	"testing"
)

func sampleManifest() Manifest {
	return Manifest{
		Version:  "2.6.0",
		Released: "2026-10-20",
		Notes:    "• Check for updates <now> & more\nSecond line",
		File:     FileInfo{Name: ExeFileName, Size: 12582912, SHA256: strings.Repeat("ab", 32)},
	}
}

func TestTheSignedBytesAreTheManifestWithoutItsSignatureInAFixedOrder(t *testing.T) {
	manifest := sampleManifest()
	manifest.Signature = "anything: it is not part of what is signed"

	want := `{"version":"2.6.0","released":"2026-10-20","notes":"• Check for updates <now> & more\nSecond line",` +
		`"file":{"name":"SquadTaskMap.exe","size":12582912,"sha256":"` + strings.Repeat("ab", 32) + `"}}`
	if got := string(CanonicalBytes(manifest)); got != want {
		t.Fatalf("canonical bytes:\n got  %s\n want %s", got, want)
	}
}

func TestAManifestSignedWithTheOwnersKeyVerifies(t *testing.T) {
	publicKey, privateKey := testKeys(t)
	signed := SignManifest(sampleManifest(), privateKey)

	if !VerifySignature(signed, publicKey) {
		t.Fatal("a manifest signed with the matching private key must verify")
	}
}

func TestAnyChangeToASignedFieldBreaksTheSignature(t *testing.T) {
	publicKey, privateKey := testKeys(t)
	signed := SignManifest(sampleManifest(), privateKey)

	tests := []struct {
		name   string
		change func(*Manifest)
	}{
		{"the version", func(m *Manifest) { m.Version = "2.6.1" }},
		{"the release date", func(m *Manifest) { m.Released = "2026-10-21" }},
		{"the notes", func(m *Manifest) { m.Notes += " " }},
		{"the file name", func(m *Manifest) { m.File.Name = "Other.exe" }},
		{"the file size", func(m *Manifest) { m.File.Size++ }},
		{"the file hash", func(m *Manifest) { m.File.SHA256 = strings.Repeat("cd", 32) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tampered := signed
			test.change(&tampered)
			if VerifySignature(tampered, publicKey) {
				t.Fatalf("changing %s must break the signature", test.name)
			}
		})
	}
}

func TestASignatureFromAnotherKeyOrNoSignatureIsRefused(t *testing.T) {
	publicKey, _ := testKeys(t)
	_, strangerKey := testKeys(t)

	tests := []struct {
		name      string
		signature string
	}{
		{"signed by someone else", SignManifest(sampleManifest(), strangerKey).Signature},
		{"no signature", ""},
		{"not base64", "!!!not base64!!!"},
		{"too short", "AAAA"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			manifest := sampleManifest()
			manifest.Signature = test.signature
			if VerifySignature(manifest, publicKey) {
				t.Fatal("must be refused")
			}
		})
	}
}

func TestOnlyWellFormedPublicKeysAreAccepted(t *testing.T) {
	publicKey, _ := testKeys(t)
	if _, err := ParsePublicKey(publicKeyText(publicKey)); err != nil {
		t.Fatalf("a real key must parse: %v", err)
	}
	for _, bad := range []string{"", EmbeddedPublicKey, "AAAA", "not base64!"} {
		if _, err := ParsePublicKey(bad); err == nil {
			t.Errorf("%q must not parse as a public key", bad)
		}
	}
}

func TestManifestFieldsAreChecked(t *testing.T) {
	tests := []struct {
		name    string
		change  func(*Manifest)
		isValid bool
	}{
		{"a normal manifest", func(m *Manifest) {}, true},
		{"a version with a v in front", func(m *Manifest) { m.Version = "v2.6.0" }, false},
		{"a version with two numbers", func(m *Manifest) { m.Version = "2.6" }, false},
		{"another file name", func(m *Manifest) { m.File.Name = "evil.exe" }, false},
		{"a file name with a folder", func(m *Manifest) { m.File.Name = "../SquadTaskMap.exe" }, false},
		{"size zero", func(m *Manifest) { m.File.Size = 0 }, false},
		{"a size over 200 MB", func(m *Manifest) { m.File.Size = MaxAnnouncedExeBytes + 1 }, false},
		{"upper-case hex", func(m *Manifest) { m.File.SHA256 = strings.Repeat("AB", 32) }, false},
		{"a short hash", func(m *Manifest) { m.File.SHA256 = "abcd" }, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			manifest := sampleManifest()
			test.change(&manifest)
			err := ValidateManifest(manifest)
			if (err == nil) != test.isValid {
				t.Fatalf("ValidateManifest = %v, want valid=%v", err, test.isValid)
			}
		})
	}
}

func TestVersionsCompareNumberByNumberNotAsText(t *testing.T) {
	tests := []struct {
		name        string
		left, right string
		want        int
	}{
		{"equal", "2.6.0", "2.6.0", 0},
		{"a newer patch", "2.6.1", "2.6.0", 1},
		{"a newer minor beats a bigger patch", "2.7.0", "2.6.9", 1},
		{"a newer major", "3.0.0", "2.99.99", 1},
		{"ten is bigger than nine", "2.10.0", "2.9.0", 1},
		{"older", "2.5.9", "2.6.0", -1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			left, _ := ParseVersion(test.left)
			right, _ := ParseVersion(test.right)
			if got := left.Compare(right); got != test.want {
				t.Fatalf("%s vs %s = %d, want %d", test.left, test.right, got, test.want)
			}
		})
	}
}

func TestOnlyPlainThreeNumberVersionsParse(t *testing.T) {
	for _, bad := range []string{"", "2", "2.6", "2.6.0.1", "v2.6.0", "2.6.0-beta", "2.06.0", "2.-1.0", "a.b.c"} {
		if _, err := ParseVersion(bad); err == nil {
			t.Errorf("%q must not parse", bad)
		}
	}
}

func TestOnlyANewerReleaseIsOffered(t *testing.T) {
	tests := []struct {
		name        string
		current     string
		latest      string
		wantResult  string
		wantErrCode string
	}{
		{"a newer release is available", "2.5.0", "2.6.0", ResultAvailable, ""},
		{"the same version is up to date", "2.6.0", "2.6.0", ResultUpToDate, ""},
		{"an older release is refused: no downgrades", "2.6.0", "2.5.0", "", CodeOlderVersion},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			manifest := sampleManifest()
			manifest.Version = test.latest
			result, err := DecideResult(test.current, manifest)
			if result != test.wantResult {
				t.Fatalf("result = %q, want %q", result, test.wantResult)
			}
			if test.wantErrCode == "" && err != nil {
				t.Fatalf("unexpected error %v", err)
			}
			if test.wantErrCode != "" {
				apiError, _ := err.(*Error)
				if apiError == nil || apiError.Code != test.wantErrCode {
					t.Fatalf("error = %v, want code %s", err, test.wantErrCode)
				}
			}
		})
	}
}

func TestAddressesAreDerivedFromTheRepository(t *testing.T) {
	base := ResolveBase("")
	if base != "https://github.com/01Never/EFT-Squad-Task-Map" {
		t.Fatalf("base = %s", base)
	}
	if got, want := ManifestURL(base), "https://github.com/01Never/EFT-Squad-Task-Map/releases/latest/download/latest.json"; got != want {
		t.Errorf("manifest URL = %s, want %s", got, want)
	}
	if got, want := ExeURL(base, "2.6.0"), "https://github.com/01Never/EFT-Squad-Task-Map/releases/download/v2.6.0/SquadTaskMap.exe"; got != want {
		t.Errorf("exe URL = %s, want %s", got, want)
	}
	if got, want := ReleasePageURL(base, "2.6.0"), "https://github.com/01Never/EFT-Squad-Task-Map/releases/tag/v2.6.0"; got != want {
		t.Errorf("release page = %s, want %s", got, want)
	}
	if got := ResolveBase(" http://127.0.0.1:7820/github/ "); got != "http://127.0.0.1:7820/github" {
		t.Errorf("an override loses its trailing slash, got %s", got)
	}
}

func TestOnlyGitHubsHostsOverHTTPSAreAllowed(t *testing.T) {
	github := HostsFor(DefaultBaseURL)
	tests := []struct {
		address string
		want    bool
	}{
		{"https://github.com/x/y/releases/latest/download/latest.json", true},
		{"https://objects.githubusercontent.com/abc", true},
		{"https://release-assets.githubusercontent.com/abc", true},
		{"http://github.com/x", false},
		{"https://evil.example.com/latest.json", false},
		{"https://github.com.evil.example.com/latest.json", false},
		{"https://githubusercontent.com/abc", false},
		{"https://127.0.0.1:7820/x", false},
		{"ftp://github.com/x", false},
	}
	for _, test := range tests {
		t.Run(test.address, func(t *testing.T) {
			target, _ := url.Parse(test.address)
			if got := github.Allows(target); got != test.want {
				t.Fatalf("Allows(%s) = %v, want %v", test.address, got, test.want)
			}
		})
	}
}

func TestATestBaseAddsOnlyItsOwnHost(t *testing.T) {
	hosts := HostsFor("http://127.0.0.1:7820/github/repo")
	tests := []struct {
		address string
		want    bool
	}{
		{"http://127.0.0.1:7820/objects/x", true},
		{"https://github.com/x", true},
		{"http://127.0.0.1:7821/objects/x", false}, // another port is another host
		{"http://localhost:7820/objects/x", false},
	}
	for _, test := range tests {
		target, _ := url.Parse(test.address)
		if got := hosts.Allows(target); got != test.want {
			t.Errorf("Allows(%s) = %v, want %v", test.address, got, test.want)
		}
	}
}

func TestTheExeMayBeTenPercentBiggerThanAnnounced(t *testing.T) {
	if got := MaxExeBytes(1000); got != 1100 {
		t.Fatalf("MaxExeBytes(1000) = %d, want 1100", got)
	}
}

func TestKeysSurviveBeingWrittenAndReadBack(t *testing.T) {
	publicKey, privateKey := testKeys(t)

	readPrivate, err := ParsePrivateKey(EncodeKey(privateKey) + "\n")
	if err != nil || !readPrivate.Equal(privateKey) {
		t.Fatalf("private key round trip: %v", err)
	}
	readPublic, err := ParsePublicKey(EncodeKey(publicKey))
	if err != nil || !readPublic.Equal(publicKey) {
		t.Fatalf("public key round trip: %v", err)
	}
	if _, err := ParsePrivateKey(EncodeKey(publicKey)); err == nil {
		t.Fatal("a public key is not a private key")
	}
}

func TestTheOldVersionIsReadFromTheCommandLine(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want string
	}{
		{"started by an update", []string{"--updated-from=2.5.0"}, "2.5.0"},
		{"among other arguments", []string{"-x", "--updated-from=2.5.0", "y"}, "2.5.0"},
		{"a normal start", nil, ""},
	}
	for _, test := range tests {
		if got := UpdatedFromArgument(test.args); got != test.want {
			t.Errorf("%s: got %q, want %q", test.name, got, test.want)
		}
	}
}
