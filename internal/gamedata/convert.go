package gamedata

// Conversion from tarkov.dev's files to the page's "stm-v2" format. Pure functions, no I/O.
//
//   - FromRaw: json.tarkov.dev's flat files ({mode}/tasks, tasks_en, maps, maps_en, traders,
//     traders_en, items_en). Names in them are translation keys ("<id> name"); the _en files hold
//     the English text.
//   - FromSnapshot: the snapshot built into the exe (tarkovtaskmap's format), the offline fallback.
//   - Loot spots (ticket 08) come from the same maps file: see loot.go.
//
// This is a 1:1 port of v2's server/convert.ts; its output must stay JSON-equal to the golden
// files in testdata/golden.

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
)

// MS2000Marker is the marker item for "mark" objectives that don't name one.
var MS2000Marker = Item{ID: "5991b51486f77447b112d44f", Name: "MS2000 Marker"}

// Map variants that share one map on the page.
var mapKeyAliases = map[string]string{"ground-zero-21": "ground-zero", "night-factory": "factory"}

// MapKey turns tarkov.dev's normalizedName into the page's map key ("" when there's none).
func MapKey(normalizedName string) string {
	if normalizedName == "" {
		return ""
	}
	if alias, isAlias := mapKeyAliases[normalizedName]; isAlias {
		return alias
	}
	return normalizedName
}

// RawDocs are the json.tarkov.dev files for one game mode, as downloaded (raw JSON).
type RawDocs struct {
	Tasks     json.RawMessage `json:"tasks"`
	TasksEn   json.RawMessage `json:"tasksEn"`
	Maps      json.RawMessage `json:"maps"`
	MapsEn    json.RawMessage `json:"mapsEn"`
	Traders   json.RawMessage `json:"traders"`
	TradersEn json.RawMessage `json:"tradersEn"`
	ItemsEn   json.RawMessage `json:"itemsEn"`
}

// rawConverter holds the lookup tables for one FromRaw run.
type rawConverter struct {
	taskText    map[string]any // tasks_en: translation key → English
	mapText     map[string]any // maps_en
	traderText  map[string]any // traders_en
	itemText    map[string]any // items_en: "<item id> Name" → English
	traders     map[string]any // trader id → trader
	questItems  map[string]any // quest item id → quest item
	mapKeyByID  map[string]string
	mapIDsKnown map[string]bool
}

// FromRaw converts json.tarkov.dev's files.
func FromRaw(docs RawDocs, mode string, generated *string) (GameData, error) {
	converter := rawConverter{
		taskText:   asObject(dataOf(docs.TasksEn)),
		mapText:    asObject(dataOf(docs.MapsEn)),
		traderText: asObject(dataOf(docs.TradersEn)),
		itemText:   asObject(dataOf(docs.ItemsEn)),
		traders:    asObject(dataOf(docs.Traders)),
	}
	tasksDoc := dataOf(docs.Tasks)
	converter.questItems = asObject(objectField(tasksDoc, "questItems"))

	rawMaps, err := orderedObject(objectField(dataOf(docs.Maps), "maps"))
	if err != nil {
		return GameData{}, fmt.Errorf("reading maps: %w", err)
	}
	converter.mapKeyByID = map[string]string{}
	converter.mapIDsKnown = map[string]bool{}
	for _, entry := range rawMaps {
		converter.mapIDsKnown[entry.Key] = true
		converter.mapKeyByID[entry.Key] = MapKey(stringOrEmpty(get(entry.Value, "normalizedName")))
	}

	rawTasks, err := orderedObject(objectField(tasksDoc, "tasks"))
	if err != nil {
		return GameData{}, fmt.Errorf("reading tasks: %w", err)
	}
	tasks := make([]Task, 0, len(rawTasks))
	for _, entry := range rawTasks {
		tasks = append(tasks, converter.task(entry.Key, entry.Value))
	}

	containerKinds := asObject(objectField(dataOf(docs.Maps), "lootContainers"))
	loot := converter.lootFromMaps(rawMaps, containerKinds)

	return GameData{Format: "stm-v2", Generated: generated, Mode: mode, Tasks: tasks, Maps: converter.maps(rawMaps), Loot: loot}, nil
}

// ---------------------------------------------------------------- names and translations

// translate looks a translation key up in tasks_en; an unknown key is shown as itself.
func (c *rawConverter) translate(key any) string {
	if hasText(c.taskText, key) {
		return text(c.taskText[text(key)])
	}
	if key == nil {
		return ""
	}
	return text(key)
}

// hasText: the table has a non-empty entry for this key (null keys have none).
func hasText(table map[string]any, key any) bool {
	if key == nil {
		return false
	}
	value, present := table[text(key)]
	return present && value != nil && value != ""
}

func (c *rawConverter) itemName(id string) string {
	if hasText(c.itemText, id+" Name") {
		return text(c.itemText[id+" Name"])
	}
	if hasText(c.taskText, id+" Name") {
		return text(c.taskText[id+" Name"])
	}
	return id
}

// item turns an item reference (an id, or an object with an id) into {id, name}.
func (c *rawConverter) item(reference any) Item {
	id := text(reference)
	if object, isObject := reference.(map[string]any); isObject {
		id = text(object["id"])
		if object["id"] == nil {
			id = "undefined" // JavaScript's String(undefined); only for malformed data
		}
	}
	name := c.itemName(id)
	if object, isObject := reference.(map[string]any); isObject && name == id && isSet(object["name"]) {
		name = c.translate(object["name"])
	}
	return Item{ID: id, Name: name}
}

func (c *rawConverter) items(list any) []Item {
	result := []Item{}
	for _, reference := range listOf(list) {
		result = append(result, c.item(reference))
	}
	return result
}

// itemGroups reads [[item]]: every inner list is one group of alternatives. A single item where a
// list is expected counts as a group of one; empty groups are dropped.
func (c *rawConverter) itemGroups(value any) [][]Item {
	groups := [][]Item{}
	for _, group := range listOf(value) {
		members := listOf(group)
		if members == nil {
			members = []any{group}
		}
		converted := []Item{}
		for _, member := range members {
			if member != nil {
				converted = append(converted, c.item(member))
			}
		}
		if len(converted) > 0 {
			groups = append(groups, converted)
		}
	}
	return groups
}

func (c *rawConverter) traderName(traderID any) string {
	trader := c.traders[text(traderID)]
	name := traderID
	if isSet(trader) {
		name = get(trader, "name")
	}
	if hasText(c.traderText, name) {
		return text(c.traderText[text(name)])
	}
	if !isSet(name) {
		return "?"
	}
	return text(name)
}

func (c *rawConverter) questItemName(reference any) string {
	if object, isObject := reference.(map[string]any); isObject {
		if name := c.translate(object["name"]); name != "" {
			return name
		}
		return text(object["id"])
	}
	questItem := c.questItems[text(reference)]
	var key any
	if isSet(questItem) {
		key = get(questItem, "name")
	}
	if hasText(c.itemText, key) {
		return text(c.itemText[text(key)])
	}
	if hasText(c.taskText, key) {
		return text(c.taskText[text(key)])
	}
	if isSet(key) {
		return text(key)
	}
	return text(reference)
}

// questItemID is the quest item's id when it looks like an item id (24 hex digits), else nil: the
// page then keeps the category shape instead of an icon (ticket 07).
func (c *rawConverter) questItemID(reference any) *string {
	id := text(reference)
	if object, isObject := reference.(map[string]any); isObject {
		id = text(object["id"])
	}
	if !itemIDPattern.MatchString(id) {
		return nil
	}
	return &id
}

var itemIDPattern = regexp.MustCompile(`^[0-9a-f]{24}$`)

// mapKeyOf turns a map id into a map key: the map's normalizedName when the id is a known map,
// otherwise the value itself read as a normalizedName. "" means no map.
func (c *rawConverter) mapKeyOf(id any) string {
	if id == nil {
		return ""
	}
	if key, known := c.mapKeyByID[text(id)]; known && key != "" {
		return key
	}
	return MapKey(text(id))
}

// ---------------------------------------------------------------- tasks and objectives

func (c *rawConverter) task(id string, raw any) Task {
	objectives := []Objective{}
	for _, rawObjective := range listOf(get(raw, "objectives")) {
		objectives = append(objectives, c.objective(rawObjective))
	}
	var needed []neededKeys
	for _, rawNeeded := range listOf(get(raw, "neededKeys")) {
		needed = append(needed, neededKeys{mapKey: c.mapKeyOf(get(rawNeeded, "map")), keys: c.items(get(rawNeeded, "keys"))})
	}
	attachNeededKeys(objectives, needed)

	taskID := id
	if value := get(raw, "id"); value != nil {
		taskID = text(value)
	}
	return Task{
		ID:       taskID,
		Name:     c.translate(get(raw, "name")),
		Trader:   c.traderName(get(raw, "trader")),
		Map:      optionalText(c.mapKeyOf(get(raw, "map"))),
		Wiki:     optionalText(textIfSet(get(raw, "wikiLink"))),
		MinLevel: numberOr0(get(raw, "minPlayerLevel")),
		Kappa:    isSet(get(raw, "kappaRequired")),
		LK:       isSet(get(raw, "lightkeeperRequired")),
		Objs:     objectives,
	}
}

func (c *rawConverter) objective(raw any) Objective {
	objectiveType := text(get(raw, "type"))
	isKill := objectiveType == "shoot"
	objective := Objective{
		ID:      text(get(raw, "id")),
		Type:    objectiveType,
		D:       c.translate(get(raw, "description")),
		N:       numberOr0(get(raw, "count")),
		FIR:     isSet(get(raw, "foundInRaid")),
		Opt:     isSet(get(raw, "optional")),
		Maps:    c.objectiveMaps(get(raw, "maps")),
		Zones:   c.zones(get(raw, "zones")),
		Poss:    c.possibleLocations(get(raw, "possibleLocations")),
		Keys:    c.itemGroups(get(raw, "requiredKeys")),
		Items:   c.objectiveItems(raw),
		Targets: c.targets(raw),
	}
	if objectiveType == "mark" {
		marker := MS2000Marker
		if isSet(get(raw, "markerItem")) {
			marker = c.item(get(raw, "markerItem"))
		}
		objective.Marker = &marker
	}
	if isSet(get(raw, "questItem")) {
		name := c.questItemName(get(raw, "questItem"))
		objective.QI = &name
		objective.QIID = c.questItemID(get(raw, "questItem"))
	}
	if isKill {
		objective.Gear = c.gear(raw)
		objective.Time = killTimeWindow(raw)
	}
	return objective
}

func (c *rawConverter) objectiveMaps(value any) []string {
	keys := []string{}
	for _, id := range listOf(value) {
		if key := c.mapKeyOf(id); key != "" {
			keys = append(keys, key)
		}
	}
	return keys
}

func (c *rawConverter) zones(value any) []Zone {
	zones := []Zone{}
	for _, raw := range listOf(value) {
		position := get(raw, "position")
		if !isSet(raw) || !isSet(position) {
			continue
		}
		zone := Zone{
			M: c.mapKeyOf(get(raw, "map")),
			X: numberOr0(get(position, "x")),
			Y: numberOr0(get(position, "y")),
			Z: numberOr0(get(position, "z")),
		}
		// top/bottom are copied as they are when present and number-like (null included).
		if has(raw, "top") && isFiniteLikeJS(get(raw, "top")) {
			zone.Top = rawJSON(get(raw, "top"))
		}
		if has(raw, "bottom") && isFiniteLikeJS(get(raw, "bottom")) {
			zone.Bottom = rawJSON(get(raw, "bottom"))
		}
		zone.Outline = outline(get(raw, "outline"))
		if zone.M != "" {
			zones = append(zones, zone)
		}
	}
	return zones
}

func (c *rawConverter) possibleLocations(value any) []PossibleSet {
	sets := []PossibleSet{}
	for _, raw := range listOf(value) {
		positions := listOf(get(raw, "positions"))
		if get(raw, "positions") == nil && isSet(get(raw, "position")) {
			positions = []any{get(raw, "position")}
		}
		set := PossibleSet{M: c.mapKeyOf(get(raw, "map")), P: [][]float64{}}
		for _, point := range positions {
			set.P = append(set.P, []float64{numberOr0(get(point, "x")), numberOr0(get(point, "y")), numberOr0(get(point, "z"))})
		}
		if set.M != "" && len(set.P) > 0 {
			sets = append(sets, set)
		}
	}
	return sets
}

// objectiveItems: "items", or a single "item" (buildWeapon).
func (c *rawConverter) objectiveItems(raw any) []Item {
	if itemsValue := get(raw, "items"); isSet(itemsValue) {
		return c.items(itemsValue)
	}
	if single := get(raw, "item"); isSet(single) {
		return []Item{c.item(single)}
	}
	return []Item{}
}

// targets: "targetNames" (translated), or a single "target".
func (c *rawConverter) targets(raw any) []string {
	names := []any{}
	if value := get(raw, "targetNames"); isSet(value) {
		names = listOf(value)
	} else if single := get(raw, "target"); isSet(single) {
		names = []any{single}
	}
	targets := []string{}
	for _, name := range names {
		targets = append(targets, c.translate(name))
	}
	return targets
}

// gear lists weapon, mod and outfit restrictions of a kill objective; nil when there are none.
func (c *rawConverter) gear(raw any) *Gear {
	gear := Gear{
		Weapons:    c.items(get(raw, "usingWeapon")),
		Mods:       c.itemGroups(get(raw, "usingWeaponMods")),
		Wearing:    c.itemGroups(get(raw, "wearing")),
		NotWearing: float64(len(listOf(get(raw, "notWearing")))),
	}
	if len(gear.Weapons) == 0 && len(gear.Mods) == 0 && len(gear.Wearing) == 0 && gear.NotWearing == 0 {
		return nil
	}
	return &gear
}

// killTimeWindow is [from, until] for kills that must happen between certain hours, else nil.
func killTimeWindow(raw any) []float64 {
	from, until := get(raw, "timeFromHour"), get(raw, "timeUntilHour")
	if !isSet(from) && !isSet(until) {
		return nil
	}
	if from == 0.0 && until == 0.0 {
		return nil
	}
	return []float64{numberOr0(from), numberOr0(until)}
}

// outline reads a polygon of {x, z} points into [x, z] pairs rounded to 2 decimals. Fewer than
// 3 points is no polygon (nil). Unusable points are skipped, which can leave an empty list.
func outline(value any) *[][]float64 {
	points := listOf(value)
	if points == nil || len(points) < 3 {
		return nil
	}
	result := [][]float64{}
	for _, point := range points {
		if !isSet(point) || !isFiniteLikeJS(get(point, "x")) || !isFiniteLikeJS(get(point, "z")) || !has(point, "x") || !has(point, "z") {
			continue
		}
		x, xIsNumber := get(point, "x").(float64)
		z, zIsNumber := get(point, "z").(float64)
		if !xIsNumber || !zIsNumber {
			continue
		}
		result = append(result, []float64{roundToHundredths(x), roundToHundredths(z)})
	}
	return &result
}

// ---------------------------------------------------------------- keys a task needs

type neededKeys struct {
	mapKey string
	keys   []Item
}

// attachNeededKeys adds a task's "needed keys" that no objective already lists, as a new key group
// on the first objective on that key's map (or the first objective with a zone, or the first one).
func attachNeededKeys(objectives []Objective, needed []neededKeys) {
	have := map[string]bool{}
	for _, objective := range objectives {
		for _, group := range objective.Keys {
			for _, key := range group {
				have[key.ID] = true
			}
		}
	}
	for _, entry := range needed {
		missing := []Item{}
		for _, key := range entry.keys {
			if !have[key.ID] {
				missing = append(missing, key)
			}
		}
		if len(missing) == 0 {
			continue
		}
		target := objectiveForKeys(objectives, entry.mapKey)
		if target == nil {
			continue
		}
		target.Keys = append(target.Keys, missing)
		for _, key := range missing {
			have[key.ID] = true
		}
	}
}

func objectiveForKeys(objectives []Objective, mapKey string) *Objective {
	if mapKey != "" {
		for i := range objectives {
			if objectiveIsOnMap(objectives[i], mapKey) {
				return &objectives[i]
			}
		}
	}
	for i := range objectives {
		if len(objectives[i].Zones) > 0 {
			return &objectives[i]
		}
	}
	if len(objectives) > 0 {
		return &objectives[0]
	}
	return nil
}

func objectiveIsOnMap(objective Objective, mapKey string) bool {
	for _, zone := range objective.Zones {
		if zone.M == mapKey {
			return true
		}
	}
	for _, key := range objective.Maps {
		if key == mapKey {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------- maps

var variantMapName = regexp.MustCompile(`21|night`)

func (c *rawConverter) maps(rawMaps []orderedEntry) []MapInfo {
	// When two maps share a key (Factory and Night Factory), the plain one is listed first; the
	// variant's scene and nameId are kept as aliases so the game log still finds the map.
	ordered := append([]orderedEntry(nil), rawMaps...)
	sort.SliceStable(ordered, func(a, b int) bool {
		return !isVariantMap(ordered[a].Value) && isVariantMap(ordered[b].Value)
	})
	maps := []MapInfo{}
	indexByKey := map[string]int{}
	for _, entry := range ordered {
		raw := entry.Value
		info := MapInfo{
			Key:      MapKey(stringOrEmpty(get(raw, "normalizedName"))),
			Scene:    optionalText(textIfSet(get(raw, "scenePath"))),
			NameID:   optionalText(textIfSet(get(raw, "nameId"))),
			Extracts: c.extracts(get(raw, "extracts")),
			Transits: c.transits(get(raw, "transits")),
		}
		if index, seen := indexByKey[info.Key]; seen {
			maps[index].Alt = append(maps[index].Alt, MapAltNames{Scene: info.Scene, NameID: info.NameID})
			continue
		}
		indexByKey[info.Key] = len(maps)
		maps = append(maps, info)
	}
	return maps
}

func isVariantMap(raw any) bool {
	return variantMapName.MatchString(stringOrEmpty(get(raw, "normalizedName")))
}

// mapTextOrKey translates a map-file key (extract and transit names); unknown keys are kept as they are.
func (c *rawConverter) mapTextOrKey(key any) any {
	if hasText(c.mapText, key) {
		return c.mapText[text(key)]
	}
	return key
}

func (c *rawConverter) extracts(value any) []Extract {
	extracts := []Extract{}
	for _, raw := range listOf(value) {
		position := get(raw, "position")
		if !isSet(raw) || !isSet(position) {
			continue
		}
		faction := ""
		if isSet(get(raw, "faction")) {
			faction = text(get(raw, "faction"))
		}
		extracts = append(extracts, Extract{
			N:       text(c.mapTextOrKey(get(raw, "name"))),
			Fa:      faction,
			X:       numberOr0(get(position, "x")),
			Y:       numberOr0(get(position, "y")),
			Z:       numberOr0(get(position, "z")),
			Outline: outline(get(raw, "outline")),
		})
	}
	return extracts
}

func (c *rawConverter) transits(value any) []Transit {
	transits := []Transit{}
	for _, raw := range listOf(value) {
		position := get(raw, "position")
		if !isSet(raw) || !isSet(position) {
			continue
		}
		transits = append(transits, Transit{
			N: text(c.mapTextOrKey(get(raw, "description"))),
			X: numberOr0(get(position, "x")),
			Y: numberOr0(get(position, "y")),
			Z: numberOr0(get(position, "z")),
		})
	}
	return transits
}

// ---------------------------------------------------------------- small helpers

func stringOrEmpty(value any) string {
	if s, isString := value.(string); isString {
		return s
	}
	return ""
}

// textIfSet is the value as text when it's set, else "".
func textIfSet(value any) string {
	if !isSet(value) {
		return ""
	}
	return text(value)
}

// optionalText is nil (JSON null) for "".
func optionalText(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
