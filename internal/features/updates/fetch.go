// Fetching the signed manifest from GitHub (the check). It only ever runs because someone
// clicked "Check for updates": nothing in this package starts a timer or a request by itself.
package updates

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
)

// maxRedirects is how many redirects one request may follow. GitHub uses two or three
// (latest -> tag -> download host).
const maxRedirects = 5

// errRedirectNotAllowed is what the HTTP client's redirect check returns for an address that
// isn't on the allowlist.
var errRedirectNotAllowed = errors.New("redirect to a host that is not allowed")

// Source is where releases are fetched from: a base URL, the hosts allowed, and how to talk to them.
type Source struct {
	Base      string       // https://github.com/<repo>, or STM_UPDATES_BASE
	Hosts     AllowedHosts // GitHub's hosts, plus the test base's host
	Client    *http.Client // follows redirects only to allowed hosts (see NewHTTPClient)
	UserAgent string
}

// NewSource builds a Source for a base URL with a client that follows redirects only to the
// allowed hosts.
func NewSource(base, userAgent string) Source {
	hosts := HostsFor(base)
	return Source{Base: base, Hosts: hosts, Client: NewHTTPClient(hosts), UserAgent: userAgent}
}

// NewHTTPClient returns a client that refuses to follow a redirect to any host that is not
// allowed (and to plain HTTP, except for the test host). It has no overall timeout because a
// download can take a while; callers pass a context with a deadline instead.
func NewHTTPClient(hosts AllowedHosts) *http.Client {
	return &http.Client{
		CheckRedirect: func(next *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return fmt.Errorf("stopped after %d redirects", maxRedirects)
			}
			if !hosts.Allows(next.URL) {
				return errRedirectNotAllowed
			}
			return nil
		},
	}
}

// get starts a GET to an allowed address and returns the response (the caller closes the body).
func (source Source) get(ctx context.Context, address string) (*http.Response, error) {
	parsed, err := url.Parse(address)
	if err != nil || !source.Hosts.Allows(parsed) {
		return nil, errRedirectNotAllowed
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", source.UserAgent)
	return source.Client.Do(request)
}

// FetchManifest downloads latest.json of the latest release and checks it: the size cap,
// the signature (against publicKey), then the fields. Errors are *Error values.
func (source Source) FetchManifest(ctx context.Context, publicKey ed25519.PublicKey) (Manifest, error) {
	response, err := source.get(ctx, ManifestURL(source.Base))
	if err != nil {
		return Manifest{}, classifyNetworkError(err)
	}
	defer response.Body.Close()

	if response.StatusCode == http.StatusNotFound {
		return Manifest{}, errNoRelease()
	}
	if response.StatusCode != http.StatusOK {
		return Manifest{}, errGitHubUnreachable(fmt.Sprintf("HTTP %d", response.StatusCode))
	}
	if response.ContentLength > MaxManifestBytes {
		return Manifest{}, errManifestTooLarge()
	}
	// Read one byte more than the cap, so "exactly at the cap" and "over it" can be told apart.
	body, err := io.ReadAll(io.LimitReader(response.Body, MaxManifestBytes+1))
	if err != nil {
		return Manifest{}, classifyNetworkError(err)
	}
	return checkManifestBody(body, publicKey)
}

// checkManifestBody is everything that decides whether a manifest can be trusted, in order:
// size, readable JSON, signature, then plausible fields.
func checkManifestBody(body []byte, publicKey ed25519.PublicKey) (Manifest, error) {
	if len(body) > MaxManifestBytes {
		return Manifest{}, errManifestTooLarge()
	}
	var manifest Manifest
	if err := json.Unmarshal(body, &manifest); err != nil {
		return Manifest{}, errBadManifest("not readable")
	}
	if !VerifySignature(manifest, publicKey) {
		return Manifest{}, errBadSignature()
	}
	if err := ValidateManifest(manifest); err != nil {
		return Manifest{}, errBadManifest(err.Error())
	}
	return manifest, nil
}

// classifyNetworkError turns what the HTTP client reported into an *Error for the user.
func classifyNetworkError(err error) error {
	var apiError *Error
	if errors.As(err, &apiError) {
		return apiError
	}
	if errors.Is(err, errRedirectNotAllowed) {
		return errRedirectRefused()
	}
	if errors.Is(err, context.Canceled) {
		return errCancelled()
	}
	var dnsError *net.DNSError
	if errors.As(err, &dnsError) {
		return errNoInternet()
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return errGitHubUnreachable("it took too long to answer")
	}
	return errGitHubUnreachable("")
}
