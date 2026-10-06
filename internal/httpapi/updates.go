package httpapi

import (
	"errors"
	"net/http"

	"squadtaskmap/internal/features/updates"
)

// The "Check for updates" routes. Thin: each calls the Updater and writes its answer.
// The contract (requests, answers, error codes, the "updates" event) is in
// internal/features/updates/README.md.

// checkForUpdates asks GitHub for the latest release. It answers when the check is finished.
func (server *Server) checkForUpdates(writer http.ResponseWriter, request *http.Request) {
	status, err := server.backend.Updates().Check(request.Context())
	writeUpdateAnswer(writer, status, err)
}

// downloadUpdate starts the download of the release the last check found and answers at once;
// progress follows as "updates" events. The body may carry {"version": "2.6.0"}, the version
// the page is showing: another one is refused as stale.
func (server *Server) downloadUpdate(writer http.ResponseWriter, request *http.Request) {
	expectedVersion := textField(readBody(request), "version")
	status, err := server.backend.Updates().StartDownload(expectedVersion)
	writeUpdateAnswer(writer, status, err)
}

// cancelUpdateDownload stops a running download, or discards a finished one.
func (server *Server) cancelUpdateDownload(writer http.ResponseWriter, _ *http.Request) {
	writeUpdateAnswer(writer, server.backend.Updates().Cancel(), nil)
}

// applyUpdate installs the downloaded update and restarts. On success the answer arrives, then
// this copy closes and the new one takes over (the page's event stream drops and reconnects).
func (server *Server) applyUpdate(writer http.ResponseWriter, _ *http.Request) {
	status, err := server.backend.Updates().Apply()
	writeUpdateAnswer(writer, status, err)
}

// updateNoticeSeen dismisses the "Updated to X" notice.
func (server *Server) updateNoticeSeen(writer http.ResponseWriter, _ *http.Request) {
	writeUpdateAnswer(writer, server.backend.Updates().MarkSeen(), nil)
}

// writeUpdateAnswer is the one answer shape of every update route:
//
//	{"ok": true,  "status": {...}}
//	{"ok": false, "error": "<message to show>", "code": "<code>", "releaseUrl": "...", "status": {...}}
func writeUpdateAnswer(writer http.ResponseWriter, status updates.Status, err error) {
	if err == nil {
		writeJSON(writer, http.StatusOK, map[string]any{"ok": true, "status": status})
		return
	}
	answer := map[string]any{"ok": false, "error": err.Error(), "status": status}
	var updateError *updates.Error
	if errors.As(err, &updateError) {
		answer["code"] = updateError.Code
		if updateError.ReleaseURL != "" {
			answer["releaseUrl"] = updateError.ReleaseURL
		}
	}
	writeJSON(writer, updateErrorStatus(updateError), answer)
}

// updateErrorStatus picks the HTTP status for an update error:
// 409 when the request doesn't fit the current step, 400 when this copy can't do it,
// 500 when an install step failed, 502 for everything that went wrong with GitHub or the file.
func updateErrorStatus(updateError *updates.Error) int {
	if updateError == nil {
		return http.StatusInternalServerError
	}
	switch updateError.Code {
	case updates.CodeBusy, updates.CodeNothingToApply, updates.CodeStale:
		return http.StatusConflict
	case updates.CodeDevBuild, updates.CodeFolderNotWritable, updates.CodeNoPublicKey:
		return http.StatusBadRequest
	case updates.CodeApplyFailed:
		return http.StatusInternalServerError
	default:
		return http.StatusBadGateway
	}
}
