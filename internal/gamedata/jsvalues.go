package gamedata

// The converter reads tarkov.dev's loosely-shaped JSON files. These helpers answer "is this set?",
// "what number is this?" and "what text is this?" the same way the v2 (JavaScript) converter did,
// so both produce identical output for the same files. Decoded JSON values are nil, bool,
// float64, string, []any or map[string]any.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// isSet is JavaScript truthiness: nil, false, 0, NaN and "" are "not set"; everything else
// (including empty lists and objects) is set.
func isSet(value any) bool {
	switch v := value.(type) {
	case nil:
		return false
	case bool:
		return v
	case float64:
		return v != 0 && !math.IsNaN(v)
	case string:
		return v != ""
	default:
		return true
	}
}

// numberOr0 is a finite number, or 0 for anything else.
func numberOr0(value any) float64 {
	if number, isNumber := value.(float64); isNumber && !math.IsInf(number, 0) && !math.IsNaN(number) {
		return number
	}
	return 0
}

// text turns a value into text the way JavaScript's String() does for the values that occur here.
func text(value any) string {
	switch v := value.(type) {
	case nil:
		return "null"
	case string:
		return v
	case bool:
		return strconv.FormatBool(v)
	case float64:
		return numberText(v)
	case []any:
		parts := make([]string, len(v))
		for i, item := range v {
			if item != nil {
				parts[i] = text(item)
			}
		}
		return strings.Join(parts, ",")
	default:
		return "[object Object]"
	}
}

// numberText formats a number like JavaScript: shortest form, no ".0", exponent only for very
// large or very small numbers.
func numberText(number float64) string {
	magnitude := math.Abs(number)
	if number == 0 {
		return "0"
	}
	if magnitude >= 1e21 || magnitude < 1e-6 {
		formatted := strconv.FormatFloat(number, 'e', -1, 64)
		// Go writes 1e-07; JavaScript writes 1e-7.
		mantissa, exponent, _ := strings.Cut(formatted, "e")
		sign := exponent[:1]
		digits := strings.TrimLeft(exponent[1:], "0")
		return mantissa + "e" + sign + digits
	}
	return strconv.FormatFloat(number, 'f', -1, 64)
}

// isFiniteLikeJS is JavaScript's global isFinite(), for the values that occur in the data:
// numbers, null (counts as 0), booleans and numeric text.
func isFiniteLikeJS(value any) bool {
	switch v := value.(type) {
	case nil, bool:
		return true
	case float64:
		return !math.IsInf(v, 0) && !math.IsNaN(v)
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return true
		}
		number, err := strconv.ParseFloat(trimmed, 64)
		return err == nil && !math.IsInf(number, 0)
	default:
		return false
	}
}

// roundToHundredths rounds like JavaScript's (x).toFixed(2) and reads the result back as a
// number: it rounds the exact binary value, with exact halves going away from zero.
func roundToHundredths(number float64) float64 {
	// The exact decimal value of the double (coordinates have well under 80 fractional digits).
	exact := strconv.FormatFloat(math.Abs(number), 'f', 80, 64)
	whole, fraction, _ := strings.Cut(exact, ".")
	fraction += "000"
	hundredths, _ := strconv.ParseInt(whole+fraction[:2], 10, 64)
	// What's left is at least half a hundredth: round up (of two equally close values, JavaScript
	// picks the larger one).
	if fraction[2] >= '5' {
		hundredths++
	}
	result := float64(hundredths) / 100
	if number < 0 && result != 0 {
		return -result
	}
	return result // JavaScript's -0 prints as 0
}

// rawJSON re-encodes a decoded value (used to copy a field through unchanged).
func rawJSON(value any) json.RawMessage {
	data, _ := json.Marshal(value)
	return data
}

// ---------------------------------------------------------------- reading JSON in its original order

// orderedEntry is one key/value of a JSON object, in file order.
type orderedEntry struct {
	Key   string
	Value any
}

// orderedObject decodes a JSON object keeping its keys in file order. JavaScript loops over an
// object's keys in that order, and the task and map lists come out in it, so Go must too.
func orderedObject(raw json.RawMessage) ([]orderedEntry, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	start, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	if delimiter, isDelimiter := start.(json.Delim); !isDelimiter || delimiter != '{' {
		return nil, nil // not an object: nothing to loop over (as in JavaScript)
	}
	var entries []orderedEntry
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		var value any
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		entries = append(entries, orderedEntry{Key: fmt.Sprint(keyToken), Value: value})
	}
	return entries, nil
}

// objectField returns one field of a JSON object as raw JSON (nil when missing or not an object).
func objectField(raw json.RawMessage, key string) json.RawMessage {
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return nil
	}
	return fields[key]
}

// dataOf is `doc.data` when the file wraps its content in "data" (json.tarkov.dev does), else the
// doc itself.
func dataOf(raw json.RawMessage) json.RawMessage {
	if inner := objectField(raw, "data"); len(inner) > 0 && string(inner) != "null" {
		var check any
		if json.Unmarshal(inner, &check) == nil && isSet(check) {
			return inner
		}
	}
	if len(raw) == 0 || string(raw) == "null" {
		return json.RawMessage("{}")
	}
	return raw
}

// asObject decodes a JSON object into a map (an empty map for anything else).
func asObject(raw json.RawMessage) map[string]any {
	var object map[string]any
	if json.Unmarshal(raw, &object) != nil || object == nil {
		return map[string]any{}
	}
	return object
}

// get reads a field of a decoded object; nil when the value isn't an object or the field is missing.
func get(value any, key string) any {
	if object, isObject := value.(map[string]any); isObject {
		return object[key]
	}
	return nil
}

// has reports whether a field exists in a decoded object (even when its value is null).
func has(value any, key string) bool {
	if object, isObject := value.(map[string]any); isObject {
		_, present := object[key]
		return present
	}
	return false
}

// listOf is the value as a list, or an empty list.
func listOf(value any) []any {
	if list, isList := value.([]any); isList {
		return list
	}
	return nil
}
