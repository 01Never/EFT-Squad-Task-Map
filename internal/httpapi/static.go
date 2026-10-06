package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// Content types are set explicitly: Go's mime lookup reads the Windows registry, and some PCs map
// .js to text/plain, which browsers refuse to run as a module.
var contentTypes = map[string]string{
	".html":  "text/html; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".svg":   "image/svg+xml",
	".json":  "application/json",
	".woff2": "font/woff2",
}

// staticFiles serves the page (web/), the map art and fonts (assets/) from the files built into the
// exe, or from disk in development.
type staticFiles struct {
	files   fs.FS
	fonts   map[string][]byte // font file name → bytes (from assets/fonts.json, base64)
	version string
	isDev   bool // serve from disk without caching, so edits show on reload
}

// NewStatic prepares the static files. files must contain web/ and assets/.
func NewStatic(files fs.FS, version string, isDev bool) (*staticFiles, error) {
	static := &staticFiles{files: files, version: version, isDev: isDev, fonts: map[string][]byte{}}
	fontsJSON, err := fs.ReadFile(files, "assets/fonts.json")
	if err != nil {
		return nil, err
	}
	var encoded map[string]string
	if err := json.Unmarshal(fontsJSON, &encoded); err != nil {
		return nil, err
	}
	for name, base64Text := range encoded {
		decoded, err := base64.StdEncoding.DecodeString(base64Text)
		if err == nil {
			static.fonts[name] = decoded
		}
	}
	return static, nil
}

func (static *staticFiles) serveIndex(writer http.ResponseWriter, request *http.Request) {
	static.serveFile(writer, request, "web/index.html", "")
}

// servePageCode serves the page's code folder (/js/… → web/js/…): its JavaScript modules and the
// stylesheets that sit next to them in the map, panel and feature folders. Nothing else from there:
// no tests, no READMEs.
func (static *staticFiles) servePageCode(writer http.ResponseWriter, request *http.Request) {
	relative := strings.TrimPrefix(request.URL.Path, "/js/")
	isModule := strings.HasSuffix(relative, ".js") && !strings.HasSuffix(relative, ".test.js")
	isStylesheet := strings.HasSuffix(relative, ".css")
	if !(isModule || isStylesheet) || !fs.ValidPath(relative) {
		http.Error(writer, "Not found", http.StatusNotFound)
		return
	}
	static.serveFile(writer, request, path.Join("web/js", relative), "")
}

// serveStylesheet serves the shared stylesheets (/css/… → web/css/…), and nothing else from there.
// fs.ValidPath refuses "..", so a request can't reach a file outside web/css.
func (static *staticFiles) serveStylesheet(writer http.ResponseWriter, request *http.Request) {
	relative := strings.TrimPrefix(request.URL.Path, "/css/")
	if !strings.HasSuffix(relative, ".css") || !fs.ValidPath(relative) {
		http.Error(writer, "Not found", http.StatusNotFound)
		return
	}
	static.serveFile(writer, request, path.Join("web/css", relative), "")
}

func (static *staticFiles) serveMapArt(writer http.ResponseWriter, request *http.Request) {
	name := request.PathValue("file")
	if !strings.HasSuffix(name, ".svg") || !fs.ValidPath(name) || strings.Contains(name, "/") {
		http.Error(writer, "Not found", http.StatusNotFound)
		return
	}
	static.serveFile(writer, request, "assets/"+name, "max-age=3600")
}

func (static *staticFiles) serveMapsConfig(writer http.ResponseWriter, request *http.Request) {
	static.serveFile(writer, request, "assets/maps-config.json", "")
}

func (static *staticFiles) serveFont(writer http.ResponseWriter, request *http.Request) {
	font, found := static.fonts[request.PathValue("name")]
	if !found {
		http.Error(writer, "Not found", http.StatusNotFound)
		return
	}
	writer.Header().Set("Content-Type", "font/woff2")
	writer.Header().Set("Cache-Control", "max-age=86400")
	writer.Write(font)
}

// serveFile sends one file with an explicit content type. Built-in files are tagged with the app
// version (ETag), so the browser re-checks them cheaply and gets new ones after an update.
func (static *staticFiles) serveFile(writer http.ResponseWriter, request *http.Request, name, cacheControl string) {
	data, err := fs.ReadFile(static.files, name)
	if err != nil {
		http.Error(writer, "Not found", http.StatusNotFound)
		return
	}
	header := writer.Header()
	header.Set("Content-Type", contentTypeOf(name))
	if static.isDev {
		header.Set("Cache-Control", "no-cache, no-store")
		writer.Write(data)
		return
	}
	etag := `"` + static.version + `"`
	header.Set("ETag", etag)
	if cacheControl == "" {
		cacheControl = "no-cache" // always ask; answered with 304 while the version is the same
	}
	header.Set("Cache-Control", cacheControl)
	if request.Header.Get("If-None-Match") == etag {
		writer.WriteHeader(http.StatusNotModified)
		return
	}
	writer.Write(data)
}

func contentTypeOf(name string) string {
	if contentType, known := contentTypes[path.Ext(name)]; known {
		return contentType
	}
	return "application/octet-stream"
}
