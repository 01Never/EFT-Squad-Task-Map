package aicategorize

import (
	"strings"
	"testing"
)

func TestWikiMarkupBecomesPlainText(t *testing.T) {
	cases := []struct {
		name, wikitext, want string
	}{
		{"plain text stays", "Hand over the items.", "Hand over the items."},
		{"an infobox keeps its key = value pairs", "{{Infobox quest|giver = Prapor|location=Customs}}", "giver = Prapor; location= Customs"},
		{"nested templates are read from the inside out", "{{Quest|level={{Level|10}}}}", "level= 10"},
		{"icons, spoilers, see-alsos and one-word templates are dropped", "A{{Icon|Roubles}}B{{Clear}}C{{Spoiler|the end}}D{{See also|Debut}}E", "ABCDE"},
		{"links keep their text", "Talk to [[Prapor]] at [[Customs (map)|Customs]].", "Talk to Prapor at Customs."},
		{"external links keep only their label", "See [https://example.com/guide the guide] and [https://example.com/x].", "See the guide and ."},
		{"references and comments are removed", `Kill 5 Scavs<ref name="a"/><ref>Patch 0.12</ref>.<!-- TODO: check -->`, "Kill 5 Scavs."},
		{"files, images, categories and galleries are removed", "[[File:Fuel.png|thumb|The tank]][[Image:x.jpg]]Mark it.[[Category:Quests]]<gallery>\nA.png|a\n</gallery>", "Mark it."},
		{"bold, italics, line breaks and HTML tags become plain text", `'''Bold''' and ''italic''<br/>next <span style="x">line</span>&nbsp;here`, "Bold and italic\nnext line here"},
		{"spaces collapse and blank lines shrink to one", "  a  \t b\n\n\n\nc  ", "a b\n\nc"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := CleanWikitext(testCase.wikitext); got != testCase.want {
				t.Errorf("got  %q\nwant %q", got, testCase.want)
			}
		})
	}
}

func TestATableKeepsItsCellsWithoutRowMarkup(t *testing.T) {
	got := CleanWikitext("Before\n{| class=\"wikitable\"\n! Item !! Count\n|-\n| Gas analyzer || 1\n|-\n| Bottle || 2\n|}\nAfter")
	for _, kept := range []string{"Before", "Gas analyzer | 1", "Bottle | 2", "After"} {
		if !strings.Contains(got, kept) {
			t.Errorf("%q is missing from %q", kept, got)
		}
	}
	for _, removed := range []string{"|-", "||", "\n|", "\n!"} {
		if strings.Contains(got, removed) {
			t.Errorf("%q is still in %q", removed, got)
		}
	}
}

func TestTheSummaryPicksTheSectionsThatMatterForSorting(t *testing.T) {
	cases := []struct {
		name string
		text string
		max  int
		want string
	}{
		{
			"objectives and guide, not rewards",
			"Intro.\n== Objectives ==\nKill 5 Scavs.\n== Rewards ==\nMoney.\n== Guide ==\nGo to the dorms.", 1100,
			"Objectives: Kill 5 Scavs.\nGuide: Go to the dorms.\n",
		},
		{
			"every matching section, in page order (tips, notes and walkthrough count as guide)",
			"== Objective 1 ==\nA\n=== Objective 2 ===\nB\n== Tips ==\nC\n== Notes ==\nD\n== Walkthrough ==\nE", 1100,
			"Objectives: A\nB\nGuide: C\nD\nE\n",
		},
		{"headings match in any case", "== OBJECTIVES ==\nX", 1100, "Objectives: X\n"},
		{"neither: the intro", "The intro.\n\n== Rewards ==\nMoney.", 1100, "The intro."},
		{"no intro either: the whole page", "== Rewards ==\nMoney.", 1100, "== Rewards ==\nMoney."},
		{"blank lines become single line breaks", "== Objectives ==\nA\n\n\nB", 1100, "Objectives: A\nB\n"},
		{"a long summary is cut at max characters (not bytes)", "ééééé", 3, "ééé …"},
		{"exactly max characters isn't cut", "abc", 3, "abc"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := Summary(testCase.text, testCase.max); got != testCase.want {
				t.Errorf("got  %q\nwant %q", got, testCase.want)
			}
		})
	}
}

func TestAWikiLinkGivesThePageTitle(t *testing.T) {
	const wiki = "https://escapefromtarkov.fandom.com/wiki/"
	cases := []struct {
		name, link, want string
	}{
		{"a simple title", wiki + "Debut", "Debut"},
		{"underscores are spaces", wiki + "Gunsmith_-_Part_1", "Gunsmith - Part 1"},
		{"escapes are decoded", wiki + "What%27s_on_the_flash_drive%3F", "What's on the flash drive?"},
		{"a query is cut off", wiki + "Debut?action=edit", "Debut"},
		{"an anchor is cut off", wiki + "Debut#Objectives", "Debut"},
		{"a broken escape keeps the raw text", wiki + "100%_sure", "100% sure"},
		{"not a wiki link", "https://tarkov.dev/task/debut", ""},
		{"no link", "", ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := TitleFromURL(testCase.link); got != testCase.want {
				t.Errorf("got %q, want %q", got, testCase.want)
			}
		})
	}
}
