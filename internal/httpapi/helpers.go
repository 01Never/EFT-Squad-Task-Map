package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
)

func writeJSON(writer http.ResponseWriter, status int, value any) {
	data, err := json.Marshal(value)
	if err != nil {
		http.Error(writer, "encoding the answer: "+err.Error(), http.StatusInternalServerError)
		return
	}
	writeRawJSON(writer, status, data)
}

func writeRawJSON(writer http.ResponseWriter, status int, data []byte) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	writer.Write(data)
}

func writeError(writer http.ResponseWriter, status int, err error) {
	writeJSON(writer, status, map[string]any{"ok": false, "error": err.Error()})
}

func okAnswer() map[string]any { return map[string]any{"ok": true} }

// readBody decodes a JSON object body; anything else counts as an empty object (as v2 did).
func readBody(request *http.Request) map[string]any {
	var body map[string]any
	if json.NewDecoder(request.Body).Decode(&body) != nil || body == nil {
		return map[string]any{}
	}
	return body
}

func stringField(body map[string]any, name string) *string {
	if value, isString := body[name].(string); isString {
		return &value
	}
	return nil
}

func boolField(body map[string]any, name string) *bool {
	if value, isBool := body[name].(bool); isBool {
		return &value
	}
	return nil
}

func textField(body map[string]any, name string) string { return textOrEmpty(body[name]) }

// textOrEmpty is JavaScript's String(value || ""): "" for missing, null, false, 0 and "".
func textOrEmpty(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case bool:
		if !v {
			return ""
		}
		return "true"
	case float64:
		if v == 0 {
			return ""
		}
		data, _ := json.Marshal(v)
		return string(data)
	default:
		return fmt.Sprint(v)
	}
}

func asList(value any) []any {
	list, _ := value.([]any)
	return list
}

func optional(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func limitRunes(text string, limit int) string {
	runes := []rune(text)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return text
}

func firstN[T any](list []T, n int) []T {
	if len(list) > n {
		return list[:n]
	}
	return list
}
