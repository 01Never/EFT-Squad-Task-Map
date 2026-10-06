// JSON values that read and write the way JavaScript's JSON.parse and JSON.stringify do.
// v2's mock echoed request data (rows, reasoning, model) back through JSON.stringify, so keeping
// JavaScript's key order, number format and string escapes lets this mock answer byte for byte
// the same. It is not a general JSON library: it only has what the mock needs.

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
)

// jsKind says which kind of JavaScript value a jsValue holds.
type jsKind int

const (
	jsUndefined jsKind = iota // a missing value (the zero jsValue); JSON.stringify leaves such fields out
	jsNull
	jsBoolean
	jsNumber
	jsString
	jsArray
	jsObject
)

// jsValue is one JavaScript value made from JSON. Only the field that matches kind is used.
type jsValue struct {
	kind    jsKind
	boolean bool
	number  float64
	text    string
	items   []jsValue // array elements
	fields  []jsField // object fields, in the order JavaScript lists them
}

// jsField is one name/value pair of a JavaScript object.
type jsField struct {
	name  string
	value jsValue
}

func jsNullValue() jsValue {
	return jsValue{kind: jsNull}
}

func jsBooleanValue(boolean bool) jsValue {
	return jsValue{kind: jsBoolean, boolean: boolean}
}

func jsNumberValue(number float64) jsValue {
	return jsValue{kind: jsNumber, number: number}
}

func jsStringValue(text string) jsValue {
	return jsValue{kind: jsString, text: text}
}

func jsArrayValue(items ...jsValue) jsValue {
	return jsValue{kind: jsArray, items: append([]jsValue{}, items...)}
}

// jsObjectValue builds an object literal. Fields keep the order they're given in, like
// { id: "r1", model: ... } in JavaScript.
func jsObjectValue(fields ...jsField) jsValue {
	return jsValue{kind: jsObject, fields: append([]jsField{}, fields...)}
}

func field(name string, value jsValue) jsField {
	return jsField{name: name, value: value}
}

// get returns an object's field, or undefined when it has none (like value.name in JavaScript).
func (value jsValue) get(name string) jsValue {
	for _, objectField := range value.fields {
		if objectField.name == name {
			return objectField.value
		}
	}
	return jsValue{}
}

// at returns an array's element, or undefined (like value[index] in JavaScript). On a string it
// returns that character; JavaScript counts UTF-16 units, which is the same for ordinary text.
func (value jsValue) at(index int) jsValue {
	if value.kind == jsArray && index < len(value.items) {
		return value.items[index]
	}
	if value.kind == jsString {
		characters := []rune(value.text)
		if index < len(characters) {
			return jsStringValue(string(characters[index]))
		}
	}
	return jsValue{}
}

// isTruthy follows JavaScript: undefined, null, false, 0, NaN and "" are false. Everything else
// is true, even an empty array or object.
func (value jsValue) isTruthy() bool {
	switch value.kind {
	case jsBoolean:
		return value.boolean
	case jsNumber:
		return value.number != 0 && !math.IsNaN(value.number)
	case jsString:
		return value.text != ""
	case jsArray, jsObject:
		return true
	default:
		return false
	}
}

// toJavaScriptString returns what JavaScript's String(value) gives, which is what a template
// literal `${value}` or "text" + value writes.
func (value jsValue) toJavaScriptString() string {
	switch value.kind {
	case jsUndefined:
		return "undefined"
	case jsNull:
		return "null"
	case jsBoolean:
		return strconv.FormatBool(value.boolean)
	case jsNumber:
		return formatJavaScriptNumber(value.number)
	case jsString:
		return value.text
	case jsArray:
		return joinArrayLikeJavaScript(value.items)
	default:
		return "[object Object]"
	}
}

// joinArrayLikeJavaScript is Array.prototype.join(","): null and undefined elements become "".
func joinArrayLikeJavaScript(items []jsValue) string {
	texts := make([]string, len(items))
	for i, item := range items {
		if item.kind == jsNull || item.kind == jsUndefined {
			continue
		}
		texts[i] = item.toJavaScriptString()
	}
	return strings.Join(texts, ",")
}

// stringify returns JSON.stringify(value). Callers don't pass undefined at the top level
// (JavaScript would return undefined, not text); it writes "null" here.
func (value jsValue) stringify() string {
	var builder strings.Builder
	writeJSValue(&builder, value)
	return builder.String()
}

func writeJSValue(builder *strings.Builder, value jsValue) {
	switch value.kind {
	case jsBoolean:
		builder.WriteString(strconv.FormatBool(value.boolean))
	case jsNumber:
		writeJSNumber(builder, value.number)
	case jsString:
		writeJSString(builder, value.text)
	case jsArray:
		writeJSArray(builder, value.items)
	case jsObject:
		writeJSObject(builder, value.fields)
	default:
		// null, and undefined inside an array, which JSON.stringify writes as null.
		builder.WriteString("null")
	}
}

// writeJSNumber writes a number; JSON has no NaN or Infinity, so JSON.stringify writes null.
func writeJSNumber(builder *strings.Builder, number float64) {
	if math.IsNaN(number) || math.IsInf(number, 0) {
		builder.WriteString("null")
		return
	}
	builder.WriteString(formatJavaScriptNumber(number))
}

func writeJSArray(builder *strings.Builder, items []jsValue) {
	builder.WriteByte('[')
	for i, item := range items {
		if i > 0 {
			builder.WriteByte(',')
		}
		writeJSValue(builder, item)
	}
	builder.WriteByte(']')
}

// writeJSObject writes an object's fields; undefined ones are left out, as JSON.stringify does.
func writeJSObject(builder *strings.Builder, fields []jsField) {
	builder.WriteByte('{')
	isFirstField := true
	for _, objectField := range fields {
		if objectField.value.kind == jsUndefined {
			continue
		}
		if !isFirstField {
			builder.WriteByte(',')
		}
		isFirstField = false
		writeJSString(builder, objectField.name)
		builder.WriteByte(':')
		writeJSValue(builder, objectField.value)
	}
	builder.WriteByte('}')
}

// writeJSString quotes text like JSON.stringify: only the quote, the backslash and control
// characters are escaped. Unlike Go's encoder, it leaves <, > and & as they are.
func writeJSString(builder *strings.Builder, text string) {
	builder.WriteByte('"')
	for _, character := range text {
		switch character {
		case '"':
			builder.WriteString(`\"`)
		case '\\':
			builder.WriteString(`\\`)
		case '\b':
			builder.WriteString(`\b`)
		case '\f':
			builder.WriteString(`\f`)
		case '\n':
			builder.WriteString(`\n`)
		case '\r':
			builder.WriteString(`\r`)
		case '\t':
			builder.WriteString(`\t`)
		default:
			if character < 0x20 {
				fmt.Fprintf(builder, `\u%04x`, character)
			} else {
				builder.WriteRune(character)
			}
		}
	}
	builder.WriteByte('"')
}

// formatJavaScriptNumber writes a number the way JavaScript's String(number) does: the shortest
// digits that read back as the same number, in plain notation from 1e-7 up to 1e21 and with an
// exponent ("1e+21", "1.5e-7") outside that range. The rules are ECMAScript's Number::toString.
func formatJavaScriptNumber(number float64) string {
	switch {
	case math.IsNaN(number):
		return "NaN"
	case math.IsInf(number, 1):
		return "Infinity"
	case math.IsInf(number, -1):
		return "-Infinity"
	case number == 0:
		return "0" // also for -0
	case number < 0:
		return "-" + formatJavaScriptNumber(-number)
	}

	// Go's shortest form "d.dddde±x" gives the same digits JavaScript picks.
	scientific := strconv.FormatFloat(number, 'e', -1, 64)
	mantissa, exponentText, _ := strings.Cut(scientific, "e")
	digits := strings.Replace(mantissa, ".", "", 1)
	exponent, _ := strconv.Atoi(exponentText)

	// ECMAScript's names: the number is 0.<digits> × 10^pointPosition.
	digitCount := len(digits)
	pointPosition := exponent + 1
	switch {
	case digitCount <= pointPosition && pointPosition <= 21:
		return digits + strings.Repeat("0", pointPosition-digitCount)
	case 0 < pointPosition && pointPosition <= 21:
		return digits[:pointPosition] + "." + digits[pointPosition:]
	case -6 < pointPosition && pointPosition <= 0:
		return "0." + strings.Repeat("0", -pointPosition) + digits
	}
	return formatJavaScriptExponent(digits, exponent)
}

// formatJavaScriptExponent writes digits × 10^exponent as JavaScript does: "1e+21", "1.5e-7".
func formatJavaScriptExponent(digits string, exponent int) string {
	sign := "+"
	if exponent < 0 {
		sign = "-"
		exponent = -exponent
	}
	exponentPart := "e" + sign + strconv.Itoa(exponent)
	if len(digits) == 1 {
		return digits + exponentPart
	}
	return digits[:1] + "." + digits[1:] + exponentPart
}

// utf16Length is JavaScript's text.length: it counts UTF-16 units, so characters outside the
// Basic Multilingual Plane (most emoji) count twice.
func utf16Length(text string) int {
	length := 0
	for _, character := range text {
		if character > 0xFFFF {
			length += 2
		} else {
			length++
		}
	}
	return length
}

// parseJavaScriptJSON reads JSON like JavaScript's JSON.parse: objects keep their key order
// (see addField) and numbers become float64.
func parseJavaScriptJSON(data []byte) (jsValue, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	value, err := readJSValue(decoder)
	if err != nil {
		return jsValue{}, fmt.Errorf("reading JSON: %w", err)
	}
	// JSON.parse refuses anything but whitespace after the value.
	if _, err := decoder.Token(); err != io.EOF {
		return jsValue{}, errors.New("reading JSON: unexpected data after the value")
	}
	return value, nil
}

func readJSValue(decoder *json.Decoder) (jsValue, error) {
	token, err := decoder.Token()
	if err != nil {
		return jsValue{}, err
	}
	switch token := token.(type) {
	case nil:
		return jsNullValue(), nil
	case bool:
		return jsBooleanValue(token), nil
	case json.Number:
		return readJSNumber(token)
	case string:
		return jsStringValue(token), nil
	case json.Delim:
		if token == '[' {
			return readJSArray(decoder)
		}
		if token == '{' {
			return readJSObject(decoder)
		}
	}
	return jsValue{}, fmt.Errorf("unexpected JSON token %v", token)
}

// readJSNumber reads a number as a float64. Too large a number becomes Infinity, as in JavaScript.
func readJSNumber(token json.Number) (jsValue, error) {
	number, err := strconv.ParseFloat(string(token), 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return jsValue{}, err
	}
	return jsNumberValue(number), nil
}

func readJSArray(decoder *json.Decoder) (jsValue, error) {
	array := jsArrayValue()
	for decoder.More() {
		item, err := readJSValue(decoder)
		if err != nil {
			return jsValue{}, err
		}
		array.items = append(array.items, item)
	}
	_, err := decoder.Token() // the closing ]
	return array, err
}

func readJSObject(decoder *json.Decoder) (jsValue, error) {
	object := jsObjectValue()
	for decoder.More() {
		nameToken, err := decoder.Token()
		if err != nil {
			return jsValue{}, err
		}
		name, isText := nameToken.(string)
		if !isText {
			return jsValue{}, fmt.Errorf("unexpected object key %v", nameToken)
		}
		value, err := readJSValue(decoder)
		if err != nil {
			return jsValue{}, err
		}
		object.addField(name, value)
	}
	if _, err := decoder.Token(); err != nil { // the closing }
		return jsValue{}, err
	}
	object.putArrayIndexNamesFirst()
	return object, nil
}

// addField adds a parsed field. A repeated name keeps its first place and takes the last value,
// as JSON.parse does.
func (value *jsValue) addField(name string, fieldValue jsValue) {
	for i := range value.fields {
		if value.fields[i].name == name {
			value.fields[i].value = fieldValue
			return
		}
	}
	value.fields = append(value.fields, field(name, fieldValue))
}

// putArrayIndexNamesFirst sorts fields the way a JavaScript object lists them: names that are
// array indexes ("0", "1", "42") first, in number order, then the others in the order they came.
func (value *jsValue) putArrayIndexNamesFirst() {
	sort.SliceStable(value.fields, func(i, j int) bool {
		firstIndex, isFirstIndex := arrayIndexFromName(value.fields[i].name)
		secondIndex, isSecondIndex := arrayIndexFromName(value.fields[j].name)
		if isFirstIndex && isSecondIndex {
			return firstIndex < secondIndex
		}
		return isFirstIndex && !isSecondIndex
	})
}

// arrayIndexFromName reports whether JavaScript treats an object key as an array index: the
// plain decimal form (no sign, no leading zero) of a whole number below 2^32 - 1.
func arrayIndexFromName(name string) (uint64, bool) {
	if name == "" || len(name) > 10 || (len(name) > 1 && name[0] == '0') {
		return 0, false
	}
	for i := 0; i < len(name); i++ {
		if name[i] < '0' || name[i] > '9' {
			return 0, false
		}
	}
	index, err := strconv.ParseUint(name, 10, 64)
	if err != nil || index >= math.MaxUint32 {
		return 0, false
	}
	return index, true
}
