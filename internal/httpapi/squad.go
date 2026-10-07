package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"squadtaskmap/internal/features/squad"
)

// The squad routes (ticket 05) on the page's 127.0.0.1 server, behind the same Guard as every
// route. Thin: each decodes, calls the app, and writes the answer. The contract (requests, answers,
// the "squad" event) is in internal/features/squad/README.md. Friends never reach these: they use
// the separate peer API listener.

// SquadProfileChange holds the profile fields a PUT /api/squad/profile sent; nil means "not sent".
type SquadProfileChange struct {
	Name       *string
	Color      *string
	ShareTasks *bool
	ShareKeys  *bool // ticket 09
}

var (
	// ErrNotAnInviteCode: the join body's authKey doesn't look like a Tailscale auth key.
	ErrNotAnInviteCode = errors.New("That isn't an invite code. It starts with tskey-")
	// ErrAlreadyInSquad: join while already in a squad.
	ErrAlreadyInSquad = errors.New("Already in a squad. Leave it first to join another")
)

// squadView: GET /api/squad → the squad view.
func (server *Server) squadView(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, server.backend.SquadView())
}

// setSquadShare: PUT /api/squad/share {draw, tasks, keys} → {ok, rev, updatedAt, changed,
// tasksShared, keysShared, inSquad}.
// Over 2 MB → 413; not the right shape → 400 with the reason.
func (server *Server) setSquadShare(writer http.ResponseWriter, request *http.Request) {
	data, err := io.ReadAll(io.LimitReader(request.Body, squad.MaxShareBytes+1))
	if err != nil {
		writeError(writer, http.StatusBadRequest, err)
		return
	}
	if len(data) > squad.MaxShareBytes {
		writeError(writer, http.StatusRequestEntityTooLarge, errors.New("Your share is over 2 MB; not sent"))
		return
	}
	var parts squad.ShareParts
	if err := json.Unmarshal(data, &parts); err != nil {
		writeError(writer, http.StatusBadRequest, errors.New("The share isn't valid: "+err.Error()))
		return
	}
	result, err := server.backend.SetSquadShare(parts)
	if err != nil {
		writeError(writer, http.StatusBadRequest, errors.New("The share isn't valid: "+err.Error()))
		return
	}
	writeJSON(writer, http.StatusOK, withOK(result))
}

// joinSquad: POST /api/squad/join {authKey} → {ok, squad}. It answers once the tailnet accepted
// the code (or refused it): 400 not an invite code, 409 already in a squad, 502 the join failed.
func (server *Server) joinSquad(writer http.ResponseWriter, request *http.Request) {
	authKey := textField(readBody(request), "authKey")
	view, err := server.backend.JoinSquad(request.Context(), authKey)
	switch {
	case errors.Is(err, ErrNotAnInviteCode):
		writeError(writer, http.StatusBadRequest, err)
	case errors.Is(err, ErrAlreadyInSquad):
		writeError(writer, http.StatusConflict, err)
	case err != nil:
		writeError(writer, http.StatusBadGateway, err)
	default:
		writeJSON(writer, http.StatusOK, map[string]any{"ok": true, "squad": view})
	}
}

// leaveSquad: POST /api/squad/leave → {ok, squad}.
func (server *Server) leaveSquad(writer http.ResponseWriter, request *http.Request) {
	view := server.backend.LeaveSquad(request.Context())
	writeJSON(writer, http.StatusOK, map[string]any{"ok": true, "squad": view})
}

// setSquadProfile: PUT /api/squad/profile {name?, color?, shareTasks?, shareKeys?} → {ok, squad};
// 400 with the reason for a bad name or colour.
func (server *Server) setSquadProfile(writer http.ResponseWriter, request *http.Request) {
	body := readBody(request)
	change := SquadProfileChange{
		Name:       stringField(body, "name"),
		Color:      stringField(body, "color"),
		ShareTasks: boolField(body, "shareTasks"),
		ShareKeys:  boolField(body, "shareKeys"),
	}
	view, err := server.backend.SetSquadProfile(change)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"ok": true, "squad": view})
}

// withOK adds "ok": true to an answer's fields.
func withOK(value any) map[string]any {
	answer := map[string]any{}
	data, _ := json.Marshal(value)
	_ = json.Unmarshal(data, &answer)
	answer["ok"] = true
	return answer
}
