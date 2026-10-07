package extracts

import (
	"reflect"
	"strings"
	"testing"
)

func text(value string) *string { return &value }

func TestNamesAreComparedIgnoringCasePunctuationAndSpaces(t *testing.T) {
	cases := map[string]string{
		"Crossroads":         "crossroads",
		"ZB-1011":            "zb1011",
		"Old Gas Station":    "oldgasstation",
		"  Dorms V-Ex (PMC)": "dormsvexpmc",
		"":                   "",
	}
	for name, want := range cases {
		if got := NormalizedName(name); got != want {
			t.Errorf("NormalizedName(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestTheEditDistanceCountsSingleLetterChanges(t *testing.T) {
	cases := []struct {
		from, to string
		want     int
	}{
		{"", "", 0}, {"abc", "", 3}, {"", "abc", 3}, {"kitten", "sitting", 3}, {"same", "same", 0}, {"crossroads", "crosroads", 1},
	}
	for _, c := range cases {
		if got := EditDistance(c.from, c.to); got != c.want {
			t.Errorf("EditDistance(%q, %q) = %d, want %d", c.from, c.to, got, c.want)
		}
	}
}

func TestReadNamesAreMatchedToTheMapsExtractsAndTransits(t *testing.T) {
	mapNames := []string{"Crossroads", "ZB-1011", "Old Gas Station", "Transit to Factory"}
	read := []ReadExtract{
		{Name: "crossroads", Note: text("Available")}, // exact, ignoring case
		{Name: "Old Gas Stat1on", Note: nil},          // a misread letter still matches
		{Name: "Transit to Factory", Note: text("Requires paracord")},
		{Name: "Scav Camp", Note: nil}, // not on this map
	}
	marked, unknown := MatchNames(read, mapNames)
	wantMarked := []Marked{
		{Name: "Crossroads", Note: text("Available")},
		{Name: "Old Gas Station", Note: nil},
		{Name: "Transit to Factory", Note: text("Requires paracord")},
	}
	if !reflect.DeepEqual(marked, wantMarked) {
		t.Errorf("marked = %+v, want %+v", marked, wantMarked)
	}
	if !reflect.DeepEqual(unknown, []string{"Scav Camp"}) {
		t.Errorf("unknown = %v, want [Scav Camp]", unknown)
	}
}

func TestAnExactMatchBeatsASimilarName(t *testing.T) {
	marked, _ := MatchNames([]ReadExtract{{Name: "Dorms V-Ex"}}, []string{"Dorms V-Ex 2", "Dorms V-Ex"})
	if len(marked) != 1 || marked[0].Name != "Dorms V-Ex" {
		t.Errorf("marked = %+v, want Dorms V-Ex", marked)
	}
}

func TestNamesBelowTheSimilarityLimitAreNotMatched(t *testing.T) {
	// "Crossing" vs "Crossroads": distance 4 of 10 letters = 0.6, well under 0.82.
	marked, unknown := MatchNames([]ReadExtract{{Name: "Crossing"}}, []string{"Crossroads"})
	if len(marked) != 0 || len(unknown) != 1 {
		t.Errorf("marked = %+v, unknown = %v, want nothing marked and one unknown", marked, unknown)
	}
}

func TestTwoReadNamesForTheSameExtractMarkItOnce(t *testing.T) {
	marked, unknown := MatchNames([]ReadExtract{{Name: "Crossroads"}, {Name: "Crossroadz"}}, []string{"Crossroads"})
	if len(marked) != 1 || len(unknown) != 0 {
		t.Errorf("marked = %+v, unknown = %v, want one mark and no unknown", marked, unknown)
	}
}

func TestTheModelsListIsCleanedBeforeItIsUsed(t *testing.T) {
	long := strings.Repeat("x", 300)
	cleaned := CleanRead([]ReadExtract{
		{Name: "  Crossroads  ", Note: text("  Requires paracord ")},
		{Name: "crossroads", Note: nil}, // a repeat
		{Name: "   ", Note: nil},        // nothing to read
		{Name: "Dorms", Note: text("   ")},
		{Name: long, Note: text(long)},
	})
	if len(cleaned) != 3 {
		t.Fatalf("cleaned has %d entries, want 3: %+v", len(cleaned), cleaned)
	}
	if cleaned[0].Name != "Crossroads" || *cleaned[0].Note != "Requires paracord" {
		t.Errorf("first = %+v, want trimmed name and note", cleaned[0])
	}
	if cleaned[1].Note != nil {
		t.Errorf("a blank note should become none, got %q", *cleaned[1].Note)
	}
	if len([]rune(cleaned[2].Name)) != maxNameRunes || len([]rune(*cleaned[2].Note)) != maxNoteRunes {
		t.Errorf("long text should be cut to %d and %d letters", maxNameRunes, maxNoteRunes)
	}
}

func TestAtMostThreeScreenshotsAreTriedPerRaidAndNoneAfterAListWasFound(t *testing.T) {
	cases := []struct {
		name     string
		attempts Attempts
		want     bool
	}{
		{"the first screenshot is tried", Attempts{}, true},
		{"the third is still tried", Attempts{Tried: 2}, true},
		{"a fourth is not", Attempts{Tried: 3}, false},
		{"once a list was found nothing more is tried", Attempts{Tried: 1, Found: true}, false},
	}
	for _, c := range cases {
		if got := c.attempts.ShouldTry(); got != c.want {
			t.Errorf("%s: ShouldTry() = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestPicturesAreShrunkToFitTheLimitAndNeverEnlarged(t *testing.T) {
	cases := []struct{ width, height, wantWidth, wantHeight int }{
		{3840, 2160, 2048, 1152},
		{2560, 1440, 2048, 1152},
		{1920, 1080, 1920, 1080},
		{1080, 3840, 576, 2048},
	}
	for _, c := range cases {
		width, height := ShrunkSize(c.width, c.height)
		if width != c.wantWidth || height != c.wantHeight {
			t.Errorf("ShrunkSize(%d, %d) = %d x %d, want %d x %d", c.width, c.height, width, height, c.wantWidth, c.wantHeight)
		}
	}
}
