package gamedata

// ItemIDs is every item id the page can ask an icon for, taken from the game data: marker items,
// items to plant or hand in, quest items (qiId), keys, and the gear of kill objectives (the Bring
// list shows all of these). The icon cache fetches only these ids.
// Also the loose-loot items and the keys of locked doors (ticket 08), which LootData.ItemNames
// lists. This is the only place the set is built.
func ItemIDs(data GameData) map[string]bool {
	ids := map[string]bool{MS2000Marker.ID: true}
	add := func(id string) {
		if id != "" {
			ids[id] = true
		}
	}
	addItems := func(items []Item) {
		for _, item := range items {
			add(item.ID)
		}
	}
	addGroups := func(groups [][]Item) {
		for _, group := range groups {
			addItems(group)
		}
	}
	for _, task := range data.Tasks {
		for _, objective := range task.Objs {
			addGroups(objective.Keys)
			addItems(objective.Items)
			if objective.Marker != nil {
				add(objective.Marker.ID)
			}
			if objective.QIID != nil {
				add(*objective.QIID)
			}
			if objective.Gear != nil {
				addItems(objective.Gear.Weapons)
				addGroups(objective.Gear.Mods)
				addGroups(objective.Gear.Wearing)
			}
		}
	}
	if data.Loot != nil {
		for id := range data.Loot.ItemNames {
			add(id)
		}
	}
	return ids
}
