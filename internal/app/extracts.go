package app

import (
	"squadtaskmap/internal/events"
	"squadtaskmap/internal/features/extracts"
	"squadtaskmap/internal/openai"
)

// newExtractsReader connects the extract reader (ticket 06) to the settings, the raid's map, the
// game data's extract names and the page.
func newExtractsReader(app *App) *extracts.Reader {
	config := func() extracts.Config {
		settings := app.currentSettings()
		model := settings.OpenAIModel
		if model == "" {
			model = openai.DefaultModel
		}
		return extracts.Config{Key: settings.OpenAIKey, Model: model, Enabled: settings.IsReadExtractsOn()}
	}
	mapNames := func(mapKey string) []string {
		names := []string{}
		for _, info := range app.gameData.Current().Maps {
			if info.Key != mapKey {
				continue
			}
			for _, extract := range info.Extracts {
				names = append(names, extract.N)
			}
			for _, transit := range info.Transits {
				names = append(names, transit.N)
			}
		}
		return names
	}
	return extracts.New(app.screenshots, app.ai, config, app.raid.CurrentMap, mapNames, app.onExtractsRead)
}

// onExtractsRead hands the player's extracts to the page. It is queued (Deliver) because it
// changes saved data.
func (app *App) onExtractsRead(result extracts.Result) {
	fields := map[string]any{"map": result.Map, "marked": result.Marked, "unknown": result.Unknown}
	if result.Map == nil {
		fields["read"] = result.Read // the page matches these against the map it has open
	}
	app.hub.Deliver(events.New(events.Extracts, fields))
}
