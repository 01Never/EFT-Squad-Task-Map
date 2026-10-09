package gamedata

import "testing"

// The log's fallback tables must give the same key the game data uses (tarkov.dev's
// normalizedName), or a raid on that map would open a map the page doesn't have.
func TestLogFallbackTablesUseTheDataMapKeys(t *testing.T) {
	cases := []struct{ name, got, want string }{
		{"Labyrinth scene path", SceneToMap["maps/labyrinth_preset.bundle"], "the-labyrinth"},
		{"Labyrinth location name", NameIDToMap["labyrinth"], "the-labyrinth"},
		{"Labs scene path", SceneToMap["maps/laboratory_preset.bundle"], "the-lab"},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, c.got, c.want)
		}
	}
}
