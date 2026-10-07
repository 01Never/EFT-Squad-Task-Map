// Package gamedata turns tarkov.dev's task and map data into what the page needs (format "stm-v2"),
// keeps a cached copy next to the exe, and falls back to a snapshot built into the exe.
package gamedata

import "encoding/json"

// GameData is what /api/data sends to the page.
type GameData struct {
	Format    string    `json:"format"`    // always "stm-v2"
	Generated *string   `json:"generated"` // when the data was made (ISO time), or null
	Mode      string    `json:"mode"`      // "regular", "pve" or "pvp-season"
	Tasks     []Task    `json:"tasks"`
	Maps      []MapInfo `json:"maps"`
}

// Task is one quest.
type Task struct {
	ID       string      `json:"id"`
	Name     string      `json:"name"`
	Trader   string      `json:"trader"`
	Map      *string     `json:"map"`      // the task's own map key, or null
	Wiki     *string     `json:"wiki"`     // wiki page URL, or null
	MinLevel float64     `json:"minLevel"` // player level needed
	Kappa    bool        `json:"kappa"`    // needed for the Kappa container
	LK       bool        `json:"lk"`       // needed for Lightkeeper
	Objs     []Objective `json:"objs"`
}

// Objective is one line of a task.
type Objective struct {
	ID      string        `json:"id"`
	Type    string        `json:"type"` // tarkov.dev's objective type: visit, mark, shoot, plantItem…
	D       string        `json:"d"`    // the text shown in game
	N       float64       `json:"n"`    // how many (kills, items…)
	FIR     bool          `json:"fir"`  // items must be found in raid
	Opt     bool          `json:"opt"`  // optional objective
	Maps    []string      `json:"maps"`
	Zones   []Zone        `json:"zones"`
	Poss    []PossibleSet `json:"poss"`           // possible spots for a quest item
	Keys    [][]Item      `json:"keys"`           // every group is needed; inside a group any one key will do
	Items   []Item        `json:"items"`          // alternatives (find, hand in, plant)
	Marker  *Item         `json:"marker"`         // the marker item for "mark" objectives
	QI      *string       `json:"qi"`             // quest item name
	QIID    *string       `json:"qiId,omitempty"` // quest item id (24 hex digits), for its icon (ticket 07)
	Targets []string      `json:"targets"`        // kill targets ("any PMC operatives", "Killa"…)
	Gear    *Gear         `json:"gear"`           // gear restrictions for kills, or null
	Time    []float64     `json:"time"`           // [from hour, until hour] for kills at certain times, or null
}

// Item is anything with an id and a name (items, keys, quest items).
type Item struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Zone is where an objective happens on a map. Top/bottom/outline exist only in live data.
type Zone struct {
	M       string          `json:"m"` // map key
	X       float64         `json:"x"`
	Y       float64         `json:"y"`
	Z       float64         `json:"z"`
	Top     json.RawMessage `json:"top,omitempty"`    // a number, or null when tarkov.dev sent null
	Bottom  json.RawMessage `json:"bottom,omitempty"` // as Top
	Outline *[][]float64    `json:"ol,omitempty"`     // polygon [x, z] points (present but empty when no point was usable)
}

// PossibleSet is a list of spots on one map where a quest item may be.
type PossibleSet struct {
	M string      `json:"m"`
	P [][]float64 `json:"p"` // [x, y, z]
}

// Gear lists what must be used or worn for a kill objective.
type Gear struct {
	Weapons    []Item   `json:"weapons"`
	Mods       [][]Item `json:"mods"`
	Wearing    [][]Item `json:"wearing"`
	NotWearing float64  `json:"notWearing"` // how many items must NOT be worn
}

// MapInfo is a map's extracts, transits and the names the game log uses for it.
type MapInfo struct {
	Key      string        `json:"key"`
	Scene    *string       `json:"scene"`  // e.g. "maps/customs_preset.bundle"
	NameID   *string       `json:"nameId"` // e.g. "bigmap"
	Extracts []Extract     `json:"extracts"`
	Transits []Transit     `json:"transits"`
	Alt      []MapAltNames `json:"alt,omitempty"` // other scenes/nameIds of the same map (night Factory, GZ 21+)
}

// MapAltNames are the scene and nameId of a variant of a map.
type MapAltNames struct {
	Scene  *string `json:"scene"`
	NameID *string `json:"nameId"`
}

// Extract is an exit.
type Extract struct {
	N       string       `json:"n"`  // name
	Fa      string       `json:"fa"` // faction: "pmc", "scav", "shared" or ""
	X       float64      `json:"x"`
	Y       float64      `json:"y"`
	Z       float64      `json:"z"`
	Outline *[][]float64 `json:"ol,omitempty"`
}

// Transit is a transit point to another map.
type Transit struct {
	N string  `json:"n"`
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}
