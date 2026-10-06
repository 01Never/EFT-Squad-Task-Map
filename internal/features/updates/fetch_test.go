package updates

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func errorCode(err error) string {
	if apiError, isAPIError := err.(*Error); isAPIError {
		return apiError.Code
	}
	if err == nil {
		return ""
	}
	return "not an *Error: " + err.Error()
}

func TestTheLatestManifestIsFetchedThroughGitHubsRedirects(t *testing.T) {
	publicKey, privateKey := testKeys(t)
	github := newFakeGitHub(t)
	published := github.publish(privateKey, "2.6.0", fakeExe(1000))

	manifest, err := github.testSource().FetchManifest(context.Background(), publicKey)
	if err != nil {
		t.Fatalf("FetchManifest: %v", err)
	}
	if manifest.Version != "2.6.0" || manifest.File != published.File || manifest.Notes != published.Notes {
		t.Fatalf("got %+v, want %+v", manifest, published)
	}
	// latest.json -> /releases/download/v2.6.0/latest.json -> the download host: three requests.
	if got := github.requestCount(); got != 3 {
		t.Fatalf("%d requests, want 3 (the address and its two redirects)", got)
	}
}

func TestNoReleaseYetIsNotAnError(t *testing.T) {
	publicKey, _ := testKeys(t)
	github := newFakeGitHub(t) // nothing published: GitHub answers 404

	_, err := github.testSource().FetchManifest(context.Background(), publicKey)
	if errorCode(err) != CodeNoRelease {
		t.Fatalf("error = %v, want code %s", err, CodeNoRelease)
	}
	if !strings.Contains(err.Error(), "No release has been published yet") {
		t.Fatalf("message = %q", err.Error())
	}
}

func TestAManifestThatIsNotFromTheOwnerIsRefused(t *testing.T) {
	publicKey, _ := testKeys(t)
	_, strangerKey := testKeys(t)
	github := newFakeGitHub(t)
	github.publish(strangerKey, "2.6.0", fakeExe(1000))

	_, err := github.testSource().FetchManifest(context.Background(), publicKey)
	if errorCode(err) != CodeBadSignature {
		t.Fatalf("error = %v, want code %s", err, CodeBadSignature)
	}
	if err.Error() != "This update isn't from the owner; not installed." {
		t.Fatalf("message = %q", err.Error())
	}
}

func TestAManifestEditedAfterSigningIsRefused(t *testing.T) {
	publicKey, privateKey := testKeys(t)
	github := newFakeGitHub(t)
	manifest := github.publish(privateKey, "2.6.0", fakeExe(1000))
	manifest.File.SHA256 = strings.Repeat("0", 64) // an attacker points at another exe
	github.manifestJSON, _ = json.Marshal(manifest)

	_, err := github.testSource().FetchManifest(context.Background(), publicKey)
	if errorCode(err) != CodeBadSignature {
		t.Fatalf("error = %v, want code %s", err, CodeBadSignature)
	}
}

func TestBadManifestsAreRefusedWithAClearCode(t *testing.T) {
	publicKey, privateKey := testKeys(t)

	signedWith := func(change func(*Manifest)) []byte {
		manifest := signedManifest(privateKey, "2.6.0", fakeExe(1000))
		change(&manifest)
		manifest = SignManifest(manifest, privateKey) // signed by the owner, but implausible
		data, _ := json.Marshal(manifest)
		return data
	}
	tests := []struct {
		name     string
		body     []byte
		wantCode string
	}{
		{"not JSON at all", []byte("<html>not json</html>"), CodeBadManifest},
		{"a file with the wrong name", signedWith(func(m *Manifest) { m.File.Name = "Other.exe" }), CodeBadManifest},
		{"a version that isn't major.minor.patch", signedWith(func(m *Manifest) { m.Version = "latest" }), CodeBadManifest},
		{"bigger than 64 KB", []byte(strings.Repeat("x", MaxManifestBytes+1)), CodeManifestTooLarge},
		{"exactly 64 KB of junk is read, then refused as unreadable", []byte(strings.Repeat("x", MaxManifestBytes)), CodeBadManifest},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			github := newFakeGitHub(t)
			github.publish(privateKey, "2.6.0", fakeExe(1000))
			github.manifestJSON = test.body

			_, err := github.testSource().FetchManifest(context.Background(), publicKey)
			if errorCode(err) != test.wantCode {
				t.Fatalf("error = %v, want code %s", err, test.wantCode)
			}
		})
	}
}

func TestARedirectToAHostThatIsNotAllowedIsRefused(t *testing.T) {
	publicKey, privateKey := testKeys(t)
	github := newFakeGitHub(t)
	github.publish(privateKey, "2.6.0", fakeExe(1000))
	// Same server, but "localhost" instead of the allowed "127.0.0.1:port": another host.
	otherHost := strings.Replace(github.server.URL, "127.0.0.1", "localhost", 1)
	github.manifestRedirectTo = otherHost + "/objects/2.6.0/latest.json"

	_, err := github.testSource().FetchManifest(context.Background(), publicKey)
	if errorCode(err) != CodeRedirectRefused {
		t.Fatalf("error = %v, want code %s", err, CodeRedirectRefused)
	}
}

func TestARedirectToPlainHTTPOnGitHubOrAnyOtherSiteIsRefused(t *testing.T) {
	// With GitHub's real allowlist (no test host), a redirect to http:// or to another site is refused.
	hosts := HostsFor(DefaultBaseURL)
	client := NewHTTPClient(hosts)
	for _, target := range []string{"http://github.com/x", "https://evil.example.com/x"} {
		next, _ := http.NewRequest(http.MethodGet, target, nil)
		if err := client.CheckRedirect(next, nil); err != errRedirectNotAllowed {
			t.Errorf("redirect to %s: got %v, want errRedirectNotAllowed", target, err)
		}
	}
	allowed, _ := http.NewRequest(http.MethodGet, "https://objects.githubusercontent.com/x", nil)
	if err := client.CheckRedirect(allowed, nil); err != nil {
		t.Errorf("redirect to GitHub's download host must be followed, got %v", err)
	}
}

func TestARedirectLoopStops(t *testing.T) {
	client := NewHTTPClient(HostsFor(DefaultBaseURL))
	next, _ := http.NewRequest(http.MethodGet, "https://github.com/x", nil)
	via := make([]*http.Request, maxRedirects)
	if err := client.CheckRedirect(next, via); err == nil {
		t.Fatal("after too many redirects the client must stop")
	}
}

func TestGitHubErrorsAndOutagesAreExplained(t *testing.T) {
	publicKey, privateKey := testKeys(t)

	t.Run("an error page from GitHub", func(t *testing.T) {
		github := newFakeGitHub(t)
		github.publish(privateKey, "2.6.0", fakeExe(1000))
		github.status = http.StatusServiceUnavailable
		_, err := github.testSource().FetchManifest(context.Background(), publicKey)
		if errorCode(err) != CodeGitHubUnreachable || !strings.Contains(err.Error(), "503") {
			t.Fatalf("error = %v", err)
		}
	})
	t.Run("nothing answers", func(t *testing.T) {
		github := newFakeGitHub(t)
		source := github.testSource()
		github.server.Close()
		_, err := source.FetchManifest(context.Background(), publicKey)
		if errorCode(err) != CodeGitHubUnreachable {
			t.Fatalf("error = %v, want code %s", err, CodeGitHubUnreachable)
		}
	})
	t.Run("the check is cancelled", func(t *testing.T) {
		github := newFakeGitHub(t)
		github.publish(privateKey, "2.6.0", fakeExe(1000))
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := github.testSource().FetchManifest(ctx, publicKey)
		if errorCode(err) != CodeCancelled {
			t.Fatalf("error = %v, want code %s", err, CodeCancelled)
		}
	})
}

func TestTheKeyOfAnotherOwnerIsNeverTrusted(t *testing.T) {
	var emptyKey ed25519.PublicKey = make([]byte, ed25519.PublicKeySize)
	_, privateKey := testKeys(t)
	github := newFakeGitHub(t)
	github.publish(privateKey, "2.6.0", fakeExe(1000))

	_, err := github.testSource().FetchManifest(context.Background(), emptyKey)
	if errorCode(err) != CodeBadSignature {
		t.Fatalf("error = %v, want code %s", err, CodeBadSignature)
	}
}
