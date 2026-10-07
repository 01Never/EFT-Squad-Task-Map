package gamedata

// Loot spots (ticket 08): containers, loose loot and locked doors per map, taken from
// json.tarkov.dev's {mode}/maps file. Pure functions, no I/O. They're served per map at
// /api/loot/<map> (too big for /api/data, see README), so they live next to GameData rather than
// inside it, and v2's golden outputs stay as they are.
//
// Where the data is (checked on the real files of 2026-10-05, testdata/jsontarkovdev):
//   - data.maps.<id>.lootContainers: [{lootContainer: "<container id>", position: {x, y, z}}]
//   - data.lootContainers.<container id>: {id, name: "<id> Name", normalizedName}; the English
//     name is in maps_en. Several ids share a normalizedName (4 kinds of weapon box), which is
//     the type the page groups by.
//   - data.maps.<id>.lootLoose: [{items: ["<item id>", ...], position}]; a curated list of
//     notable items (keys, valuables, intel, electronics, stims, posters), names in items_en.
//   - data.maps.<id>.locks: [{id, lockType: "door"|"trunk", key: "<item id>", needsPower,
//     position}], and for a few: size, outline [{x, y, z}], top, bottom.

import "math"

// LootData is every map's loot spots plus the names the page shows for them.
type LootData struct {
	Maps      map[string]MapLoot `json:"maps"`      // by map key ("customs")
	Types     map[string]string  `json:"types"`     // container type → display name ("pc-block" → "PC block")
	ItemNames map[string]string  `json:"itemNames"` // loose items and lock keys: item id → name
}

// MapLoot is one map's loot spots. Coordinates are game coordinates (y = height), rounded to
// centimetres; the page projects them like task zones.
type MapLoot struct {
	Containers []LootContainer `json:"containers"`
	Loose      []LooseLoot     `json:"loose"`
	Locks      []Lock          `json:"locks"`
}

// LootContainer is one container: a safe, a jacket, a PC block…
type LootContainer struct {
	T string  `json:"t"` // type: the container's normalizedName ("safe", "weapon-box")
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

// LooseLoot is one spot where loose items may spawn.
type LooseLoot struct {
	I []string `json:"i"` // the item ids that can spawn here (names in LootData.ItemNames)
	X float64  `json:"x"`
	Y float64  `json:"y"`
	Z float64  `json:"z"`
}

// Lock is a locked door or car trunk and the key that opens it. Ticket 08 only extracts these;
// ticket 09 (My keys) shows them.
type Lock struct {
	Key   string  `json:"key"`   // the key's item id (name in LootData.ItemNames)
	Type  string  `json:"type"`  // "door" or "trunk"
	Power bool    `json:"power"` // needs the power switched on first
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Z     float64 `json:"z"`
	// Only some locks have an area: its outline as [x, z] points, and its top and bottom
	// heights. Left out (not null) when the data has none.
	Outline *[][]float64 `json:"ol,omitempty"`
	Top     *float64     `json:"top,omitempty"`
	Bottom  *float64     `json:"bottom,omitempty"`
}

// MapLootAnswer is /api/loot/<map>: one map's spots with the names they use.
type MapLootAnswer struct {
	Map string `json:"map"`
	// False when the data in use has no loot (the snapshot built into the exe, until the first
	// download): the page then says so instead of showing empty chips.
	Available bool `json:"available"`
	MapLoot
	Types     map[string]string `json:"lootTypes"`
	ItemNames map[string]string `json:"items"` // only the items and keys this map uses
}

// lootFromMaps reads the loot of every map. A map variant that shares a key with another
// (Night Factory, Ground Zero 21+) keeps the plain map's loot (so variants are read second); only
// the door outlines a variant adds are kept.
func (c *rawConverter) lootFromMaps(rawMaps []orderedEntry, containerKinds map[string]any) *LootData {
	loot := &LootData{Maps: map[string]MapLoot{}, Types: map[string]string{}, ItemNames: map[string]string{}}
	typeOfContainer := map[string]string{}
	for id, kind := range containerKinds {
		lootType := stringOrEmpty(get(kind, "normalizedName"))
		if lootType == "" {
			continue
		}
		typeOfContainer[id] = lootType
		loot.Types[lootType] = text(c.mapTextOrKeyOr(get(kind, "name"), lootType))
	}
	for _, entry := range plainMapsFirst(rawMaps) {
		key := MapKey(stringOrEmpty(get(entry.Value, "normalizedName")))
		if key == "" {
			continue
		}
		if plainLoot, alreadyRead := loot.Maps[key]; alreadyRead {
			addOutlinesFromVariant(plainLoot.Locks, locksOf(get(entry.Value, "locks")))
			continue
		}
		loot.Maps[key] = MapLoot{
			Containers: containersOf(get(entry.Value, "lootContainers"), typeOfContainer),
			Loose:      looseLootOf(get(entry.Value, "lootLoose")),
			Locks:      locksOf(get(entry.Value, "locks")),
		}
	}
	for _, mapLoot := range loot.Maps {
		for _, id := range itemIDsUsedBy(mapLoot) {
			loot.ItemNames[id] = c.itemName(id)
		}
	}
	return loot
}

// plainMapsFirst lists the maps with variants (Night Factory…) after the plain ones, keeping the
// file order otherwise.
func plainMapsFirst(rawMaps []orderedEntry) []orderedEntry {
	ordered := []orderedEntry{}
	variants := []orderedEntry{}
	for _, entry := range rawMaps {
		if isVariantMap(entry.Value) {
			variants = append(variants, entry)
		} else {
			ordered = append(ordered, entry)
		}
	}
	return append(ordered, variants...)
}

// mapTextOrKeyOr translates a maps_en key; without a translation it's the fallback.
func (c *rawConverter) mapTextOrKeyOr(key any, fallback string) any {
	if hasText(c.mapText, key) {
		return c.mapText[text(key)]
	}
	return fallback
}

// containersOf reads a map's containers. One whose kind isn't in the file's container list has
// no type to show, so it's skipped, as is one without a position.
func containersOf(value any, typeOfContainer map[string]string) []LootContainer {
	containers := []LootContainer{}
	for _, raw := range listOf(value) {
		lootType, isKnown := typeOfContainer[stringOrEmpty(get(raw, "lootContainer"))]
		x, y, z, hasPosition := positionOf(raw)
		if !isKnown || !hasPosition {
			continue
		}
		containers = append(containers, LootContainer{T: lootType, X: x, Y: y, Z: z})
	}
	return containers
}

// looseLootOf reads a map's loose-loot spots. A spot without items or position is skipped.
func looseLootOf(value any) []LooseLoot {
	spots := []LooseLoot{}
	for _, raw := range listOf(value) {
		itemIDs := []string{}
		for _, item := range listOf(get(raw, "items")) {
			if id := stringOrEmpty(item); id != "" {
				itemIDs = append(itemIDs, id)
			}
		}
		x, y, z, hasPosition := positionOf(raw)
		if len(itemIDs) == 0 || !hasPosition {
			continue
		}
		spots = append(spots, LooseLoot{I: itemIDs, X: x, Y: y, Z: z})
	}
	return spots
}

// locksOf reads a map's locked doors and trunks. A lock without a key or position is skipped.
func locksOf(value any) []Lock {
	locks := []Lock{}
	for _, raw := range listOf(value) {
		key := stringOrEmpty(get(raw, "key"))
		x, y, z, hasPosition := positionOf(raw)
		if key == "" || !hasPosition {
			continue
		}
		power, _ := get(raw, "needsPower").(bool)
		lock := Lock{Key: key, Type: stringOrEmpty(get(raw, "lockType")), Power: power, X: x, Y: y, Z: z}
		lock.Outline = outline(get(raw, "outline"))
		lock.Top = roundedNumberOrNil(get(raw, "top"))
		lock.Bottom = roundedNumberOrNil(get(raw, "bottom"))
		locks = append(locks, lock)
	}
	return locks
}

// A variant's lock is the same door as a plain-map lock when it has the same key and stands
// within this distance. In the 2026-10-05 data only the variants (Night Factory, Ground Zero
// 21+) have door outlines, and each one matched a plain-map door within 1 cm.
const sameDoorDistanceMeters = 0.5

// addOutlinesFromVariant gives the plain map's doors the outline, top and bottom the variant has
// for the same door, when the plain map has none of its own.
func addOutlinesFromVariant(plainLocks []Lock, variantLocks []Lock) {
	for index := range plainLocks {
		lock := &plainLocks[index]
		if lock.Outline != nil {
			continue
		}
		for _, variant := range variantLocks {
			isSameDoor := variant.Key == lock.Key &&
				math.Hypot(variant.X-lock.X, variant.Z-lock.Z) <= sameDoorDistanceMeters
			if isSameDoor && variant.Outline != nil {
				lock.Outline, lock.Top, lock.Bottom = variant.Outline, variant.Top, variant.Bottom
				break
			}
		}
	}
}

// positionOf reads {position: {x, y, z}} rounded to centimetres; false when there's no position
// or x/z aren't numbers. A missing height counts as 0, as for task zones.
func positionOf(raw any) (x, y, z float64, ok bool) {
	position := get(raw, "position")
	rawX, xIsNumber := get(position, "x").(float64)
	rawZ, zIsNumber := get(position, "z").(float64)
	if !isSet(position) || !xIsNumber || !zIsNumber {
		return 0, 0, 0, false
	}
	return roundToHundredths(rawX), roundToHundredths(numberOr0(get(position, "y"))), roundToHundredths(rawZ), true
}

func roundedNumberOrNil(value any) *float64 {
	number, isNumber := value.(float64)
	if !isNumber {
		return nil
	}
	rounded := roundToHundredths(number)
	return &rounded
}

// itemIDsUsedBy lists the items a map's loose spots and locks name (each once).
func itemIDsUsedBy(mapLoot MapLoot) []string {
	seen := map[string]bool{}
	ids := []string{}
	add := func(id string) {
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	for _, spot := range mapLoot.Loose {
		for _, id := range spot.I {
			add(id)
		}
	}
	for _, lock := range mapLoot.Locks {
		add(lock.Key)
	}
	return ids
}

// AnswerForMap is the /api/loot/<map> answer for one map. A map without loot in this data gets
// empty lists (and Available = false when the data has no loot at all).
func (loot *LootData) AnswerForMap(mapKey string) MapLootAnswer {
	answer := MapLootAnswer{
		Map:       mapKey,
		MapLoot:   MapLoot{Containers: []LootContainer{}, Loose: []LooseLoot{}, Locks: []Lock{}},
		Types:     map[string]string{},
		ItemNames: map[string]string{},
	}
	if loot == nil {
		return answer
	}
	answer.Available = true
	answer.Types = loot.Types
	mapLoot, hasLoot := loot.Maps[mapKey]
	if !hasLoot {
		return answer
	}
	answer.MapLoot = mapLoot
	for _, id := range itemIDsUsedBy(mapLoot) {
		answer.ItemNames[id] = loot.ItemNames[id]
	}
	return answer
}
