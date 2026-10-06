// The json.tarkov.dev files the mock serves: by default the docs v2's mock built from the
// bundled snapshot, or (MOCK_DOCS=real) the real files saved in testdata. Loading only; the
// HTTP side is in server.go.

package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// documentSource says which set of json.tarkov.dev files the mock serves.
type documentSource string

const (
	// The docs v2's mock built from the bundled snapshot with tests/helpers.ts snapshotToRaw(),
	// saved in testdata/golden/mock-raw-docs.json.gz. The app's tests expect these.
	snapshotDocuments documentSource = "snapshot"
	// The real json.tarkov.dev files fetched for ticket 04, in testdata/jsontarkovdev/.
	realDocuments documentSource = "real"
)

// documentName pairs a file's name in json.tarkov.dev URLs (/regular/tasks_en) with its key in
// the golden snapshot docs.
type documentName struct {
	urlName     string
	snapshotKey string
}

// The seven flat files the app downloads for a game mode.
var documentNames = []documentName{
	{urlName: "tasks", snapshotKey: "tasks"},
	{urlName: "tasks_en", snapshotKey: "tasksEn"},
	{urlName: "maps", snapshotKey: "maps"},
	{urlName: "maps_en", snapshotKey: "mapsEn"},
	{urlName: "traders", snapshotKey: "traders"},
	{urlName: "traders_en", snapshotKey: "tradersEn"},
	{urlName: "items_en", snapshotKey: "itemsEn"},
}

// loadDocuments returns each file's JSON by its URL name. Every game mode gets the same files.
func loadDocuments(testdataFolder string, source documentSource) (map[string][]byte, error) {
	if source == realDocuments {
		return loadRealDocuments(testdataFolder)
	}
	return loadSnapshotDocuments(testdataFolder)
}

// loadSnapshotDocuments reads the golden snapshot docs. That file is pretty-printed for
// readable diffs, but v2's mock sent JSON.stringify's compact form, so each doc is compacted.
// Compacting only drops whitespace between tokens: keys, key order, text and numbers stay
// exactly as v2 wrote them, so the bytes match what v2's mock sent.
func loadSnapshotDocuments(testdataFolder string) (map[string][]byte, error) {
	path := filepath.Join(testdataFolder, "golden", "mock-raw-docs.json.gz")
	fileContent, err := readGzipFile(path)
	if err != nil {
		return nil, err
	}
	var documentsByKey map[string]json.RawMessage
	if err := json.Unmarshal(fileContent, &documentsByKey); err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}

	documents := map[string][]byte{}
	for _, name := range documentNames {
		document, isPresent := documentsByKey[name.snapshotKey]
		if !isPresent {
			return nil, fmt.Errorf("%s has no %q doc", path, name.snapshotKey)
		}
		var compacted bytes.Buffer
		if err := json.Compact(&compacted, document); err != nil {
			return nil, fmt.Errorf("compacting %q from %s: %w", name.snapshotKey, path, err)
		}
		documents[name.urlName] = compacted.Bytes()
	}
	return documents, nil
}

// loadRealDocuments reads the real json.tarkov.dev files (regular mode) and serves them unchanged.
func loadRealDocuments(testdataFolder string) (map[string][]byte, error) {
	documents := map[string][]byte{}
	for _, name := range documentNames {
		path := filepath.Join(testdataFolder, "jsontarkovdev", "regular-"+name.urlName+".json.gz")
		document, err := readGzipFile(path)
		if err != nil {
			return nil, err
		}
		if !json.Valid(document) {
			return nil, fmt.Errorf("%s is not valid JSON", path)
		}
		documents[name.urlName] = document
	}
	return documents, nil
}

func readGzipFile(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err // already says "open <path>: <reason>"
	}
	defer file.Close()

	reader, err := gzip.NewReader(file)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	defer reader.Close()

	content, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	return content, nil
}
