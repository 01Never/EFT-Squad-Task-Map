package app

import (
	"testing"

	"squadtaskmap/internal/storage"
)

func TestAIStatusReportsTheModelInUse(t *testing.T) {
	tests := []struct {
		name      string
		model     string
		wantModel string
	}{
		{"no model saved means the default model", "", "gpt-6-luna"},
		{"a saved model is kept", "gpt-4.1", "gpt-4.1"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			status := (&App{}).aiStatus(storage.Settings{OpenAIModel: test.model})
			if status["model"] != test.wantModel {
				t.Errorf("got model %v, want %v", status["model"], test.wantModel)
			}
		})
	}
}
