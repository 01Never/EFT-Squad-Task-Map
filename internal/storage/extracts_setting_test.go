package storage

import "testing"

func TestReadingExtractsFromScreenshotsFollowsTheKeyTheNoticeAndTheChoice(t *testing.T) {
	yes, no := true, false
	cases := []struct {
		name         string
		settings     Settings
		wantOn       bool
		wantNotice   bool
		wantCheckbox bool
	}{
		{"no key: off, nothing to explain", Settings{}, false, false, true},
		{"a key but the notice not seen yet: still off, the notice is due", Settings{OpenAIKey: "sk-x"}, false, true, true},
		{"a key and the notice seen: on by default", Settings{OpenAIKey: "sk-x", ExtractsNoticeSeen: true}, true, false, true},
		{"switched on by hand counts as chosen", Settings{OpenAIKey: "sk-x", ReadExtracts: &yes}, true, false, true},
		{"switched off by hand", Settings{OpenAIKey: "sk-x", ExtractsNoticeSeen: true, ReadExtracts: &no}, false, false, false},
		{"on by hand but the key was removed", Settings{ReadExtracts: &yes}, false, false, true},
	}
	for _, c := range cases {
		if got := c.settings.IsReadExtractsOn(); got != c.wantOn {
			t.Errorf("%s: IsReadExtractsOn() = %v, want %v", c.name, got, c.wantOn)
		}
		if got := c.settings.NeedsExtractsNotice(); got != c.wantNotice {
			t.Errorf("%s: NeedsExtractsNotice() = %v, want %v", c.name, got, c.wantNotice)
		}
		if got := c.settings.ReadExtractsChoice(); got != c.wantCheckbox {
			t.Errorf("%s: ReadExtractsChoice() = %v, want %v", c.name, got, c.wantCheckbox)
		}
	}
}
