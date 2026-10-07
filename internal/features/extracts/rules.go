// The extract reader's rules, as plain functions: how names are compared, how the model's list is
// cleaned and matched to a map's extracts and transits, and how many screenshots are tried per
// raid. extracts.go keeps the state and does the I/O.

package extracts

import "strings"

// MaxScreenshotsPerRaid: if the first screenshot doesn't show the extract list, the next ones are
// tried, up to this many in all; the reader stops as soon as one list is found.
const MaxScreenshotsPerRaid = 3

// MaxImageEdgePixels is the longest side of the picture sent to the model (the same limit the
// task scan uses for its images).
const MaxImageEdgePixels = 2048

// MinSimilarity: a name that isn't an exact match still counts when it is at least this alike
// (1 = identical; Levenshtein distance / longer length). The task scan uses the same value.
const MinSimilarity = 0.82

// maxLengthDifference: names whose lengths differ by more than this are never compared.
const maxLengthDifference = 8

// Limits on what the model's answer may carry into saved data.
const (
	maxListedExtracts = 40
	maxNameRunes      = 80
	maxNoteRunes      = 120
)

// ReadExtract is one extract the model read: its name and any status or requirement text.
type ReadExtract struct {
	Name string  `json:"name"`
	Note *string `json:"note"`
}

// Marked is an extract of the raid's map that the list showed, with the note read beside it.
type Marked struct {
	Name string  `json:"name"` // the map's own name for it (what the page stores marks under)
	Note *string `json:"note"`
}

// NormalizedName reduces a name to what matters for matching: lower case letters and digits only.
func NormalizedName(name string) string {
	var normalized strings.Builder
	for _, letter := range strings.ToLower(name) {
		isLetter := letter >= 'a' && letter <= 'z'
		isDigit := letter >= '0' && letter <= '9'
		if isLetter || isDigit {
			normalized.WriteRune(letter)
		}
	}
	return normalized.String()
}

// EditDistance is the Levenshtein distance: how many single-letter changes turn one text into the other.
func EditDistance(from, to string) int {
	fromRunes, toRunes := []rune(from), []rune(to)
	if len(fromRunes) == 0 || len(toRunes) == 0 {
		return max(len(fromRunes), len(toRunes))
	}
	// previousRow[j] = distance from the first i-1 letters of `from` to the first j of `to`.
	previousRow := make([]int, len(toRunes)+1)
	for j := range previousRow {
		previousRow[j] = j
	}
	for i := 1; i <= len(fromRunes); i++ {
		currentRow := make([]int, len(toRunes)+1)
		currentRow[0] = i
		for j := 1; j <= len(toRunes); j++ {
			substitutionCost := 1
			if fromRunes[i-1] == toRunes[j-1] {
				substitutionCost = 0
			}
			currentRow[j] = min(previousRow[j]+1, currentRow[j-1]+1, previousRow[j-1]+substitutionCost)
		}
		previousRow = currentRow
	}
	return previousRow[len(toRunes)]
}

// Similarity says how alike two (normalized) names are: 1 for identical, 0 for nothing in common.
func Similarity(first, second string) float64 {
	longest := max(len([]rune(first)), len([]rune(second)), 1)
	return 1 - float64(EditDistance(first, second))/float64(longest)
}

// CleanRead keeps the extracts with a name, trims and limits the text, and drops repeats of a name.
func CleanRead(raw []ReadExtract) []ReadExtract {
	cleaned := []ReadExtract{}
	seen := map[string]bool{}
	for _, extract := range raw {
		name := limitRunes(strings.TrimSpace(extract.Name), maxNameRunes)
		normalized := NormalizedName(name)
		if normalized == "" || seen[normalized] || len(cleaned) >= maxListedExtracts {
			continue
		}
		seen[normalized] = true
		var note *string
		if extract.Note != nil {
			if text := limitRunes(strings.TrimSpace(*extract.Note), maxNoteRunes); text != "" {
				note = &text
			}
		}
		cleaned = append(cleaned, ReadExtract{Name: name, Note: note})
	}
	return cleaned
}

func limitRunes(text string, limit int) string {
	runes := []rune(text)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return text
}

// MatchNames finds each read name among the map's extract and transit names: an exact match
// (ignoring case and punctuation), else the most similar name if it is at least MinSimilarity
// alike. It returns the extracts to mark (in the order read, each once) and the names that matched
// nothing.
func MatchNames(read []ReadExtract, mapNames []string) (marked []Marked, unknown []string) {
	marked, unknown = []Marked{}, []string{}
	alreadyMarked := map[string]bool{}
	for _, extract := range read {
		mapName, found := bestMatch(extract.Name, mapNames)
		if !found {
			unknown = append(unknown, extract.Name)
			continue
		}
		if alreadyMarked[mapName] {
			continue
		}
		alreadyMarked[mapName] = true
		marked = append(marked, Marked{Name: mapName, Note: extract.Note})
	}
	return marked, unknown
}

func bestMatch(readName string, mapNames []string) (string, bool) {
	wanted := NormalizedName(readName)
	if wanted == "" {
		return "", false
	}
	bestName, bestScore := "", 0.0
	for _, mapName := range mapNames {
		candidate := NormalizedName(mapName)
		if candidate == wanted {
			return mapName, true
		}
		lengthDifference := len(candidate) - len(wanted)
		if lengthDifference > maxLengthDifference || -lengthDifference > maxLengthDifference {
			continue
		}
		if score := Similarity(wanted, candidate); score > bestScore {
			bestName, bestScore = mapName, score
		}
	}
	return bestName, bestScore >= MinSimilarity
}

// Attempts counts the screenshots tried in one raid.
type Attempts struct {
	Tried int
	Found bool // an extract list was read; no more screenshots are tried
}

// ShouldTry says whether the next in-raid screenshot should be read.
func (attempts Attempts) ShouldTry() bool {
	return !attempts.Found && attempts.Tried < MaxScreenshotsPerRaid
}

// ShrunkSize is the size of a picture after fitting its long side into MaxImageEdgePixels
// (never enlarged).
func ShrunkSize(width, height int) (int, int) {
	longest := max(width, height)
	if longest <= MaxImageEdgePixels {
		return width, height
	}
	scale := float64(MaxImageEdgePixels) / float64(longest)
	return max(1, int(float64(width)*scale+0.5)), max(1, int(float64(height)*scale+0.5))
}
