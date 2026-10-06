package gamedata

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

// FromAny reads game data that is already in the page's format ("stm-v2"), a tarkovtaskmap-style
// snapshot, or a `window.__X = {...};` script around either one.
func FromAny(data []byte, mode string) (GameData, error) {
	start := bytes.IndexByte(data, '{')
	if start < 0 {
		return GameData{}, fmt.Errorf("no JSON object in the game data")
	}
	body := strings.TrimSpace(string(data[start:]))
	body = strings.TrimSpace(strings.TrimSuffix(body, ";"))
	var probe struct {
		Format string `json:"format"`
	}
	if err := json.Unmarshal([]byte(body), &probe); err != nil {
		return GameData{}, fmt.Errorf("reading game data: %w", err)
	}
	if probe.Format == "stm-v2" {
		var converted GameData
		err := json.Unmarshal([]byte(body), &converted)
		return converted, err
	}
	var snapshot any
	if err := json.Unmarshal([]byte(body), &snapshot); err != nil {
		return GameData{}, fmt.Errorf("reading snapshot: %w", err)
	}
	return FromSnapshot(snapshot, mode), nil
}

// FromSnapshot converts the snapshot built into the exe (tarkovtaskmap's format: names are plain
// English, maps and items are objects). It has no zone outlines, marker items or kill targets.
func FromSnapshot(snapshot any, mode string) GameData {
	content := get(snapshot, "data")
	if content == nil {
		content = snapshot
	}
	tasks := []Task{}
	for _, raw := range listOf(get(content, "tasks")) {
		tasks = append(tasks, snapshotTask(raw))
	}
	var generated *string
	if value := get(snapshot, "generated"); value != nil {
		generatedText := text(value)
		generated = &generatedText
	}
	return GameData{Format: "stm-v2", Generated: generated, Mode: mode, Tasks: tasks, Maps: snapshotMaps(get(content, "maps"))}
}

// snapshotItem is {id, name} from a snapshot item; the name falls back to the short name, then the id.
func snapshotItem(raw any) Item {
	name := get(raw, "name")
	if !isSet(name) {
		name = get(raw, "short")
	}
	if !isSet(name) {
		name = get(raw, "id")
	}
	return Item{ID: text(get(raw, "id")), Name: text(name)}
}

func snapshotItems(value any) []Item {
	items := []Item{}
	for _, raw := range listOf(value) {
		items = append(items, snapshotItem(raw))
	}
	return items
}

func snapshotItemGroups(value any) [][]Item {
	groups := [][]Item{}
	for _, group := range listOf(value) {
		groups = append(groups, snapshotItems(group))
	}
	return groups
}

func snapshotMapKey(mapObject any) string {
	return MapKey(stringOrEmpty(get(mapObject, "normalizedName")))
}

func snapshotTask(raw any) Task {
	objectives := []Objective{}
	for _, rawObjective := range listOf(get(raw, "objectives")) {
		objectives = append(objectives, snapshotObjective(rawObjective))
	}
	var needed []neededKeys
	for _, rawNeeded := range listOf(get(raw, "neededKeys")) {
		needed = append(needed, neededKeys{mapKey: snapshotMapKey(get(rawNeeded, "map")), keys: snapshotItems(get(rawNeeded, "keys"))})
	}
	attachNeededKeys(objectives, needed)

	trader := get(get(raw, "trader"), "name")
	traderName := "?"
	if isSet(trader) {
		traderName = text(trader)
	}
	return Task{
		ID:       text(get(raw, "id")),
		Name:     text(get(raw, "name")),
		Trader:   traderName,
		Map:      optionalText(snapshotMapKey(get(raw, "map"))),
		Wiki:     optionalText(textIfSet(get(raw, "wikiLink"))),
		MinLevel: numberOr0(get(raw, "minPlayerLevel")),
		Kappa:    isSet(get(raw, "kappaRequired")),
		LK:       isSet(get(raw, "lightkeeperRequired")),
		Objs:     objectives,
	}
}

func snapshotObjective(raw any) Objective {
	objectiveType := text(get(raw, "type"))
	objective := Objective{
		ID:      text(get(raw, "id")),
		Type:    objectiveType,
		D:       text(orEmptyText(get(raw, "description"))),
		N:       numberOr0(get(raw, "count")),
		FIR:     isSet(get(raw, "foundInRaid")),
		Opt:     isSet(get(raw, "optional")),
		Maps:    []string{},
		Zones:   []Zone{},
		Poss:    []PossibleSet{},
		Keys:    snapshotKeyGroups(get(raw, "requiredKeys")),
		Items:   snapshotItems(get(raw, "items")),
		Targets: []string{},
	}
	for _, mapObject := range listOf(get(raw, "maps")) {
		if key := snapshotMapKey(mapObject); key != "" {
			objective.Maps = append(objective.Maps, key)
		}
	}
	for _, zone := range listOf(get(raw, "zones")) {
		position := get(zone, "position")
		if !isSet(position) {
			continue
		}
		converted := Zone{M: snapshotMapKey(get(zone, "map")), X: numberOr0(get(position, "x")), Y: numberOr0(get(position, "y")), Z: numberOr0(get(position, "z"))}
		if converted.M != "" {
			objective.Zones = append(objective.Zones, converted)
		}
	}
	for _, location := range listOf(get(raw, "possibleLocations")) {
		set := PossibleSet{M: snapshotMapKey(get(location, "map")), P: [][]float64{}}
		for _, point := range listOf(get(location, "positions")) {
			set.P = append(set.P, []float64{numberOr0(get(point, "x")), numberOr0(get(point, "y")), numberOr0(get(point, "z"))})
		}
		if set.M != "" && len(set.P) > 0 {
			objective.Poss = append(objective.Poss, set)
		}
	}
	if objectiveType == "mark" {
		marker := MS2000Marker
		objective.Marker = &marker
	}
	if questItem := get(raw, "questItem"); isSet(questItem) {
		name := get(questItem, "name")
		if !isSet(name) {
			name = get(questItem, "short")
		}
		questItemName := text(orEmptyText(name))
		objective.QI = &questItemName
	}
	if gear := get(raw, "gear"); isSet(gear) && objectiveType == "shoot" {
		objective.Gear = &Gear{
			Weapons:    snapshotItems(get(gear, "weapons")),
			Mods:       snapshotItemGroups(get(gear, "mods")),
			Wearing:    snapshotItemGroups(get(gear, "wearing")),
			NotWearing: numberOr0(get(gear, "notWearing")),
		}
	}
	return objective
}

// snapshotKeyGroups: the snapshot flattens key groups into one list. Most multi-key lists are
// alternatives, so they're kept as one group (duplicates removed).
func snapshotKeyGroups(value any) [][]Item {
	keys := listOf(value)
	if len(keys) == 0 {
		return [][]Item{}
	}
	seen := map[string]bool{}
	group := []Item{}
	for _, raw := range keys {
		key := snapshotItem(raw)
		if seen[key.ID] {
			continue
		}
		seen[key.ID] = true
		group = append(group, key)
	}
	return [][]Item{group}
}

func snapshotMaps(value any) []MapInfo {
	maps := []MapInfo{}
	seen := map[string]bool{}
	for _, raw := range listOf(value) {
		key := snapshotMapKey(raw)
		if seen[key] {
			continue
		}
		seen[key] = true
		info := MapInfo{Key: key, Extracts: []Extract{}, Transits: []Transit{}}
		for _, extract := range listOf(get(raw, "extracts")) {
			name := get(extract, "key")
			if !isSet(name) {
				name = get(extract, "name")
			}
			faction := ""
			if isSet(get(extract, "faction")) {
				faction = text(get(extract, "faction"))
			}
			position := get(extract, "position")
			info.Extracts = append(info.Extracts, Extract{N: text(name), Fa: faction, X: numberOr0(get(position, "x")), Y: numberOr0(get(position, "y")), Z: numberOr0(get(position, "z"))})
		}
		for _, transit := range listOf(get(raw, "transits")) {
			position := get(transit, "position")
			info.Transits = append(info.Transits, Transit{N: text(get(transit, "description")), X: numberOr0(get(position, "x")), Y: numberOr0(get(position, "y")), Z: numberOr0(get(position, "z"))})
		}
		maps = append(maps, info)
	}
	return maps
}

// orEmptyText is the value, or "" when it isn't set (JavaScript's `value || ""`).
func orEmptyText(value any) any {
	if !isSet(value) {
		return ""
	}
	return value
}

// ---------------------------------------------------------------- map names the game log uses

// SceneToMap: the log's "scene preset path" → map key, used when the data has no scenePath.
var SceneToMap = map[string]string{
	"maps/customs_preset.bundle": "customs", "maps/factory_day_preset.bundle": "factory", "maps/factory_night_preset.bundle": "factory",
	"maps/shopping_mall.bundle": "interchange", "maps/laboratory_preset.bundle": "the-lab", "maps/lighthouse_preset.bundle": "lighthouse",
	"maps/rezerv_base_preset.bundle": "reserve", "maps/sandbox_preset.bundle": "ground-zero", "maps/sandbox_high_preset.bundle": "ground-zero",
	"maps/shoreline_preset.bundle": "shoreline", "maps/city_preset.bundle": "streets-of-tarkov", "maps/woods_preset.bundle": "woods",
	"maps/labyrinth_preset.bundle": "labyrinth",
}

// NameIDToMap: the log's "Location: <nameId>" (lower case) → map key.
var NameIDToMap = map[string]string{
	"bigmap": "customs", "factory4_day": "factory", "factory4_night": "factory", "interchange": "interchange", "laboratory": "the-lab",
	"lighthouse": "lighthouse", "rezervbase": "reserve", "sandbox": "ground-zero", "sandbox_high": "ground-zero", "shoreline": "shoreline",
	"tarkovstreets": "streets-of-tarkov", "woods": "woods", "labyrinth": "labyrinth",
}
