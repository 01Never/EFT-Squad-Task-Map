package gamedata

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// Loot spots (ticket 08). The inputs are real json.tarkov.dev files (2026-10-05): the full maps
// file in testdata/jsontarkovdev, and loot-sample-maps.json.gz, a few real Factory and Night
// Factory spots trimmed from it so the rules can be read case by case.

func realLootDocs(t *testing.T, mapsFile string) RawDocs {
	t.Helper()
	read := func(name string) json.RawMessage {
		return readMaybeGzipped(t, repoPath("testdata", "jsontarkovdev", name))
	}
	noTasks := json.RawMessage(`{"data":{"tasks":{}}}`)
	return RawDocs{Tasks: noTasks, Maps: read(mapsFile), MapsEn: read("regular-maps_en.json.gz"), ItemsEn: read("regular-items_en.json.gz")}
}

func convertLoot(t *testing.T, docs RawDocs) *LootData {
	t.Helper()
	converted, err := FromRaw(docs, "regular", goldenTime())
	if err != nil {
		t.Fatal(err)
	}
	if converted.Loot == nil {
		t.Fatal("no loot in the converted data")
	}
	return converted.Loot
}

func TestLootFromTheTrimmedRealSample(t *testing.T) {
	loot := convertLoot(t, realLootDocs(t, "loot-sample-maps.json.gz"))
	factory := loot.Maps["factory"]

	t.Run("containers keep their type and a centimetre position", func(t *testing.T) {
		var types []string
		for _, container := range factory.Containers {
			types = append(types, container.T)
		}
		if got := strings.Join(types, ","); got != "safe,safe,jacket,jacket" {
			t.Errorf("types = %s", got)
		}
		first := factory.Containers[0] // real position {21.10839, 8.376442, 40.6695251}
		if first.X != 21.11 || first.Y != 8.38 || first.Z != 40.67 {
			t.Errorf("first container at %v, %v, %v", first.X, first.Y, first.Z)
		}
	})

	t.Run("Night Factory shares the key and doesn't replace the day map's spots", func(t *testing.T) {
		if len(loot.Maps) != 1 || len(factory.Containers) != 4 {
			t.Errorf("maps = %d, factory containers = %d", len(loot.Maps), len(factory.Containers))
		}
	})

	t.Run("a loose spot lists every item that can spawn there", func(t *testing.T) {
		if len(factory.Loose) != 2 || len(factory.Loose[0].I) != 1 || len(factory.Loose[1].I) != 3 {
			t.Errorf("loose = %+v", factory.Loose)
		}
	})

	t.Run("a door gets the outline Night Factory has for the same door", func(t *testing.T) {
		if len(factory.Locks) != 1 {
			t.Fatalf("locks = %+v", factory.Locks)
		}
		door := factory.Locks[0]
		if door.Key != "5448ba0b4bdc2d02308b456c" || door.Type != "door" || door.Power {
			t.Errorf("door = %+v", door)
		}
		if door.Outline == nil || len(*door.Outline) != 4 || door.Top == nil || *door.Top != 1.95 || *door.Bottom != 0.95 {
			t.Errorf("outline %v, top %v, bottom %v", door.Outline, door.Top, door.Bottom)
		}
	})

	t.Run("container types and items get their English names", func(t *testing.T) {
		if loot.Types["safe"] != "Safe" || loot.Types["jacket"] != "Jacket" {
			t.Errorf("types = %v", loot.Types)
		}
		if loot.ItemNames["5448ba0b4bdc2d02308b456c"] != "Factory emergency exit key" {
			t.Errorf("key name = %q", loot.ItemNames["5448ba0b4bdc2d02308b456c"])
		}
		for id, name := range loot.ItemNames {
			if name == id {
				t.Errorf("item %s has no name", id)
			}
		}
	})
}

func TestLootSpotsWithMissingPartsAreSkipped(t *testing.T) {
	typeOfContainer := map[string]string{"kind-safe": "safe"}
	cases := []struct {
		name  string
		count func() int
		want  int
	}{
		{"a container of a kind the file doesn't list", func() int {
			return len(containersOf([]any{map[string]any{"lootContainer": "unknown", "position": map[string]any{"x": 1.0, "z": 2.0}}}, typeOfContainer))
		}, 0},
		{"a container without a position", func() int {
			return len(containersOf([]any{map[string]any{"lootContainer": "kind-safe"}}, typeOfContainer))
		}, 0},
		{"a container with a position but no height (counts as 0)", func() int {
			return len(containersOf([]any{map[string]any{"lootContainer": "kind-safe", "position": map[string]any{"x": 1.0, "z": 2.0}}}, typeOfContainer))
		}, 1},
		{"a loose spot without items", func() int {
			return len(looseLootOf([]any{map[string]any{"items": []any{}, "position": map[string]any{"x": 1.0, "z": 2.0}}}))
		}, 0},
		{"a lock without a key", func() int {
			return len(locksOf([]any{map[string]any{"lockType": "door", "position": map[string]any{"x": 1.0, "z": 2.0}}}))
		}, 0},
		{"a lock with a key and a position", func() int {
			return len(locksOf([]any{map[string]any{"key": "k", "lockType": "trunk", "position": map[string]any{"x": 1.0, "z": 2.0}}}))
		}, 1},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := testCase.count(); got != testCase.want {
				t.Errorf("got %d spots, want %d", got, testCase.want)
			}
		})
	}
}

func TestALockWithoutAnAreaLeavesOutlineTopAndBottomOut(t *testing.T) {
	locks := locksOf([]any{map[string]any{"key": "k", "lockType": "door", "needsPower": true, "position": map[string]any{"x": 1.0, "y": 2.0, "z": 3.0}}})
	encoded, _ := json.Marshal(locks[0])
	if string(encoded) != `{"key":"k","type":"door","power":true,"x":1,"y":2,"z":3}` {
		t.Errorf("encoded = %s", encoded)
	}
}

func TestAVariantDoorIsTheSameDoorOnlyWithTheSameKeyAndPlace(t *testing.T) {
	area := &[][]float64{{0, 0}, {1, 0}, {1, 1}}
	variant := []Lock{{Key: "k", X: 10, Z: 10, Outline: area}}
	cases := []struct {
		name        string
		plain       Lock
		wantOutline bool
	}{
		{"same key, 1 cm away", Lock{Key: "k", X: 10.01, Z: 10}, true},
		{"same key, 2 m away", Lock{Key: "k", X: 12, Z: 10}, false},
		{"another key, same place", Lock{Key: "other", X: 10, Z: 10}, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			plain := []Lock{testCase.plain}
			addOutlinesFromVariant(plain, variant)
			if got := plain[0].Outline != nil; got != testCase.wantOutline {
				t.Errorf("has outline = %v, want %v", got, testCase.wantOutline)
			}
		})
	}
}

// rawLootCounts counts a map's spots straight from the raw file, independently of the converter.
func rawLootCounts(t *testing.T, normalizedName string) (containersByType map[string]int, loose, locks int) {
	t.Helper()
	var document struct {
		Data struct {
			Maps map[string]struct {
				NormalizedName string           `json:"normalizedName"`
				LootContainers []map[string]any `json:"lootContainers"`
				LootLoose      []any            `json:"lootLoose"`
				Locks          []any            `json:"locks"`
			} `json:"maps"`
			LootContainers map[string]struct {
				NormalizedName string `json:"normalizedName"`
			} `json:"lootContainers"`
		} `json:"data"`
	}
	if err := json.Unmarshal(readMaybeGzipped(t, repoPath("testdata", "jsontarkovdev", "regular-maps.json.gz")), &document); err != nil {
		t.Fatal(err)
	}
	containersByType = map[string]int{}
	for _, info := range document.Data.Maps {
		if info.NormalizedName != normalizedName {
			continue
		}
		for _, container := range info.LootContainers {
			kind := document.Data.LootContainers[container["lootContainer"].(string)]
			containersByType[kind.NormalizedName]++
		}
		return containersByType, len(info.LootLoose), len(info.Locks)
	}
	t.Fatalf("no map %s in the real file", normalizedName)
	return nil, 0, 0
}

func TestLootCountsPerTypeMatchTheSourceData(t *testing.T) {
	loot := convertLoot(t, realLootDocs(t, "regular-maps.json.gz"))
	cases := []struct {
		mapKey                             string
		wantContainers, wantSafes          int
		wantPCBlocks, wantLoose, wantLocks int
	}{
		// Totals in the real file of 2026-10-05, also counted independently by rawLootCounts.
		{"customs", 551, 8, 14, 306, 36},
		{"interchange", 823, 0, 54, 483, 28},
		{"streets-of-tarkov", 1282, 11, 54, 942, 63},
	}
	for _, testCase := range cases {
		t.Run(testCase.mapKey, func(t *testing.T) {
			mapLoot := loot.Maps[testCase.mapKey]
			convertedByType := map[string]int{}
			for _, container := range mapLoot.Containers {
				convertedByType[container.T]++
			}
			rawByType, rawLoose, rawLocks := rawLootCounts(t, testCase.mapKey)
			for lootType, rawCount := range rawByType {
				if convertedByType[lootType] != rawCount {
					t.Errorf("%s: %d converted, %d in the source", lootType, convertedByType[lootType], rawCount)
				}
			}
			if len(mapLoot.Loose) != rawLoose || len(mapLoot.Locks) != rawLocks {
				t.Errorf("loose %d/%d, locks %d/%d (converted/source)", len(mapLoot.Loose), rawLoose, len(mapLoot.Locks), rawLocks)
			}
			got := [5]int{len(mapLoot.Containers), convertedByType["safe"], convertedByType["pc-block"], len(mapLoot.Loose), len(mapLoot.Locks)}
			want := [5]int{testCase.wantContainers, testCase.wantSafes, testCase.wantPCBlocks, testCase.wantLoose, testCase.wantLocks}
			if got != want {
				t.Errorf("containers, safes, PC blocks, loose, locks = %v, want %v", got, want)
			}
		})
	}
}

// The converter's loot for the real files, kept as a golden file so a change shows up as a diff.
// STM_UPDATE_GOLDEN=1 rewrites it (only after a deliberate change; say so in the commit).
func TestLootOfTheRealFilesMatchesItsGolden(t *testing.T) {
	loot := convertLoot(t, realLootDocs(t, "regular-maps.json.gz"))
	encoded, err := json.Marshal(loot)
	if err != nil {
		t.Fatal(err)
	}
	goldenPath := repoPath("testdata", "golden", "loot-real.json.gz")
	if os.Getenv("STM_UPDATE_GOLDEN") == "1" {
		var zipped bytes.Buffer
		writer := gzip.NewWriter(&zipped)
		writer.Write(encoded)
		writer.Close()
		if err := os.WriteFile(goldenPath, zipped.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	assertSameJSON(t, readMaybeGzipped(t, goldenPath), encoded)
}

func TestTheAnswerForOneMap(t *testing.T) {
	loot := &LootData{
		Maps: map[string]MapLoot{"customs": {
			Containers: []LootContainer{{T: "safe", X: 1, Z: 2}},
			Loose:      []LooseLoot{{I: []string{"item-a"}, X: 3, Z: 4}},
			Locks:      []Lock{{Key: "key-b", Type: "door", X: 5, Z: 6}},
		}},
		Types:     map[string]string{"safe": "Safe"},
		ItemNames: map[string]string{"item-a": "A", "key-b": "B", "elsewhere": "C"},
	}
	cases := []struct {
		name          string
		loot          *LootData
		mapKey        string
		wantAvailable bool
		wantSpots     int
		wantItems     int
	}{
		{"a map with loot gets its spots and only the names it uses", loot, "customs", true, 3, 2},
		{"a map without loot in this data gets empty lists", loot, "woods", true, 0, 0},
		{"data without loot (the built-in snapshot) says it's not available", nil, "customs", false, 0, 0},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			answer := testCase.loot.AnswerForMap(testCase.mapKey)
			spots := len(answer.Containers) + len(answer.Loose) + len(answer.Locks)
			if answer.Available != testCase.wantAvailable || spots != testCase.wantSpots || len(answer.ItemNames) != testCase.wantItems {
				t.Errorf("available %v, spots %d, items %d", answer.Available, spots, len(answer.ItemNames))
			}
			encoded, _ := json.Marshal(answer)
			if !strings.Contains(string(encoded), `"containers":[`) || !strings.Contains(string(encoded), `"lootTypes":{`) {
				t.Errorf("lists must be [] and maps {} (never null): %s", encoded)
			}
		})
	}
}

func TestTheStoreAnswersOnlyForMapsTheDataKnows(t *testing.T) {
	store := &Store{}
	store.setCurrentLocked(GameData{Maps: []MapInfo{{Key: "customs"}}, Loot: &LootData{
		Maps: map[string]MapLoot{"the-lab": {}}, Types: map[string]string{}, ItemNames: map[string]string{},
	}})
	cases := []struct {
		mapKey    string
		wantKnown bool
	}{
		{"customs", true},
		{"the-lab", true}, // loot of its own, though the page has no art for it
		{"woods", false},
		{"../settings", false},
	}
	for _, testCase := range cases {
		t.Run(testCase.mapKey, func(t *testing.T) {
			encoded, isKnown := store.LootJSON(testCase.mapKey)
			if isKnown != testCase.wantKnown {
				t.Fatalf("known = %v", isKnown)
			}
			if isKnown && !json.Valid(encoded) {
				t.Errorf("not JSON: %s", encoded)
			}
		})
	}
	first, _ := store.LootJSON("customs")
	again, _ := store.LootJSON("customs")
	if &first[0] != &again[0] {
		t.Error("the answer should be encoded once and reused")
	}
}

func TestASavedCopyKeepsItsLoot(t *testing.T) {
	data := GameData{Format: "stm-v2", Tasks: make([]Task, 101), Loot: &LootData{Maps: map[string]MapLoot{"customs": {}}}}
	path := t.TempDir() + "/cache.json"
	if err := saveCache(path, cacheFile{FetchedAt: 1, Data: data, Loot: data.Loot}); err != nil {
		t.Fatal(err)
	}
	encoded, _ := os.ReadFile(path)
	var reread cacheFile
	json.Unmarshal(encoded, &reread)
	if reread.Loot == nil || len(reread.Loot.Maps) != 1 {
		t.Errorf("loot after reading the saved copy: %+v", reread.Loot)
	}
}
