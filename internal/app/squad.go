package app

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"time"

	"squadtaskmap/internal/events"
	"squadtaskmap/internal/features/squad"
	"squadtaskmap/internal/httpapi"
	"squadtaskmap/internal/storage"
)

// This file connects the squad (ticket 05, internal/features/squad) to the app: which transport it
// uses, where its settings are saved, and the page's "squad" event.
//
// Never joined → nothing here starts: no tsnet, no listener, no goroutine, no traffic.
//
// Development transport (no tsnet at all), for three copies on one PC and for tests:
//   - STM_SQUAD_DEV_LISTEN=127.0.0.1:7901: serve the peer API on this address (this PC only);
//   - STM_SQUAD_DEV_PEERS=127.0.0.1:7902,127.0.0.1:7903: the other copies' addresses.
//
// STM_SQUAD_DEBUG=1 prints tsnet's own log in the console.
//
// STM_SQUAD_CONTROL_URL=http://127.0.0.1:<port> (tests only): tsnet uses this coordination server
// instead of Tailscale's, e.g. cmd/faketailnet. Nothing else changes: the tag:stm check, the Host
// check, the size caps and the share checks are the same.

// joinTimeout: how long Join waits for the tailnet to accept the invite code.
const joinTimeout = 90 * time.Second

// leaveTimeout: how long Leave waits for the log-out to reach the tailnet.
const leaveTimeout = 10 * time.Second

// newSquad creates the squad feature from the saved settings. It starts nothing.
func newSquad(app *App) *squad.Squad {
	if controlURL := squadControlURL(); controlURL != "" {
		log.Printf("squad: using the coordination server %s (STM_SQUAD_CONTROL_URL, for tests)",
			controlURL)
	}
	saved := app.currentSettings().SquadOrEmpty()
	return squad.New(squad.Config{
		CacheFile:     app.files.SquadCache,
		StateDir:      app.files.SquadNetwork,
		TransportName: squadTransportName(),
		Settings: squad.Settings{
			PlayerID:   saved.PlayerID,
			Name:       saved.Name,
			Color:      saved.Color,
			ShareTasks: saved.ShareTasks,
			Joined:     saved.Joined,
		},
		SaveSettings: app.saveSquadSettings,
		OnChange:     app.onSquadChanged,
	})
}

// startSquad reconnects to the squad at launch, if the player is in one.
func (app *App) startSquad() {
	if !app.squad.Settings().Joined {
		return
	}
	app.squad.Resume(app.newSquadTransport(""))
}

// devSquadAddress is STM_SQUAD_DEV_LISTEN when it's an address on this PC; otherwise "" (with one
// console line when it was set to something else).
func devSquadAddress() string {
	listen := os.Getenv("STM_SQUAD_DEV_LISTEN")
	if listen == "" {
		return ""
	}
	if !squad.IsLoopbackCaller(listen) {
		log.Println("STM_SQUAD_DEV_LISTEN ignored: it must be an address on this PC, like 127.0.0.1:7901")
		return ""
	}
	return listen
}

// squadControlURL is STM_SQUAD_CONTROL_URL when it's an http(s) address; otherwise "" (Tailscale's
// own coordination server), with one console line when it was set to something else.
func squadControlURL() string {
	value := os.Getenv("STM_SQUAD_CONTROL_URL")
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		log.Println("STM_SQUAD_CONTROL_URL ignored: it must look like http://127.0.0.1:<port>")
		return ""
	}
	return value
}

func squadTransportName() string {
	if devSquadAddress() != "" {
		return "dev"
	}
	return "tsnet"
}

// newSquadTransport picks how this copy reaches friends: the dev transport when
// STM_SQUAD_DEV_LISTEN is set, otherwise tsnet. authKey is the invite code when joining, "" when
// resuming after a restart.
func (app *App) newSquadTransport(authKey string) squad.Transport {
	if listen := devSquadAddress(); listen != "" {
		return squad.NewDevTransport(listen, squad.ParseDevPeers(os.Getenv("STM_SQUAD_DEV_PEERS")))
	}
	return squad.NewTsnetTransport(squad.TsnetConfig{
		StateDir: app.files.SquadNetwork,
		PlayerID: app.squad.Settings().PlayerID,
		AuthKey:  authKey,
		Debug:    os.Getenv("STM_SQUAD_DEBUG") != "",

		ControlURL: squadControlURL(),
	})
}

// saveSquadSettings writes the squad block of the settings file (other fields, and unknown fields
// inside the block, are kept).
func (app *App) saveSquadSettings(settings squad.Settings) {
	app.settingsMutex.Lock()
	block := app.settings.SquadOrEmpty()
	block.PlayerID = settings.PlayerID
	block.Name = settings.Name
	block.Color = settings.Color
	block.ShareTasks = settings.ShareTasks
	block.Joined = settings.Joined
	app.settings.Squad = &block
	saved := app.settings
	app.settingsMutex.Unlock()
	if err := storage.WriteSettings(app.files.Settings, saved); err != nil {
		log.Printf("squad: %v", err)
	}
}

// onSquadChanged tells the open page (live only; a page opened later reads GET /api/squad).
func (app *App) onSquadChanged() {
	app.hub.Broadcast(events.New(events.Squad, map[string]any{"squad": app.squad.View()}))
}

// ---------------------------------------------------------------- what the page can ask for

// SquadView is GET /api/squad.
func (app *App) SquadView() any { return app.squad.View() }

// SetSquadShare stores the page's drawings and tasks as my share.
func (app *App) SetSquadShare(parts squad.ShareParts) (any, error) {
	return app.squad.SetMyShare(parts)
}

// JoinSquad joins with an invite code. The code is used once and never saved.
func (app *App) JoinSquad(ctx context.Context, authKey string) (any, error) {
	if !squad.IsPlausibleAuthKey(authKey) {
		return nil, httpapi.ErrNotAnInviteCode
	}
	joinContext, cancel := context.WithTimeout(ctx, joinTimeout)
	defer cancel()
	err := app.squad.Join(joinContext, app.newSquadTransport(authKey))
	if errors.Is(err, squad.ErrAlreadyJoined) {
		return nil, httpapi.ErrAlreadyInSquad
	}
	if err != nil {
		return nil, fmt.Errorf("Couldn't join the squad: %w", err)
	}
	return app.squad.View(), nil
}

// LeaveSquad leaves: logs out, deletes the squad network's state folder, forgets friends.
func (app *App) LeaveSquad(ctx context.Context) any {
	leaveContext, cancel := context.WithTimeout(ctx, leaveTimeout)
	defer cancel()
	app.squad.Leave(leaveContext)
	return app.squad.View()
}

// SetSquadProfile changes the fields that were sent (name, colour, "Share my tasks").
func (app *App) SetSquadProfile(change httpapi.SquadProfileChange) (any, error) {
	current := app.squad.Settings()
	name, color, shareTasks := current.Name, current.Color, current.ShareTasks
	if change.Name != nil {
		name = *change.Name
	}
	if change.Color != nil {
		color = *change.Color
	}
	if change.ShareTasks != nil {
		shareTasks = *change.ShareTasks
	}
	if err := app.squad.SetProfile(name, color, shareTasks); err != nil {
		return nil, err
	}
	return app.squad.View(), nil
}
