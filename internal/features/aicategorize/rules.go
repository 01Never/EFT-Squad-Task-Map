// AI Categorize's rules, as plain functions: what the model is told about each part, and how its
// answer is checked against what's real. categorize.go talks to OpenAI and the wiki.

package aicategorize

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"squadtaskmap/internal/gamedata"
	"squadtaskmap/internal/openai"
	"strings"
	"unicode/utf16"
)

// reasoningFor: the user's effort setting; else "medium" for models that support reasoning.
func reasoningFor(model, effort string) map[string]any {
	if effort != "" {
		return map[string]any{"effort": effort}
	}
	if openai.SupportsReasoning(model) {
		return map[string]any{"effort": "medium"}
	}
	return nil
}

// partForModel is one entry of PARTS (field order as v2 sent it).
type partForModel struct {
	ID              string              `json:"id"`
	Task            string              `json:"task"`
	Part            string              `json:"part"`
	Trader          string              `json:"trader"`
	CurrentCategory string              `json:"current_category"`
	Maps            []string            `json:"maps"`
	Objectives      []objectiveForModel `json:"objectives"`
	Wiki            string              `json:"wiki"`
}

type objectiveForModel struct {
	Type        string        `json:"type"`
	Text        string        `json:"text"`
	Count       float64       `json:"count,omitempty"`
	FoundInRaid bool          `json:"found_in_raid,omitempty"`
	Optional    bool          `json:"optional,omitempty"`
	Keys        []string      `json:"keys,omitempty"`
	Items       []string      `json:"items,omitempty"`
	Marker      string        `json:"marker,omitempty"`
	QuestItem   string        `json:"quest_item,omitempty"`
	Targets     []string      `json:"targets,omitempty"`
	Gear        *gearForModel `json:"gear,omitempty"`
	TimeWindow  string        `json:"time_window,omitempty"`
}

type gearForModel struct {
	WeaponAnyOf      []string `json:"weapon_any_of,omitempty"`
	Wearing          []string `json:"wearing,omitempty"`
	MustNotWearItems float64  `json:"must_not_wear_items,omitempty"`
}

// The wiki excerpt gets shorter as more parts are sent, to keep the request size steady.
func excerptLength(partCount int) int {
	switch {
	case partCount > 80:
		return 450
	case partCount > 40:
		return 750
	default:
		return 1100
	}
}

func describeParts(parts []partInScope, wikiByTask map[string]*WikiEntry, mapName func(string) string) []partForModel {
	excerpt := excerptLength(len(parts))
	described := make([]partForModel, 0, len(parts))
	for _, part := range parts {
		inPart := map[string]bool{}
		for _, id := range part.ObjIDs {
			inPart[id] = true
		}
		objectives := []objectiveForModel{}
		for _, objective := range part.task.Objs {
			if inPart[objective.ID] {
				objectives = append(objectives, describeObjective(objective))
			}
		}
		wiki := "(no wiki page found)"
		if page := wikiByTask[part.TaskID]; page != nil && !page.Missing {
			wiki = Summary(page.Text, excerpt)
		}
		described = append(described, partForModel{
			ID: part.ID, Task: part.task.Name, Part: part.Label, Trader: part.task.Trader, CurrentCategory: part.Category,
			Maps: taskMapNames(part.task, mapName), Objectives: objectives, Wiki: wiki,
		})
	}
	return described
}

// taskMapNames: the task's map and every map its objectives touch, once each, by display name.
func taskMapNames(task gamedata.Task, mapName func(string) string) []string {
	var keys []string
	seen := map[string]bool{}
	add := func(key string) {
		if key != "" && !seen[key] {
			seen[key] = true
			keys = append(keys, key)
		}
	}
	if task.Map != nil {
		add(*task.Map)
	}
	for _, objective := range task.Objs {
		for _, key := range objective.Maps {
			add(key)
		}
		for _, zone := range objective.Zones {
			add(zone.M)
		}
	}
	names := []string{}
	for _, key := range keys {
		names = append(names, mapName(key))
	}
	return names
}

func describeObjective(objective gamedata.Objective) objectiveForModel {
	described := objectiveForModel{Type: objective.Type, Text: objective.D, FoundInRaid: objective.FIR, Optional: objective.Opt}
	if objective.N > 1 {
		described.Count = objective.N
	}
	for _, group := range objective.Keys {
		described.Keys = append(described.Keys, strings.Join(itemNames(group), " or "))
	}
	described.Items = firstN(itemNames(objective.Items), 6)
	if objective.Marker != nil {
		described.Marker = objective.Marker.Name
	}
	if objective.QI != nil {
		described.QuestItem = *objective.QI
	}
	if len(objective.Targets) > 0 {
		described.Targets = objective.Targets
	}
	if objective.Gear != nil {
		gear := &gearForModel{WeaponAnyOf: firstN(itemNames(objective.Gear.Weapons), 8), MustNotWearItems: objective.Gear.NotWearing}
		var outfits []string
		for _, group := range objective.Gear.Wearing {
			outfits = append(outfits, strings.Join(itemNames(group), " + "))
		}
		gear.Wearing = firstN(outfits, 6)
		described.Gear = gear
	}
	if len(objective.Time) == 2 {
		described.TimeWindow = fmt.Sprintf("%s:00-%s:00", jsNumber(objective.Time[0]), jsNumber(objective.Time[1]))
	}
	return described
}

func contextMessage(request Request, parts []partForModel) string {
	var lines []string
	for _, category := range request.Categories {
		builtin := ""
		if category.Builtin != nil && *category.Builtin != "" {
			builtin = " (built-in: " + *category.Builtin + ")"
		}
		lines = append(lines, "- \""+category.Name+"\""+builtin+", "+jsNumber(category.Count)+" tasks, color "+category.Color)
	}
	partsJSON, _ := json.Marshal(parts)
	return "MAP / SCOPE: " + request.MapName + "\n\nCATEGORIES:\n" + strings.Join(lines, "\n") + "\n\nPARTS:\n" + string(partsJSON)
}

var hexColor = regexp.MustCompile(`(?i)^#[0-9a-f]{6}$`)

// reviewAnswer keeps only what's real: categories that exist (or are being created) and parts that
// were sent. Moves to the category a part is already in are left out.
func reviewAnswer(response map[string]any, request Request, partByID map[string]partInScope, wikiCalls int, model string) (Result, error) {
	text, err := openai.OutputText(response)
	if err != nil {
		return Result{}, err
	}
	var parsed struct {
		Reply         any              `json:"reply"`
		NewCategories []map[string]any `json:"new_categories"`
		Assignments   []map[string]any `json:"assignments"`
	}
	if json.Unmarshal([]byte(text), &parsed) != nil {
		return Result{}, errors.New("The AI didn't return a usable answer. Try rephrasing.")
	}

	existing := map[string]string{} // lower-case name → name
	for _, category := range request.Categories {
		existing[strings.ToLower(category.Name)] = category.Name
	}
	newCategories := []NewCategory{}
	for _, proposed := range parsed.NewCategories {
		name, _ := proposed["name"].(string)
		if name == "" {
			continue
		}
		if _, exists := existing[strings.ToLower(strings.TrimSpace(name))]; exists {
			continue
		}
		created := NewCategory{Name: utf16Prefix(strings.TrimSpace(name), maxCategoryNameLen), Icon: "circle"}
		if color, _ := proposed["color"].(string); hexColor.MatchString(color) {
			created.Color = &color
		}
		if icon, _ := proposed["icon"].(string); contains(Shapes, icon) {
			created.Icon = icon
		}
		newCategories = append(newCategories, created)
	}
	for _, created := range newCategories {
		existing[strings.ToLower(created.Name)] = created.Name
	}

	currentCategory := map[string]string{}
	for _, part := range request.Parts {
		currentCategory[part.ID] = part.Category
	}
	assignments := []Assignment{}
	dropped := []string{}
	for _, proposed := range parsed.Assignments {
		partID := textOf(proposed["part_id"])
		categoryName, known := existing[strings.ToLower(strings.TrimSpace(textOrEmpty(proposed["category"])))]
		part, partKnown := partByID[partID]
		if !partKnown || !known {
			label := partID
			if partKnown {
				label = part.task.Name
			}
			dropped = append(dropped, label+" → "+textOf(proposed["category"]))
			continue
		}
		if currentCategory[partID] == categoryName {
			continue
		}
		name := part.task.Name
		if part.Label != "" {
			name += " (" + part.Label + ")"
		}
		assignments = append(assignments, Assignment{PartID: partID, Name: name, From: currentCategory[partID], Category: categoryName, Reason: utf16Prefix(textOrEmpty(proposed["reason"]), maxReasonLength)})
	}

	reply := ""
	if parsed.Reply != nil && parsed.Reply != "" {
		reply = textOf(parsed.Reply)
	}
	var usedModel any = model
	if responseModel, ok := response["model"].(string); ok && responseModel != "" {
		usedModel = responseModel
	}
	return Result{Reply: reply, NewCategories: newCategories, Assignments: assignments, Dropped: dropped, WikiCalls: wikiCalls, Model: usedModel, Usage: response["usage"]}, nil
}

func itemNames(items []gamedata.Item) []string {
	names := []string{}
	for _, item := range items {
		names = append(names, item.Name)
	}
	return names
}

func firstN(list []string, n int) []string {
	if len(list) > n {
		return list[:n]
	}
	return list
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

func plural(n int) string {
	if n > 1 {
		return "s"
	}
	return ""
}

func textOf(value any) string {
	switch v := value.(type) {
	case nil:
		return "undefined"
	case string:
		return v
	case float64:
		return jsNumber(v)
	default:
		data, _ := json.Marshal(v)
		return string(data)
	}
}

func textOrEmpty(value any) string {
	if value == nil || value == "" || value == false {
		return ""
	}
	return textOf(value)
}

// jsNumber formats a number the way JavaScript prints it in text (no ".0" on whole numbers).
func jsNumber(number float64) string {
	return strings.TrimSuffix(strings.TrimRight(fmt.Sprintf("%f", number), "0"), ".")
}

// JavaScript measures text in UTF-16 units; these keep the same cut-off points as v2.
func utf16Length(text string) int { return len(utf16.Encode([]rune(text))) }

func utf16Prefix(text string, limit int) string {
	units := utf16.Encode([]rune(text))
	if len(units) <= limit {
		return text
	}
	return string(utf16.Decode(units[:limit]))
}
