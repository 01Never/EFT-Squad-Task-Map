package events

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// The page spells the event names in web/js/app/event-names.js (CODE-STYLE §6). These tests read
// that file and names.go, so the two lists can't drift apart.
const pageEventNamesFile = "../../web/js/app/event-names.js"

// eventNamesInGo returns the string constants declared in names.go.
func eventNamesInGo(t *testing.T) []string {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), "names.go", nil, 0)
	if err != nil {
		t.Fatalf("reading names.go: %v", err)
	}
	names := []string{}
	for _, declaration := range file.Decls {
		group, isGroup := declaration.(*ast.GenDecl)
		if !isGroup || group.Tok != token.CONST {
			continue
		}
		for _, spec := range group.Specs {
			for _, value := range spec.(*ast.ValueSpec).Values {
				literal, isLiteral := value.(*ast.BasicLit)
				if !isLiteral || literal.Kind != token.STRING {
					continue
				}
				name, err := strconv.Unquote(literal.Value)
				if err != nil {
					t.Fatalf("names.go: %s isn't a plain string", literal.Value)
				}
				names = append(names, name)
			}
		}
	}
	return names
}

// One line of the page's list: `  raidEnd: "raidEnd", // comment`.
var pageEventNameLine = regexp.MustCompile(`^\s*(\w+):\s*"([^"]*)",`)

// eventNamesInPage returns the names listed in EVENT_NAMES, checking that each key is its own name.
func eventNamesInPage(t *testing.T) []string {
	t.Helper()
	text, err := os.ReadFile(pageEventNamesFile)
	if err != nil {
		t.Fatalf("reading the page's event names: %v", err)
	}
	start := strings.Index(string(text), "EVENT_NAMES = Object.freeze({")
	end := strings.Index(string(text), "});")
	if start < 0 || end < start {
		t.Fatalf("%s: no EVENT_NAMES = Object.freeze({ … }); list", pageEventNamesFile)
	}
	names := []string{}
	for _, line := range strings.Split(string(text[start:end]), "\n") {
		match := pageEventNameLine.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		if match[1] != match[2] {
			t.Errorf("%s: %s maps to %q; each key must be the event's own name", pageEventNamesFile, match[1], match[2])
		}
		names = append(names, match[2])
	}
	return names
}

func TestThePageListsExactlyTheEventNamesTheServerSends(t *testing.T) {
	goNames := eventNamesInGo(t)
	pageNames := eventNamesInPage(t)
	if len(goNames) == 0 || len(pageNames) == 0 {
		t.Fatalf("found %d names in names.go and %d in the page; expected both lists", len(goNames), len(pageNames))
	}
	for _, name := range goNames {
		if !slices.Contains(pageNames, name) {
			t.Errorf("the server sends %q, but web/js/app/event-names.js doesn't list it", name)
		}
	}
	for _, name := range pageNames {
		if !slices.Contains(goNames, name) {
			t.Errorf("web/js/app/event-names.js lists %q, but internal/events/names.go doesn't", name)
		}
	}
	if len(pageNames) != len(goNames) {
		t.Errorf("the page lists %d names, the server %d (a name listed twice?)", len(pageNames), len(goNames))
	}
}
