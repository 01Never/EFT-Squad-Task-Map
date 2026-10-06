package aicategorize

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"squadtaskmap/internal/storage"
)

// Wiki pages are kept for a week (squad-task-map-wikicache.json), so re-sorting doesn't fetch them again.
const wikiCacheLifetime = 7 * 24 * time.Hour

// The cache file is written this long after the last change (many pages arrive at once).
const wikiCacheSaveDelay = 500 * time.Millisecond

// A wiki page that doesn't arrive within this time counts as missing (the job carries on without it).
var wikiHTTP = &http.Client{Timeout: 30 * time.Second}

// WikiEntry is one cached wiki page, as plain text.
type WikiEntry struct {
	T       float64 `json:"t"` // when it was fetched, ms since 1970 (0 = failed fetch)
	Title   string  `json:"title"`
	Text    string  `json:"text"`
	Missing bool    `json:"missing,omitempty"`
}

// Wiki fetches Escape from Tarkov wiki pages (MediaWiki's parse API) and caches them.
type Wiki struct {
	mutex     sync.Mutex
	entries   map[string]WikiEntry
	cacheFile string
	saveTimer *time.Timer
	apiURL    string
	userAgent string
}

// NewWiki loads the cache file. STM_WIKI_API points it at the mock server in tests.
func NewWiki(cacheFile, userAgent string) *Wiki {
	apiURL := os.Getenv("STM_WIKI_API")
	if apiURL == "" {
		apiURL = "https://escapefromtarkov.fandom.com/api.php"
	}
	wiki := &Wiki{entries: map[string]WikiEntry{}, cacheFile: cacheFile, apiURL: apiURL, userAgent: userAgent}
	if data, err := os.ReadFile(cacheFile); err == nil {
		_ = json.Unmarshal(data, &wiki.entries)
	}
	return wiki
}

var wikiPathTitle = regexp.MustCompile(`/wiki/([^?#]+)`)

// TitleFromURL turns a wiki link into the page title ("" when it isn't a wiki link).
func TitleFromURL(link string) string {
	match := wikiPathTitle.FindStringSubmatch(link)
	if match == nil {
		return ""
	}
	title, err := url.PathUnescape(match[1])
	if err != nil {
		title = match[1]
	}
	return strings.ReplaceAll(title, "_", " ")
}

// Page returns a task's wiki page as plain text (from the cache when it's less than a week old).
// A failed fetch returns the stale cached copy if there is one, else an entry marked missing.
func (wiki *Wiki) Page(ctx context.Context, link *string) *WikiEntry {
	if link == nil {
		return nil
	}
	title := TitleFromURL(*link)
	if title == "" {
		return nil
	}
	wiki.mutex.Lock()
	cached, hasCached := wiki.entries[title]
	wiki.mutex.Unlock()
	if hasCached && float64(time.Now().UnixMilli())-cached.T < float64(wikiCacheLifetime.Milliseconds()) {
		return &cached
	}
	entry, err := wiki.fetch(ctx, title)
	if err != nil {
		if hasCached {
			return &cached
		}
		return &WikiEntry{T: 0, Title: title, Missing: true}
	}
	wiki.mutex.Lock()
	wiki.entries[title] = entry
	wiki.scheduleSaveLocked()
	wiki.mutex.Unlock()
	return &entry
}

func (wiki *Wiki) fetch(ctx context.Context, title string) (WikiEntry, error) {
	query := fmt.Sprintf("%s?action=parse&page=%s&prop=wikitext&redirects=1&format=json&formatversion=2", wiki.apiURL, url.QueryEscape(title))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, query, nil)
	if err != nil {
		return WikiEntry{}, err
	}
	request.Header.Set("User-Agent", wiki.userAgent)
	request.Header.Set("Accept", "application/json")
	response, err := wikiHTTP.Do(request)
	if err != nil {
		return WikiEntry{}, err
	}
	defer response.Body.Close()
	var decoded struct {
		Parse struct {
			Title    string          `json:"title"`
			Wikitext json.RawMessage `json:"wikitext"`
		} `json:"parse"`
	}
	if err := json.NewDecoder(response.Body).Decode(&decoded); err != nil {
		return WikiEntry{}, err
	}
	now := float64(time.Now().UnixMilli())
	raw := wikitextOf(decoded.Parse.Wikitext)
	if raw == "" {
		return WikiEntry{T: now, Title: title, Missing: true}, nil
	}
	pageTitle := decoded.Parse.Title
	if pageTitle == "" {
		pageTitle = title
	}
	return WikiEntry{T: now, Title: pageTitle, Text: CleanWikitext(raw)}, nil
}

// wikitextOf reads "wikitext" in either API format: a string (formatversion=2) or {"*": text}.
func wikitextOf(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var wrapped map[string]string
	if json.Unmarshal(raw, &wrapped) == nil {
		return wrapped["*"]
	}
	return ""
}

// scheduleSaveLocked writes the cache file shortly after the last change.
func (wiki *Wiki) scheduleSaveLocked() {
	if wiki.saveTimer != nil {
		wiki.saveTimer.Stop()
	}
	wiki.saveTimer = time.AfterFunc(wikiCacheSaveDelay, func() {
		wiki.mutex.Lock()
		data, err := json.Marshal(wiki.entries)
		wiki.mutex.Unlock()
		if err == nil {
			_ = storage.WriteFileAtomic(wiki.cacheFile, data)
		}
	})
}

// ---------------------------------------------------------------- MediaWiki markup → plain text

var (
	htmlComments    = regexp.MustCompile(`<!--[\s\S]*?-->`)
	selfClosingRefs = regexp.MustCompile(`(?i)<ref[^>]*/>`)
	refBlocks       = regexp.MustCompile(`(?i)<ref[\s\S]*?</ref>`)
	fileLinks       = regexp.MustCompile(`(?i)\[\[(?:File|Image|Category):[^\]]*\]\]`)
	galleries       = regexp.MustCompile(`(?i)<gallery[\s\S]*?</gallery>`)
	templates       = regexp.MustCompile(`\{\{([^{}]*)\}\}`)
	noiseTemplates  = regexp.MustCompile(`^(icon|image|spoiler|clear|main|see also|stub|quest navbox|nav)`)
	templateKey     = regexp.MustCompile(`^[^=]{1,30}=\s*`)
	pipedLinks      = regexp.MustCompile(`\[\[([^\]|]*)\|([^\]]*)\]\]`)
	plainLinks      = regexp.MustCompile(`\[\[([^\]]*)\]\]`)
	namedExternal   = regexp.MustCompile(`\[https?:[^\s\]]+\s([^\]]+)\]`)
	bareExternal    = regexp.MustCompile(`\[https?:[^\]]+\]`)
	boldItalic      = regexp.MustCompile(`'''?`)
	lineBreaks      = regexp.MustCompile(`(?i)<br\s*/?>`)
	htmlTags        = regexp.MustCompile(`<[^>]+>`)
	tables          = regexp.MustCompile(`(?m)^\{\|[\s\S]*?^\|\}`)
	tableRowMarks   = regexp.MustCompile(`(?m)^\s*[|!]-?`)
	spacesAndTabs   = regexp.MustCompile(`[ \t]+`)
	manyBlankLines  = regexp.MustCompile(`\n{3,}`)
	twoOrMoreBlanks = regexp.MustCompile(`\n{2,}`)
	sectionHeading  = regexp.MustCompile(`(?m)^==+\s*([^=]+?)\s*==+\s*$`)
)

// CleanWikitext turns MediaWiki markup into plain text the model can read.
func CleanWikitext(wikitext string) string {
	text := htmlComments.ReplaceAllString(wikitext, "")
	text = selfClosingRefs.ReplaceAllString(text, "")
	text = refBlocks.ReplaceAllString(text, "")
	text = fileLinks.ReplaceAllString(text, "")
	text = galleries.ReplaceAllString(text, "")
	// Infobox-like templates: keep their "key = value" lines readable (templates nest, so 4 passes).
	for pass := 0; pass < 4; pass++ {
		text = templates.ReplaceAllStringFunc(text, readableTemplate)
	}
	text = pipedLinks.ReplaceAllString(text, "$2")
	text = plainLinks.ReplaceAllString(text, "$1")
	text = namedExternal.ReplaceAllString(text, "$1")
	text = bareExternal.ReplaceAllString(text, "")
	text = boldItalic.ReplaceAllString(text, "")
	text = lineBreaks.ReplaceAllString(text, "\n")
	text = htmlTags.ReplaceAllString(text, "")
	text = tables.ReplaceAllStringFunc(text, func(table string) string {
		return strings.ReplaceAll(tableRowMarks.ReplaceAllString(table, ""), "||", " | ")
	})
	text = strings.ReplaceAll(text, "&nbsp;", " ")
	text = spacesAndTabs.ReplaceAllString(text, " ")
	text = manyBlankLines.ReplaceAllString(text, "\n\n")
	return strings.TrimSpace(text)
}

func readableTemplate(template string) string {
	inner := template[2 : len(template)-2]
	var parts []string
	for _, part := range strings.Split(inner, "|") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			parts = append(parts, trimmed)
		}
	}
	if len(parts) <= 1 {
		return ""
	}
	if noiseTemplates.MatchString(strings.ToLower(parts[0])) {
		return ""
	}
	values := make([]string, 0, len(parts)-1)
	for _, part := range parts[1:] {
		values = append(values, templateKey.ReplaceAllStringFunc(part, func(key string) string { return strings.TrimSpace(key) + " " }))
	}
	return strings.Join(values, "; ")
}

// Summary picks the sections that matter for sorting (objectives, then guide/tips/notes), falling
// back to the intro, cut to max characters.
func Summary(text string, max int) string {
	sections := map[string]string{}
	var order []string
	add := func(name, content string) {
		if _, seen := sections[name]; !seen {
			order = append(order, name)
		}
		sections[name] += content
	}
	last, index := "intro", 0
	for _, match := range sectionHeading.FindAllStringSubmatchIndex(text, -1) {
		add(last, text[index:match[0]])
		last = strings.ToLower(text[match[2]:match[3]])
		index = match[1]
	}
	add(last, text[index:])

	pick := func(pattern *regexp.Regexp) string {
		var picked []string
		for _, name := range order {
			if pattern.MatchString(name) {
				picked = append(picked, strings.TrimSpace(sections[name]))
			}
		}
		return strings.Join(picked, "\n")
	}
	out := ""
	if objectives := pick(regexp.MustCompile(`objective`)); objectives != "" {
		out += "Objectives: " + objectives + "\n"
	}
	if guide := pick(regexp.MustCompile(`guide|walkthrough|tips|notes`)); guide != "" {
		out += "Guide: " + guide + "\n"
	}
	if out == "" {
		intro, hasIntro := sections["intro"]
		if !hasIntro || intro == "" {
			intro = text
		}
		out = strings.TrimSpace(intro)
	}
	out = twoOrMoreBlanks.ReplaceAllString(out, "\n")
	if utf16Length(out) > max {
		return utf16Prefix(out, max) + " …"
	}
	return out
}
