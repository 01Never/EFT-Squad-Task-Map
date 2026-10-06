// The rules of "Check for updates" (ticket 04c): what the signed manifest is, how it is verified,
// which versions count as newer, which hosts and sizes are accepted, and the addresses used.
// Pure logic: no network, no files. The I/O is in fetch.go, download.go and replace.go.
package updates

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// GitHubRepo is the repository releases are published in. Everything the app downloads is derived
// from it: https://github.com/<repo>/releases/latest/download/latest.json and so on.
// Owner decision (ticket 04c): the update source is this repo's public GitHub Releases.
const GitHubRepo = "01Never/EFT-Squad-Task-Map"

// DefaultBaseURL is where the repository lives. STM_UPDATES_BASE replaces it for tests
// (cmd/mock serves a fake GitHub); see ResolveBase.
const DefaultBaseURL = "https://github.com/" + GitHubRepo

// EmbeddedPublicKey is the Ed25519 public key (base64, 32 bytes) that update manifests must be
// signed with. The matching private key stays on the owner's PC (see docs/HANDOFF.md,
// "Publishing an update").
//
// TODO(owner): paste the key printed by `go run ./cmd/release -init-keys`.
// Until then this is a placeholder, and every check ends with "no-public-key".
const EmbeddedPublicKey = "TODO-paste-the-public-key-printed-by-cmd-release-init-keys"

// Hosts the app may fetch from, over HTTPS only. A GitHub release asset URL answers with a
// redirect to one of the download hosts, so those are allowed too. Anything else is refused.
var allowedHostNames = []string{
	"github.com",
	"objects.githubusercontent.com",
	"release-assets.githubusercontent.com",
}

// Size caps and names.
const (
	// MaxManifestBytes caps latest.json. A real one is under 2 KB; the notes are the only long part.
	MaxManifestBytes = 64 * 1024
	// ExeSizeSlackPercent: the exe may be at most this much larger than the manifest says
	// before the download is cut off (manifest size + 10%). It must still match the size exactly.
	ExeSizeSlackPercent = 10
	// MaxAnnouncedExeBytes: a manifest announcing a bigger exe is not believed (the real one is ~12 MB).
	MaxAnnouncedExeBytes = 200 << 20

	// ExeFileName is the release asset, and the installed exe's name.
	ExeFileName = "SquadTaskMap.exe"
	// ManifestFileName is the signed manifest asset.
	ManifestFileName = "latest.json"
)

// ---------------------------------------------------------------- the manifest

// Manifest is latest.json: what the owner published for one release. The page shows Version,
// Released, Notes and File.Size; the rest is for the checks.
type Manifest struct {
	Version  string   `json:"version"`  // "2.6.0": three numbers, no "v"
	Released string   `json:"released"` // "2026-10-20", shown as is
	Notes    string   `json:"notes"`    // what's new, plain text
	File     FileInfo `json:"file"`
	// Signature is the Ed25519 signature (base64) of CanonicalBytes(manifest).
	Signature string `json:"signature"`
}

// FileInfo describes the exe attached to the release.
type FileInfo struct {
	Name   string `json:"name"`   // always "SquadTaskMap.exe"
	Size   int64  `json:"size"`   // bytes
	SHA256 string `json:"sha256"` // lower-case hex
}

// CanonicalBytes is exactly what is signed: the manifest without its signature, as compact JSON
// with the keys in this order: version, released, notes, file{name, size, sha256}. Characters
// like < > & are written as they are (not <). The release tool and the app both call this
// one function, so they always agree, whatever whitespace or key order latest.json arrives in.
func CanonicalBytes(manifest Manifest) []byte {
	signedPart := struct {
		Version  string   `json:"version"`
		Released string   `json:"released"`
		Notes    string   `json:"notes"`
		File     FileInfo `json:"file"`
	}{manifest.Version, manifest.Released, manifest.Notes, manifest.File}

	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	// Encoding strings and numbers cannot fail.
	_ = encoder.Encode(signedPart)
	return bytes.TrimRight(buffer.Bytes(), "\n")
}

// SignManifest returns the manifest with its Signature filled in (the release tool uses this).
func SignManifest(manifest Manifest, privateKey ed25519.PrivateKey) Manifest {
	signature := ed25519.Sign(privateKey, CanonicalBytes(manifest))
	manifest.Signature = base64.StdEncoding.EncodeToString(signature)
	return manifest
}

// VerifySignature reports whether the manifest was signed by the owner of publicKey.
func VerifySignature(manifest Manifest, publicKey ed25519.PublicKey) bool {
	signature, err := base64.StdEncoding.DecodeString(manifest.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(publicKey, CanonicalBytes(manifest), signature)
}

// ParsePublicKey reads a base64 Ed25519 public key (as printed by `cmd/release -init-keys`).
func ParsePublicKey(text string) (ed25519.PublicKey, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(text))
	if err != nil || len(raw) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("not a base64 Ed25519 public key (%d bytes expected)", ed25519.PublicKeySize)
	}
	return ed25519.PublicKey(raw), nil
}

// ParsePrivateKey reads the owner's private key as `cmd/release -init-keys` writes it: base64 of
// the 64-byte Ed25519 private key, on one line. Only the release tool and the mock use it.
func ParsePrivateKey(text string) (ed25519.PrivateKey, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(text))
	if err != nil || len(raw) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("not a base64 Ed25519 private key (%d bytes expected)", ed25519.PrivateKeySize)
	}
	return ed25519.PrivateKey(raw), nil
}

// EncodeKey writes a public or private key as one line of base64 (the format ParsePublicKey and
// ParsePrivateKey read).
func EncodeKey(key []byte) string { return base64.StdEncoding.EncodeToString(key) }

// ValidateManifest checks the fields the app relies on. Run it after the signature check.
func ValidateManifest(manifest Manifest) error {
	if _, err := ParseVersion(manifest.Version); err != nil {
		return fmt.Errorf("version: %w", err)
	}
	if manifest.File.Name != ExeFileName {
		return fmt.Errorf("file name is %q, expected %q", manifest.File.Name, ExeFileName)
	}
	if manifest.File.Size <= 0 || manifest.File.Size > MaxAnnouncedExeBytes {
		return fmt.Errorf("file size %d is not believable", manifest.File.Size)
	}
	if !isLowerHexSHA256(manifest.File.SHA256) {
		return fmt.Errorf("file sha256 %q is not 64 lower-case hex characters", manifest.File.SHA256)
	}
	return nil
}

func isLowerHexSHA256(text string) bool {
	if len(text) != 64 {
		return false
	}
	for _, character := range text {
		isDigit := character >= '0' && character <= '9'
		isLowerHex := character >= 'a' && character <= 'f'
		if !isDigit && !isLowerHex {
			return false
		}
	}
	return true
}

// ---------------------------------------------------------------- versions

// Version is "major.minor.patch". Pre-releases never reach the app ("latest" skips them on
// GitHub), so there is no suffix.
type Version struct{ Major, Minor, Patch int }

// ParseVersion reads "2.6.0". Anything else (a "v" prefix, two parts, a suffix) is refused.
func ParseVersion(text string) (Version, error) {
	parts := strings.Split(text, ".")
	if len(parts) != 3 {
		return Version{}, fmt.Errorf("%q is not major.minor.patch", text)
	}
	var numbers [3]int
	for index, part := range parts {
		number, err := strconv.Atoi(part)
		isPlainNumber := err == nil && number >= 0 && strconv.Itoa(number) == part
		if !isPlainNumber {
			return Version{}, fmt.Errorf("%q is not major.minor.patch", text)
		}
		numbers[index] = number
	}
	return Version{numbers[0], numbers[1], numbers[2]}, nil
}

// Compare returns -1, 0 or 1 as version is older than, equal to, or newer than other.
func (version Version) Compare(other Version) int {
	mine := [3]int{version.Major, version.Minor, version.Patch}
	theirs := [3]int{other.Major, other.Minor, other.Patch}
	for index := range mine {
		if mine[index] < theirs[index] {
			return -1
		}
		if mine[index] > theirs[index] {
			return 1
		}
	}
	return 0
}

// What a check found.
const (
	ResultUpToDate  = "up-to-date"
	ResultAvailable = "available"
)

// DecideResult compares the signed manifest's version with the running one.
// Only a newer version is offered; the same version is "up to date"; an older one is refused
// (no downgrades through the button).
func DecideResult(currentVersion string, manifest Manifest) (string, error) {
	current, err := ParseVersion(currentVersion)
	if err != nil {
		return "", fmt.Errorf("this copy's version: %w", err)
	}
	latest, err := ParseVersion(manifest.Version)
	if err != nil {
		return "", fmt.Errorf("the release's version: %w", err)
	}
	switch latest.Compare(current) {
	case 1:
		return ResultAvailable, nil
	case 0:
		return ResultUpToDate, nil
	default:
		return "", errOlderVersion(currentVersion, manifest.Version)
	}
}

// ---------------------------------------------------------------- addresses and hosts

// ResolveBase is the repository URL to use: STM_UPDATES_BASE (development only) or the real one,
// without a trailing slash.
func ResolveBase(override string) string {
	base := strings.TrimRight(strings.TrimSpace(override), "/")
	if base == "" {
		return DefaultBaseURL
	}
	return base
}

// ManifestURL is GitHub's stable "latest release" address for latest.json. It is not the REST
// API, so the 60-requests-an-hour limit doesn't apply. "Latest" skips drafts and pre-releases.
func ManifestURL(base string) string {
	return base + "/releases/latest/download/" + ManifestFileName
}

// ExeURL is where the exe of one release is attached.
func ExeURL(base, version string) string {
	return base + "/releases/download/v" + version + "/" + ExeFileName
}

// ReleasePageURL is the release's page on GitHub ("View on GitHub", and the manual fallback).
func ReleasePageURL(base, version string) string {
	return base + "/releases/tag/v" + version
}

// AllowedHosts decides which addresses may be fetched, also after a redirect.
type AllowedHosts struct {
	// testHost is the host (with port) of STM_UPDATES_BASE when it is set; it is allowed over
	// plain HTTP as well, so the mock can run without certificates. Empty in a normal run.
	testHost string
}

// HostsFor builds the allowlist for a base URL: GitHub's hosts, plus the base's own host when
// the base is not GitHub's (STM_UPDATES_BASE).
func HostsFor(base string) AllowedHosts {
	if base == DefaultBaseURL {
		return AllowedHosts{}
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return AllowedHosts{}
	}
	return AllowedHosts{testHost: parsed.Host}
}

// Allows reports whether target may be fetched: HTTPS on an allowlisted host, or the test host.
func (hosts AllowedHosts) Allows(target *url.URL) bool {
	if hosts.testHost != "" && target.Host == hosts.testHost {
		return target.Scheme == "http" || target.Scheme == "https"
	}
	if target.Scheme != "https" {
		return false
	}
	for _, name := range allowedHostNames {
		if target.Hostname() == name {
			return true
		}
	}
	return false
}

// MaxExeBytes is how many bytes of the exe are read before the download is cut off:
// the manifest's size plus 10%.
func MaxExeBytes(manifestSize int64) int64 {
	return manifestSize + manifestSize*ExeSizeSlackPercent/100
}

// UpdatedFromArgument finds "--updated-from=<version>" in the command line. The old copy starts
// the new one with it, so the new copy knows it was just updated (and from what).
func UpdatedFromArgument(args []string) string {
	const prefix = "--updated-from="
	for _, argument := range args {
		if strings.HasPrefix(argument, prefix) {
			return strings.TrimPrefix(argument, prefix)
		}
	}
	return ""
}
