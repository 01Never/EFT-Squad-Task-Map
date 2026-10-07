package httpapi

import (
	"mime"
	"net/http"
	"strings"
)

// The server only answers the app's own page (ticket 04d). It listens on 127.0.0.1, but any web
// page open in the same browser can still send it requests:
//   - a site whose name points at 127.0.0.1 ("DNS rebinding") can read and overwrite the saved
//     data, so the Host header must be one of ours (421 otherwise);
//   - any site can send a "simple" cross-site POST (no preflight), so state-changing requests
//     must come from our own page's origin (403 otherwise);
//   - routes that read a JSON body only take a body sent as JSON (415 otherwise), so a form or a
//     text/plain POST can't reach them even from a browser that leaves out Origin.

// AllowedHosts lists the Host values (host:port) a listener answers to. The page's origin is
// "http://" + one of them. internal/app builds the list for the port it actually listens on;
// another listener (ticket 05) gets its own list and its own rules.
type AllowedHosts []string

// Guard answers a request only when it comes to one of the allowed hosts and, if it changes
// something, from the page served by one of them. Everything else is refused before any route
// runs (the page, its files, the API and the live events alike).
func Guard(allowed AllowedHosts, next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		status, reason := refusal(allowed, request.Method, request.Host, request.Header.Get("Origin"), request.Header.Get("Sec-Fetch-Site"))
		if status != 0 {
			http.Error(writer, reason, status)
			return
		}
		next.ServeHTTP(writer, request)
	})
}

// refusal applies the rules to one request: 0 when it may go on, otherwise the status and the
// one-line reason to answer with.
func refusal(allowed AllowedHosts, method, host, origin, fetchSite string) (int, string) {
	if !allowed.hasHost(host) {
		return http.StatusMisdirectedRequest, "This server only answers http://127.0.0.1 on its own port."
	}
	if !changesState(method) {
		return 0, ""
	}
	switch {
	case origin != "":
		if !allowed.hasOrigin(origin) {
			return http.StatusForbidden, "Only Squad Task Map's own page can do this."
		}
	case fetchSite != "":
		// Browsers that leave out Origin still say where the request comes from:
		// "same-origin" (our page) or "none" (typed in the address bar) pass.
		if fetchSite != "same-origin" && fetchSite != "none" {
			return http.StatusForbidden, "Only Squad Task Map's own page can do this."
		}
	}
	// No Origin and no Sec-Fetch-Site: not a browser (curl, the tests, the second copy's check).
	return 0, ""
}

// changesState: every method except GET, HEAD and OPTIONS may change something.
func changesState(method string) bool {
	return method != http.MethodGet && method != http.MethodHead && method != http.MethodOptions
}

func (allowed AllowedHosts) hasHost(host string) bool {
	for _, allowedHost := range allowed {
		if strings.EqualFold(host, allowedHost) {
			return true
		}
	}
	return false
}

func (allowed AllowedHosts) hasOrigin(origin string) bool {
	for _, allowedHost := range allowed {
		if strings.EqualFold(origin, "http://"+allowedHost) {
			return true
		}
	}
	return false
}

// jsonBody wraps a route that reads a JSON body: a body must be sent as application/json
// (415 otherwise). A request with no body and no Content-Type passes; the route reads it as {}.
func jsonBody(handler http.HandlerFunc) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		if !isSentAsJSON(request.Header.Get("Content-Type"), request.ContentLength) {
			http.Error(writer, "Send the body as application/json.", http.StatusUnsupportedMediaType)
			return
		}
		handler(writer, request)
	}
}

// isSentAsJSON: the Content-Type is application/json (any parameters, such as charset, are
// fine), or there is neither a Content-Type nor a body. contentLength is -1 when unknown.
func isSentAsJSON(contentType string, contentLength int64) bool {
	if contentType == "" {
		return contentLength == 0
	}
	mediaType, _, err := mime.ParseMediaType(contentType)
	return err == nil && mediaType == "application/json"
}
