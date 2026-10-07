package gamedata

import (
	"encoding/json"
	"testing"
)

// withoutQuestItemIDs removes the "qiId" fields (ticket 07) from converted data: the v2 goldens
// were captured before they existed, and everything else must still match them.
func withoutQuestItemIDs(t *testing.T, converted []byte) []byte {
	t.Helper()
	var document map[string]any
	if err := json.Unmarshal(converted, &document); err != nil {
		t.Fatal(err)
	}
	tasks, _ := document["tasks"].([]any)
	for _, task := range tasks {
		objectives, _ := task.(map[string]any)["objs"].([]any)
		for _, objective := range objectives {
			delete(objective.(map[string]any), "qiId")
		}
	}
	stripped, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	return stripped
}

func TestQuestItemObjectivesCarryTheQuestItemsId(t *testing.T) {
	read := func(name string) json.RawMessage {
		return readMaybeGzipped(t, repoPath("testdata", "jsontarkovdev", "regular-"+name+".json.gz"))
	}
	converted, err := FromRaw(RawDocs{Tasks: read("tasks"), TasksEn: read("tasks_en"), Maps: read("maps"), MapsEn: read("maps_en"),
		Traders: read("traders"), TradersEn: read("traders_en"), ItemsEn: read("items_en")}, "regular", goldenTime())
	if err != nil {
		t.Fatal(err)
	}
	withQuestItem, withID := 0, 0
	for _, task := range converted.Tasks {
		for _, objective := range task.Objs {
			if objective.QI == nil {
				if objective.QIID != nil {
					t.Errorf("%s has a quest item id but no quest item name", objective.ID)
				}
				continue
			}
			withQuestItem++
			if objective.QIID != nil && itemIDPattern.MatchString(*objective.QIID) {
				withID++
			}
		}
	}
	if withQuestItem == 0 || withID != withQuestItem {
		t.Errorf("%d objectives have a quest item, %d of them have its id", withQuestItem, withID)
	}
}
