package gamedata

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

// The golden files are the v2 (TypeScript) converter's output for the same inputs, captured before
// the port (ticket 04 step 0). The Go converter must produce JSON-equal data.

func repoPath(parts ...string) string {
	return filepath.Join(append([]string{"..", ".."}, parts...)...)
}

func readMaybeGzipped(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	if filepath.Ext(path) != ".gz" {
		return data
	}
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("unzipping %s: %v", path, err)
	}
	unzipped, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("unzipping %s: %v", path, err)
	}
	return unzipped
}

func goldenTime() *string {
	value := "2026-10-05T00:00:00.000Z"
	return &value
}

func TestConverterMatchesTheV2Goldens(t *testing.T) {
	realDocs := func(t *testing.T) RawDocs {
		read := func(name string) json.RawMessage {
			return readMaybeGzipped(t, repoPath("testdata", "jsontarkovdev", "regular-"+name+".json.gz"))
		}
		return RawDocs{Tasks: read("tasks"), TasksEn: read("tasks_en"), Maps: read("maps"), MapsEn: read("maps_en"),
			Traders: read("traders"), TradersEn: read("traders_en"), ItemsEn: read("items_en")}
	}
	cases := []struct {
		name    string
		golden  string
		convert func(t *testing.T) GameData
	}{
		{"the snapshot built into the exe", "data-snapshot.json.gz", func(t *testing.T) GameData {
			converted, err := FromAny(readMaybeGzipped(t, repoPath("assets", "game-data.json")), "regular")
			if err != nil {
				t.Fatal(err)
			}
			return converted
		}},
		{"the mock json.tarkov.dev files", "data-mock.json.gz", func(t *testing.T) GameData {
			var docs RawDocs
			if err := json.Unmarshal(readMaybeGzipped(t, repoPath("testdata", "golden", "mock-raw-docs.json.gz")), &docs); err != nil {
				t.Fatal(err)
			}
			converted, err := FromRaw(docs, "regular", goldenTime())
			if err != nil {
				t.Fatal(err)
			}
			return converted
		}},
		{"the real json.tarkov.dev files (2026-10-05)", "data-real.json.gz", func(t *testing.T) GameData {
			converted, err := FromRaw(realDocs(t), "regular", goldenTime())
			if err != nil {
				t.Fatal(err)
			}
			return converted
		}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			converted, err := json.Marshal(testCase.convert(t))
			if err != nil {
				t.Fatal(err)
			}
			assertSameJSON(t, readMaybeGzipped(t, repoPath("testdata", "golden", testCase.golden)), withoutQuestItemIDs(t, converted))
		})
	}
}

// assertSameJSON compares two JSON documents by value (key order and number formatting don't
// matter) and reports the first few differences by path.
func assertSameJSON(t *testing.T, want, got []byte) {
	t.Helper()
	var wantValue, gotValue any
	if err := json.Unmarshal(want, &wantValue); err != nil {
		t.Fatalf("golden isn't JSON: %v", err)
	}
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Fatalf("output isn't JSON: %v", err)
	}
	var differences []string
	collectDifferences("$", wantValue, gotValue, &differences)
	if len(differences) > 0 {
		if len(differences) > 15 {
			differences = append(differences[:15], fmt.Sprintf("… and %d more", len(differences)-15))
		}
		for _, difference := range differences {
			t.Error(difference)
		}
	}
}

func collectDifferences(path string, want, got any, differences *[]string) {
	if len(*differences) > 200 {
		return
	}
	switch wantValue := want.(type) {
	case map[string]any:
		gotValue, isObject := got.(map[string]any)
		if !isObject {
			*differences = append(*differences, fmt.Sprintf("%s: want an object, got %v", path, short(got)))
			return
		}
		keys := map[string]bool{}
		for key := range wantValue {
			keys[key] = true
		}
		for key := range gotValue {
			keys[key] = true
		}
		sortedKeys := make([]string, 0, len(keys))
		for key := range keys {
			sortedKeys = append(sortedKeys, key)
		}
		sort.Strings(sortedKeys)
		for _, key := range sortedKeys {
			wantField, wantHas := wantValue[key]
			gotField, gotHas := gotValue[key]
			switch {
			case !gotHas:
				*differences = append(*differences, fmt.Sprintf("%s.%s: missing (want %v)", path, key, short(wantField)))
			case !wantHas:
				*differences = append(*differences, fmt.Sprintf("%s.%s: extra (got %v)", path, key, short(gotField)))
			default:
				collectDifferences(path+"."+key, wantField, gotField, differences)
			}
		}
	case []any:
		gotValue, isList := got.([]any)
		if !isList {
			*differences = append(*differences, fmt.Sprintf("%s: want a list, got %v", path, short(got)))
			return
		}
		if len(wantValue) != len(gotValue) {
			*differences = append(*differences, fmt.Sprintf("%s: want %d items, got %d", path, len(wantValue), len(gotValue)))
		}
		for i := 0; i < len(wantValue) && i < len(gotValue); i++ {
			collectDifferences(fmt.Sprintf("%s[%d]", path, i), wantValue[i], gotValue[i], differences)
		}
	default:
		if !reflect.DeepEqual(want, got) {
			*differences = append(*differences, fmt.Sprintf("%s: want %v, got %v", path, short(want), short(got)))
		}
	}
}

func short(value any) string {
	data, _ := json.Marshal(value)
	if len(data) > 120 {
		return string(data[:120]) + "…"
	}
	return string(data)
}

func TestToFixedRoundingMatchesJavaScript(t *testing.T) {
	cases := []struct {
		in, want float64
	}{
		{1.005, 1},    // 1.005 is really 1.00499999…, so JavaScript rounds down
		{1.125, 1.13}, // an exact half: JavaScript picks the larger value
		{-1.125, -1.13},
		{-0.001, 0},
		{310.83, 310.83},
		{-206.71000000000001, -206.71},
	}
	for _, testCase := range cases {
		if got := roundToHundredths(testCase.in); got != testCase.want {
			t.Errorf("roundToHundredths(%v) = %v, want %v", testCase.in, got, testCase.want)
		}
	}
}
