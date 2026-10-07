package gamedata

import "testing"

func TestItemIDsCoverEveryItemThePageShowsAnIconFor(t *testing.T) {
	qiID := "66a0f0926fee20fa70036da6"
	data := GameData{Tasks: []Task{{Objs: []Objective{
		{Keys: [][]Item{{{ID: "aaaaaaaaaaaaaaaaaaaaaaaa"}}}, Items: []Item{{ID: "bbbbbbbbbbbbbbbbbbbbbbbb"}}},
		{Marker: &Item{ID: "cccccccccccccccccccccccc"}, QIID: &qiID},
		{Gear: &Gear{Weapons: []Item{{ID: "dddddddddddddddddddddddd"}}, Mods: [][]Item{{{ID: "eeeeeeeeeeeeeeeeeeeeeeee"}}}, Wearing: [][]Item{{{ID: "ffffffffffffffffffffffff"}}}}},
	}}}}
	ids := ItemIDs(data)
	for _, id := range []string{"aaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccccccc", qiID,
		"dddddddddddddddddddddddd", "eeeeeeeeeeeeeeeeeeeeeeee", "ffffffffffffffffffffffff", MS2000Marker.ID} {
		if !ids[id] {
			t.Errorf("%s is missing", id)
		}
	}
	if ids["123456789012345678901234"] {
		t.Error("an unrelated id is known")
	}
}

func TestLootItemsAndLockKeysGetIcons(t *testing.T) {
	data := GameData{Loot: &LootData{ItemNames: map[string]string{
		"5c94bbff86f7747ee735c08f": "TerraGroup Labs access keycard",
		"5780cf7f2459777de4559322": "Dorm room 314 marked key",
	}}}
	ids := ItemIDs(data)
	for id := range data.Loot.ItemNames {
		if !ids[id] {
			t.Errorf("%s (%s) is not in the icon set", id, data.Loot.ItemNames[id])
		}
	}
}
