package aicategorize

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"squadtaskmap/internal/gamedata"
)

func text(s string) *string { return &s }

func toJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// sortingRequest is a request with two parts: Debut (unsorted) and the Mark part of Shootout Picnic.
func sortingRequest() (Request, map[string]partInScope) {
	request := Request{
		Categories: []Category{{Name: "Boss hunts"}, {Name: "Mark"}, {Name: "Unsorted"}},
		Parts: []Part{
			{ID: "debut", TaskID: "t1", Category: "Unsorted"},
			{ID: "picnic#mark", TaskID: "t2", Label: "Mark", Category: "Mark"},
		},
	}
	tasks := map[string]gamedata.Task{"t1": {ID: "t1", Name: "Debut"}, "t2": {ID: "t2", Name: "Shootout Picnic"}}
	partByID := map[string]partInScope{}
	for _, part := range request.Parts {
		partByID[part.ID] = partInScope{Part: part, task: tasks[part.TaskID]}
	}
	return request, partByID
}

// modelAnswer is an OpenAI Responses API answer whose message is this text.
func modelAnswer(answerText string) map[string]any {
	return map[string]any{
		"id":    "resp_1",
		"model": "gpt-5.4-mini-2026-03-01",
		"usage": map[string]any{"total_tokens": 1234.0},
		"output": []any{
			map[string]any{"type": "reasoning", "summary": []any{}},
			map[string]any{"type": "message", "content": []any{map[string]any{"type": "output_text", "text": answerText}}},
		},
	}
}

func TestTheAnswerKeepsOnlyRealPartsAndCategories(t *testing.T) {
	longReason := strings.Repeat("é", 200)
	cases := []struct {
		name        string
		assignments string // the model's assignments, as JSON
		want        string // the reviewed assignments
		wantDropped string
	}{
		{
			"a move to an existing category",
			`[{"part_id":"debut","category":"Boss hunts","reason":"Kill Killa"}]`,
			`[{"part_id":"debut","name":"Debut","from":"Unsorted","category":"Boss hunts","reason":"Kill Killa"}]`, `[]`,
		},
		{
			"category names match in any case and spacing, and keep the player's spelling",
			`[{"part_id":"debut","category":"  boss HUNTS ","reason":"r"}]`,
			`[{"part_id":"debut","name":"Debut","from":"Unsorted","category":"Boss hunts","reason":"r"}]`, `[]`,
		},
		{
			"a part's label is shown after the task name",
			`[{"part_id":"picnic#mark","category":"Boss hunts","reason":"r"}]`,
			`[{"part_id":"picnic#mark","name":"Shootout Picnic (Mark)","from":"Mark","category":"Boss hunts","reason":"r"}]`, `[]`,
		},
		{
			"a move to the category the part is already in is left out",
			`[{"part_id":"picnic#mark","category":"mark","reason":"r"}]`,
			`[]`, `[]`,
		},
		{
			"an unknown part is dropped",
			`[{"part_id":"nope","category":"Mark","reason":"r"}]`,
			`[]`, `["nope → Mark"]`,
		},
		{
			"an unknown category is dropped, named by its task",
			`[{"part_id":"debut","category":"Key runs","reason":"r"}]`,
			`[]`, `["Debut → Key runs"]`,
		},
		{
			"a missing category reads like v2's undefined",
			`[{"part_id":"debut","reason":"r"}]`,
			`[]`, `["Debut → undefined"]`,
		},
		{
			"the reason is cut at 160 characters",
			`[{"part_id":"debut","category":"Mark","reason":"` + longReason + `"}]`,
			`[{"part_id":"debut","name":"Debut","from":"Unsorted","category":"Mark","reason":"` + strings.Repeat("é", 160) + `"}]`, `[]`,
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			request, partByID := sortingRequest()
			answer := `{"reply":"ok","new_categories":[],"assignments":` + testCase.assignments + `}`
			result, err := reviewAnswer(modelAnswer(answer), request, partByID, 0, "gpt-5.4-mini")
			if err != nil {
				t.Fatal(err)
			}
			if got := toJSON(t, result.Assignments); got != testCase.want {
				t.Errorf("assignments\n got %s\nwant %s", got, testCase.want)
			}
			if got := toJSON(t, result.Dropped); got != testCase.wantDropped {
				t.Errorf("dropped = %s, want %s", got, testCase.wantDropped)
			}
		})
	}
}

func TestNewCategoriesGetAValidColorAndIcon(t *testing.T) {
	cases := []struct {
		name          string
		newCategories string
		want          string
	}{
		{"a valid color and icon are kept", `[{"name":"Key runs","color":"#A1b2C3","icon":"star"}]`, `[{"name":"Key runs","color":"#A1b2C3","icon":"star"}]`},
		{"a color that isn't #rrggbb is null; an unknown icon is a circle", `[{"name":"Night","color":"red","icon":"moon"}]`, `[{"name":"Night","color":null,"icon":"circle"}]`},
		{"a short #rgb color isn't accepted", `[{"name":"Night","color":"#fff","icon":"square"}]`, `[{"name":"Night","color":null,"icon":"square"}]`},
		{"an existing category isn't created again", `[{"name":" MARK ","color":"#ffffff","icon":"star"}]`, `[]`},
		{"a nameless category is skipped", `[{"name":"","color":"#ffffff","icon":"star"}]`, `[]`},
		{"names are trimmed and cut at 40 characters", `[{"name":"  ` + strings.Repeat("x", 50) + ` ","color":"#000000","icon":"hexagon"}]`, `[{"name":"` + strings.Repeat("x", 40) + `","color":"#000000","icon":"hexagon"}]`},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			request, partByID := sortingRequest()
			answer := `{"reply":"","new_categories":` + testCase.newCategories + `,"assignments":[]}`
			result, err := reviewAnswer(modelAnswer(answer), request, partByID, 0, "gpt-5.4-mini")
			if err != nil {
				t.Fatal(err)
			}
			if got := toJSON(t, result.NewCategories); got != testCase.want {
				t.Errorf("got  %s\nwant %s", got, testCase.want)
			}
		})
	}
}

func TestANewCategoryCanBeUsedInTheSameAnswer(t *testing.T) {
	request, partByID := sortingRequest()
	answer := `{"reply":"Made Key runs.","new_categories":[{"name":"Key runs","color":"#123456","icon":"diamond"}],
		"assignments":[{"part_id":"debut","category":"key runs","reason":"Needs a key"}]}`
	result, err := reviewAnswer(modelAnswer(answer), request, partByID, 2, "gpt-5.4-mini")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Assignments) != 1 || result.Assignments[0].Category != "Key runs" {
		t.Errorf("assignments = %+v, want Debut in Key runs", result.Assignments)
	}
	if result.Reply != "Made Key runs." || result.WikiCalls != 2 || result.Model != "gpt-5.4-mini-2026-03-01" {
		t.Errorf("reply %q, wiki calls %d, model %v", result.Reply, result.WikiCalls, result.Model)
	}
	if !reflect.DeepEqual(result.Usage, map[string]any{"total_tokens": 1234.0}) {
		t.Errorf("usage = %v", result.Usage)
	}
}

func TestAnEmptyAnswerGivesEmptyListsAndTheRequestedModel(t *testing.T) {
	request, partByID := sortingRequest()
	answer := modelAnswer(`{"reply":"What do you mean?","new_categories":[],"assignments":[]}`)
	delete(answer, "model")
	result, err := reviewAnswer(answer, request, partByID, 0, "gpt-5.4-mini")
	if err != nil {
		t.Fatal(err)
	}
	got := toJSON(t, map[string]any{"n": result.NewCategories, "a": result.Assignments, "d": result.Dropped, "m": result.Model})
	if want := `{"a":[],"d":[],"m":"gpt-5.4-mini","n":[]}`; got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestAnAnswerThatIsntUsableIsAnError(t *testing.T) {
	request, partByID := sortingRequest()
	refusal := map[string]any{"output": []any{map[string]any{"type": "message", "content": []any{
		map[string]any{"type": "refusal", "refusal": "I can't help with that."},
	}}}}
	cases := []struct {
		name     string
		response map[string]any
		want     string
	}{
		{"a refusal", refusal, "The AI declined: I can't help with that."},
		{"text that isn't JSON", modelAnswer("Sure! Here you go:"), "The AI didn't return a usable answer. Try rephrasing."},
		{"no message at all", map[string]any{"output": []any{}}, "The AI didn't return a usable answer. Try rephrasing."},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := reviewAnswer(testCase.response, request, partByID, 0, "gpt-5.4-mini")
			if err == nil || err.Error() != testCase.want {
				t.Errorf("err = %v, want %q", err, testCase.want)
			}
		})
	}
}

// ---------------------------------------------------------------- what the model is told

func TestEachObjectiveIsDescribedWithOnlyTheFieldsThatApply(t *testing.T) {
	items := func(names ...string) []gamedata.Item {
		var list []gamedata.Item
		for _, name := range names {
			list = append(list, gamedata.Item{ID: name, Name: name})
		}
		return list
	}
	cases := []struct {
		name      string
		objective gamedata.Objective
		want      string
	}{
		{
			"a mark objective names its marker; a count of 1 isn't shown",
			gamedata.Objective{Type: "mark", D: "Mark the fuel tank", N: 1, Marker: &gamedata.Item{Name: "MS2000 Marker"}},
			`{"type":"mark","text":"Mark the fuel tank","marker":"MS2000 Marker"}`,
		},
		{
			"a found-in-raid hand-in shows the count and at most 6 items",
			gamedata.Objective{Type: "giveItem", D: "Hand over 3 items", N: 3, FIR: true, Items: items("a", "b", "c", "d", "e", "f", "g")},
			`{"type":"giveItem","text":"Hand over 3 items","count":3,"found_in_raid":true,"items":["a","b","c","d","e","f"]}`,
		},
		{
			"key groups: any key of a group, every group needed",
			gamedata.Objective{Type: "visit", D: "Find the room", Opt: true, Keys: [][]gamedata.Item{items("Key A", "Key B"), items("Key C")}},
			`{"type":"visit","text":"Find the room","optional":true,"keys":["Key A or Key B","Key C"]}`,
		},
		{
			"a quest item",
			gamedata.Objective{Type: "findQuestItem", D: "Find the drive", QI: text("Secure Flash drive")},
			`{"type":"findQuestItem","text":"Find the drive","quest_item":"Secure Flash drive"}`,
		},
		{
			"a kill with gear and a time window (at most 8 weapons)",
			gamedata.Objective{
				Type: "shoot", D: "Kill PMCs at night", N: 5, Targets: []string{"any PMC operatives"}, Time: []float64{21, 4},
				Gear: &gamedata.Gear{Weapons: items("w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9"), Wearing: [][]gamedata.Item{items("Ushanka", "Scav vest")}},
			},
			`{"type":"shoot","text":"Kill PMCs at night","count":5,"targets":["any PMC operatives"],"gear":{"weapon_any_of":["w1","w2","w3","w4","w5","w6","w7","w8"],"wearing":["Ushanka + Scav vest"]},"time_window":"21:00-4:00"}`,
		},
		{
			"items you must not wear",
			gamedata.Objective{Type: "shoot", D: "Kill without armor", Gear: &gamedata.Gear{NotWearing: 2}},
			`{"type":"shoot","text":"Kill without armor","gear":{"must_not_wear_items":2}}`,
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := toJSON(t, describeObjective(testCase.objective)); got != testCase.want {
				t.Errorf("got  %s\nwant %s", got, testCase.want)
			}
		})
	}
}

func TestATasksMapsAreListedOnceByDisplayName(t *testing.T) {
	displayName := func(key string) string { return strings.ToUpper(key[:1]) + key[1:] }
	cases := []struct {
		name string
		task gamedata.Task
		want []string
	}{
		{
			"the task's map first, then its objectives' maps and zones, once each",
			gamedata.Task{Map: text("customs"), Objs: []gamedata.Objective{
				{Maps: []string{"customs", "woods"}, Zones: []gamedata.Zone{{M: "factory"}, {M: "woods"}, {M: ""}}},
				{Maps: []string{"factory"}},
			}},
			[]string{"Customs", "Woods", "Factory"},
		},
		{"no map at all is an empty list", gamedata.Task{}, []string{}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := taskMapNames(testCase.task, displayName)
			if got == nil || !reflect.DeepEqual(got, testCase.want) {
				t.Errorf("got %#v, want %#v", got, testCase.want)
			}
		})
	}
}

func TestEachPartIsDescribedWithItsOwnObjectivesAndAWikiExcerpt(t *testing.T) {
	task := gamedata.Task{ID: "t1", Name: "Shootout Picnic", Trader: "Prapor", Map: text("woods"), Objs: []gamedata.Objective{
		{ID: "o1", Type: "mark", D: "Mark the tank"},
		{ID: "o2", Type: "shoot", D: "Kill 5 Scavs", N: 5},
	}}
	other := gamedata.Task{ID: "t2", Name: "Debut", Trader: "Prapor"}
	parts := []partInScope{
		{Part: Part{ID: "t1#mark", TaskID: "t1", ObjIDs: []string{"o1"}, Label: "Mark", Category: "Mark"}, task: task},
		{Part: Part{ID: "t1#kill", TaskID: "t1", ObjIDs: []string{"o2"}, Label: "Kills", Category: "Unsorted"}, task: task},
		{Part: Part{ID: "t2", TaskID: "t2", ObjIDs: []string{"nothing"}, Category: "Unsorted"}, task: other},
	}
	wiki := map[string]*WikiEntry{"t1": {Title: "Shootout Picnic", Text: "== Objectives ==\nMark it."}, "t2": {Title: "Debut", Missing: true}}
	got := toJSON(t, describeParts(parts, wiki, strings.ToUpper))
	want := `[` +
		`{"id":"t1#mark","task":"Shootout Picnic","part":"Mark","trader":"Prapor","current_category":"Mark","maps":["WOODS"],"objectives":[{"type":"mark","text":"Mark the tank"}],"wiki":"Objectives: Mark it.\n"},` +
		`{"id":"t1#kill","task":"Shootout Picnic","part":"Kills","trader":"Prapor","current_category":"Unsorted","maps":["WOODS"],"objectives":[{"type":"shoot","text":"Kill 5 Scavs","count":5}],"wiki":"Objectives: Mark it.\n"},` +
		`{"id":"t2","task":"Debut","part":"","trader":"Prapor","current_category":"Unsorted","maps":[],"objectives":[],"wiki":"(no wiki page found)"}` +
		`]`
	if got != want {
		t.Errorf("got  %s\nwant %s", got, want)
	}
}

func TestTheWikiExcerptGetsShorterAsMorePartsAreSent(t *testing.T) {
	cases := []struct {
		name  string
		parts int
		want  int
	}{
		{"one part", 1, 1100},
		{"40 parts", 40, 1100},
		{"41 parts", 41, 750},
		{"80 parts", 80, 750},
		{"81 parts", 81, 450},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := excerptLength(testCase.parts); got != testCase.want {
				t.Errorf("got %d, want %d", got, testCase.want)
			}
		})
	}
}

func TestTheContextListsTheCategoriesThenTheParts(t *testing.T) {
	request := Request{MapName: "Customs", Categories: []Category{
		{Name: "Boss hunts", Builtin: text("boss"), Color: "#cc3333", Count: 3},
		{Name: "Key runs", Color: "#123456", Count: 0},
		{Name: "Odd", Builtin: text(""), Color: "#000000", Count: 1},
	}}
	got := contextMessage(request, []partForModel{})
	want := "MAP / SCOPE: Customs\n\nCATEGORIES:\n" +
		"- \"Boss hunts\" (built-in: boss), 3 tasks, color #cc3333\n" +
		"- \"Key runs\", 0 tasks, color #123456\n" +
		"- \"Odd\", 1 tasks, color #000000\n\nPARTS:\n[]"
	if got != want {
		t.Errorf("got  %q\nwant %q", got, want)
	}
}

func TestReasoningEffortIsTheUsersChoiceElseMediumWhereSupported(t *testing.T) {
	cases := []struct {
		name, model, effort string
		want                map[string]any
	}{
		{"a reasoning model with no setting", "gpt-5.4-mini", "", map[string]any{"effort": "medium"}},
		{"an o-series model with no setting", "o3", "", map[string]any{"effort": "medium"}},
		{"the user's setting wins", "gpt-5.4-mini", "high", map[string]any{"effort": "high"}},
		{"a model without reasoning gets none", "gpt-4.1", "", nil},
		{"the user's setting is sent even then", "gpt-4.1", "low", map[string]any{"effort": "low"}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := reasoningFor(testCase.model, testCase.effort); !reflect.DeepEqual(got, testCase.want) {
				t.Errorf("got %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestNumbersAndCutsMatchJavaScript(t *testing.T) {
	numbers := []struct {
		name   string
		number float64
		want   string
	}{
		{"zero", 0, "0"},
		{"a whole number has no decimals", 21, "21"},
		{"trailing zeros of a whole number stay", 100, "100"},
		{"a fraction", 1.5, "1.5"},
		{"a negative number", -2, "-2"},
	}
	for _, testCase := range numbers {
		t.Run(testCase.name, func(t *testing.T) {
			if got := jsNumber(testCase.number); got != testCase.want {
				t.Errorf("got %q, want %q", got, testCase.want)
			}
		})
	}
	cuts := []struct {
		name  string
		text  string
		limit int
		want  string
	}{
		{"shorter text stays", "abc", 5, "abc"},
		{"accented letters count once", "ééé", 2, "éé"},
		{"an emoji counts twice, as in JavaScript", "a😀b", 3, "a😀"},
	}
	for _, testCase := range cuts {
		t.Run(testCase.name, func(t *testing.T) {
			if got := utf16Prefix(testCase.text, testCase.limit); got != testCase.want {
				t.Errorf("got %q, want %q", got, testCase.want)
			}
		})
	}
}
