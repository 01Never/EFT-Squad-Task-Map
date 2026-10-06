// The errors a check, download or install can end in. Each has a stable code for the page and a
// plain-language message to show as is (the wording comes from ticket 04c).
package updates

import "fmt"

// Error codes (the page can switch on these; the message is what to show).
const (
	CodeNoPublicKey       = "no-public-key"       // this build has no owner key yet
	CodeNoInternet        = "no-internet"         // the name lookup failed
	CodeGitHubUnreachable = "github-unreachable"  // connection failed, timed out, or GitHub answered an error
	CodeNoRelease         = "no-release"          // 404 on the latest-release address
	CodeBadSignature      = "bad-signature"       // the manifest isn't signed by the owner
	CodeBadManifest       = "bad-manifest"        // unreadable or implausible manifest
	CodeManifestTooLarge  = "manifest-too-large"  // over 64 KB
	CodeOlderVersion      = "older-version"       // the release is older than this copy
	CodeRedirectRefused   = "redirect-refused"    // a redirect to a host that isn't allowed
	CodeBadHash           = "bad-hash"            // the download's SHA-256 differs from the manifest
	CodeBadSize           = "bad-size"            // the download's size differs from the manifest
	CodeDownloadFailed    = "download-failed"     // network trouble or a write error while downloading
	CodeDevBuild          = "dev-build"           // running under `go run`, not an installed exe
	CodeFolderNotWritable = "folder-not-writable" // can't write next to the exe
	CodeCancelled         = "cancelled"           // the user cancelled (not an error to show)
	CodeBusy              = "busy"                // another step is running
	CodeNothingToApply    = "nothing-to-apply"    // apply without a verified download
	CodeStale             = "stale"               // the page asked for a version that isn't the checked one
	CodeApplyFailed       = "apply-failed"        // backup, rename or start failed; the old copy is kept
)

// Error is a refusal or failure with a code and a message for the user.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	// ReleaseURL is set when "download it from GitHub instead" helps: the release's page.
	ReleaseURL string `json:"releaseUrl,omitempty"`
}

// Error returns the message.
func (e *Error) Error() string { return e.Message }

func errNoPublicKey() *Error {
	return &Error{Code: CodeNoPublicKey, Message: "This copy can't check for updates yet: it has no owner key built in."}
}

func errNoInternet() *Error {
	return &Error{Code: CodeNoInternet, Message: "No internet connection. Check it and try again."}
}

func errGitHubUnreachable(detail string) *Error {
	message := "Couldn't reach GitHub. Try again in a few minutes."
	if detail != "" {
		message = fmt.Sprintf("Couldn't reach GitHub (%s). Try again in a few minutes.", detail)
	}
	return &Error{Code: CodeGitHubUnreachable, Message: message}
}

func errNoRelease() *Error {
	return &Error{Code: CodeNoRelease, Message: "No release has been published yet."}
}

func errBadSignature() *Error {
	return &Error{Code: CodeBadSignature, Message: "This update isn't from the owner; not installed."}
}

func errBadManifest(detail string) *Error {
	return &Error{Code: CodeBadManifest, Message: "The update information on GitHub isn't valid (" + detail + "); nothing was installed."}
}

func errManifestTooLarge() *Error {
	return &Error{Code: CodeManifestTooLarge, Message: "The update information on GitHub is far bigger than it should be; ignored."}
}

func errOlderVersion(current, latest string) *Error {
	return &Error{Code: CodeOlderVersion, Message: fmt.Sprintf("The latest release (%s) is older than the version you're running (%s), so there's nothing to install.", latest, current)}
}

func errRedirectRefused() *Error {
	return &Error{Code: CodeRedirectRefused, Message: "GitHub sent the download to an address that isn't allowed; refused."}
}

func errBadHash() *Error {
	return &Error{Code: CodeBadHash, Message: "The downloaded file doesn't match what the owner published; not installed."}
}

func errBadSize() *Error {
	return &Error{Code: CodeBadSize, Message: "The downloaded file is not the size the owner published; not installed."}
}

func errDownloadFailed(detail string) *Error {
	return &Error{Code: CodeDownloadFailed, Message: "The download failed (" + detail + "). Nothing was changed."}
}

func errDevBuild() *Error {
	return &Error{Code: CodeDevBuild, Message: "Updates only apply to the built exe."}
}

func errFolderNotWritable(releaseURL string) *Error {
	return &Error{Code: CodeFolderNotWritable, Message: "Couldn't update here. Download it from GitHub instead.", ReleaseURL: releaseURL}
}

func errBusy() *Error {
	return &Error{Code: CodeBusy, Message: "An update step is already running."}
}

// errCancelled is not shown as a failure: Cancel puts the page back to where it was.
func errCancelled() *Error {
	return &Error{Code: CodeCancelled, Message: "Cancelled."}
}

func errNothingToApply() *Error {
	return &Error{Code: CodeNothingToApply, Message: "There's no downloaded update to install. Check for updates first."}
}

func errStale() *Error {
	return &Error{Code: CodeStale, Message: "That version is no longer the one found by the last check. Check for updates again."}
}

func errApplyFailed(detail string) *Error {
	return &Error{Code: CodeApplyFailed, Message: detail}
}
