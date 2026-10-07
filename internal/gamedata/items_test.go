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
