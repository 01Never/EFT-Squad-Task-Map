package app

import (
	"testing"

	"squadtaskmap/internal/storage"
)

func TestAIStatusReportsTheEffortInUse(t *testing.T) {
	tests := []struct {
		name            string
		model, effort   string
		wantModel       string
		wantEffort      string
		wantEffortInUse string
	}{
		{"a saved effort wins", "gpt-6-luna", "low", "gpt-6-luna", "low", "low"},
		{"no effort and no model means the default model at high", "", "", "gpt-6-luna", "", "high"},
		{"no effort on an o-series model means high", "o3", "", "o3", "", "high"},
		{"no effort on a model without reasoning means none", "gpt-4.1", "", "gpt-4.1", "", ""},
		{"a saved effort is kept as saved on a model without reasoning", "gpt-4.1", "low", "gpt-4.1", "low", "low"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			status := (&App{}).aiStatus(storage.Settings{OpenAIModel: test.model, OpenAIEffort: test.effort})
			if status["model"] != test.wantModel || status["effort"] != test.wantEffort || status["effortInUse"] != test.wantEffortInUse {
				t.Errorf("got model %v effort %v effortInUse %v", status["model"], status["effort"], status["effortInUse"])
			}
		})
	}
}
