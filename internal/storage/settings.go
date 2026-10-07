package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// Settings are the user's choices, saved in squad-task-map-settings.json.
// The OpenAI key is kept here in plain text and is only ever sent to api.openai.com.
type Settings struct {
	OpenAIKey       string `json:"openaiKey,omitempty"`
	OpenAIModel     string `json:"openaiModel,omitempty"`
	OpenAIEffort    string `json:"openaiEffort,omitempty"`
	GameMode        string `json:"gameMode,omitempty"`        // "regular", "pve" or "pvp-season"
	LogsPath        string `json:"logsPath,omitempty"`        // empty = found automatically
	ScreenshotsPath string `json:"screenshotsPath,omitempty"` // empty = found automatically
	FollowPosition  *bool  `json:"followPosition,omitempty"`  // switch to the raid's map on a new position; default on
	AutoCenter      *bool  `json:"autoCenter,omitempty"`      // ticket 02: centre on each new position; default off

	// Squad (ticket 05): your player id, name, colour, "Share my tasks", and whether you joined.
	// Never the invite code. nil until the squad feature first saves it.
	Squad *SquadSettings `json:"squad,omitempty"`

	// Fields this version doesn't know about, kept so an older or newer version's settings survive a save.
	extra map[string]json.RawMessage
}

// SquadSettings is the "squad" block of the settings file (ticket 05).
type SquadSettings struct {
	PlayerID   string `json:"playerId,omitempty"`   // random, made once (16 hex characters)
	Name       string `json:"name,omitempty"`       // shown to friends, 1 to 32 characters
	Color      string `json:"color,omitempty"`      // "#rrggbb"
	ShareTasks bool   `json:"shareTasks,omitempty"` // default off
	Joined     bool   `json:"joined,omitempty"`     // in a squad: start the squad network at launch

	// Fields this version doesn't know about inside "squad", kept like the top-level ones.
	extra map[string]json.RawMessage
}

var knownSquadSettingsFields = map[string]bool{
	"playerId": true, "name": true, "color": true, "shareTasks": true, "joined": true,
}

// UnmarshalJSON reads the known squad fields and keeps the rest untouched.
func (s *SquadSettings) UnmarshalJSON(data []byte) error {
	type plain SquadSettings
	if err := json.Unmarshal(data, (*plain)(s)); err != nil {
		return err
	}
	var all map[string]json.RawMessage
	if err := json.Unmarshal(data, &all); err != nil {
		return err
	}
	s.extra = map[string]json.RawMessage{}
	for key, value := range all {
		if !knownSquadSettingsFields[key] {
			s.extra[key] = value
		}
	}
	return nil
}

// MarshalJSON writes the known squad fields plus anything kept from the file.
func (s SquadSettings) MarshalJSON() ([]byte, error) {
	type plain SquadSettings
	known, err := json.Marshal(plain(s))
	if err != nil {
		return nil, err
	}
	merged := map[string]json.RawMessage{}
	if err := json.Unmarshal(known, &merged); err != nil {
		return nil, err
	}
	for key, value := range s.extra {
		merged[key] = value
	}
	return json.Marshal(merged)
}

// SquadOrEmpty is the squad block, or an empty one when the file has none.
func (s Settings) SquadOrEmpty() SquadSettings {
	if s.Squad == nil {
		return SquadSettings{}
	}
	return *s.Squad
}

// GameModeOrDefault is the game mode, "regular" when unset.
func (s Settings) GameModeOrDefault() string {
	if s.GameMode == "" {
		return "regular"
	}
	return s.GameMode
}

// IsFollowPositionOn is true unless the user turned it off.
func (s Settings) IsFollowPositionOn() bool { return s.FollowPosition == nil || *s.FollowPosition }

// IsAutoCenterOn is false unless the user turned it on.
func (s Settings) IsAutoCenterOn() bool { return s.AutoCenter != nil && *s.AutoCenter }

var knownSettingsFields = map[string]bool{
	"openaiKey": true, "openaiModel": true, "openaiEffort": true, "gameMode": true, "logsPath": true,
	"screenshotsPath": true, "followPosition": true, "autoCenter": true, "squad": true,
}

// UnmarshalJSON reads the known fields and keeps the rest untouched.
func (s *Settings) UnmarshalJSON(data []byte) error {
	type plain Settings
	if err := json.Unmarshal(data, (*plain)(s)); err != nil {
		return err
	}
	var all map[string]json.RawMessage
	if err := json.Unmarshal(data, &all); err != nil {
		return err
	}
	s.extra = map[string]json.RawMessage{}
	for key, value := range all {
		if !knownSettingsFields[key] {
			s.extra[key] = value
		}
	}
	return nil
}

// MarshalJSON writes the known fields plus anything kept from the file.
func (s Settings) MarshalJSON() ([]byte, error) {
	type plain Settings
	known, err := json.Marshal(plain(s))
	if err != nil {
		return nil, err
	}
	merged := map[string]json.RawMessage{}
	if err := json.Unmarshal(known, &merged); err != nil {
		return nil, err
	}
	for key, value := range s.extra {
		merged[key] = value
	}
	return json.Marshal(merged)
}

// ReadSettings loads the settings file; a missing or broken file gives empty settings.
// v1's TarkovTracker fields (tt…) are dropped on first start, since v2 doesn't use TarkovTracker.
func ReadSettings(path string) Settings {
	var settings Settings
	data, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(data, &settings) != nil {
		return Settings{extra: map[string]json.RawMessage{}}
	}
	droppedAny := false
	for key := range settings.extra {
		if strings.HasPrefix(key, "tt") {
			delete(settings.extra, key)
			droppedAny = true
		}
	}
	if droppedAny {
		_ = WriteSettings(path, settings)
	}
	return settings
}

// WriteSettings saves the settings file (indented, like v2 did).
func WriteSettings(path string, settings Settings) error {
	compact, err := json.Marshal(settings)
	if err != nil {
		return fmt.Errorf("encoding settings: %w", err)
	}
	var tree any
	_ = json.Unmarshal(compact, &tree)
	pretty, _ := json.MarshalIndent(tree, "", " ")
	if err := WriteFileAtomic(path, pretty); err != nil {
		return fmt.Errorf("writing settings %s: %w", path, err)
	}
	return nil
}

// MaskKey shows only the start and end of an API key, so the page never sees the whole key.
// Returns nil for an empty key (JSON null).
func MaskKey(key string) *string {
	if key == "" {
		return nil
	}
	masked := firstRunes(key, 4) + "…" + lastRunes(key, 4)
	return &masked
}

func firstRunes(s string, n int) string {
	runes := []rune(s)
	if len(runes) < n {
		return s
	}
	return string(runes[:n])
}

func lastRunes(s string, n int) string {
	runes := []rune(s)
	if len(runes) < n {
		return s
	}
	return string(runes[len(runes)-n:])
}
