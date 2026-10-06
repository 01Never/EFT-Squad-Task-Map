// Tests that jsValue reads and writes JSON the way JavaScript's JSON.parse / JSON.stringify do.

package main

import (
	"math"
	"testing"
)

func TestFormatJavaScriptNumber(t *testing.T) {
	tests := []struct {
		name   string
		number float64
		want   string
	}{
		{"whole numbers have no decimal point", 42, "42"},
		{"fractions use the shortest digits that read back the same", 0.1, "0.1"},
		{"a trailing zero is dropped", 1.50, "1.5"},
		{"negative numbers get a minus sign", -2.5, "-2.5"},
		{"negative zero is written as 0", math.Copysign(0, -1), "0"},
		{"numbers below 1e21 stay in plain notation", 1e20, "100000000000000000000"},
		{"1e21 and above use an exponent with a plus sign", 1e21, "1e+21"},
		{"large numbers keep 17 significant digits", 123456789012345678901234, "1.2345678901234569e+23"},
		{"0.000001 stays in plain notation", 1e-6, "0.000001"},
		{"smaller numbers use an exponent", 1e-7, "1e-7"},
		{"an exponent with several digits gets a decimal point", 1.5e-7, "1.5e-7"},
		{"Infinity is written as JavaScript text", math.Inf(1), "Infinity"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := formatJavaScriptNumber(test.number); got != test.want {
				t.Errorf("formatJavaScriptNumber(%v) = %q, want %q", test.number, got, test.want)
			}
		})
	}
}

func TestParseThenStringifyMatchesJavaScript(t *testing.T) {
	tests := []struct {
		name string
		json string
		want string
	}{
		{"object keys keep their order", `{"b":1,"a":2}`, `{"b":1,"a":2}`},
		{"array-index keys come first, in number order", `{"b":1,"2":2,"1":3,"01":4,"4294967295":5}`,
			`{"1":3,"2":2,"b":1,"01":4,"4294967295":5}`},
		{"a repeated key keeps its first place and its last value", `{"a":1,"b":2,"a":3}`, `{"a":3,"b":2}`},
		{"whitespace between tokens is dropped", "[ 1 ,\n {\"a\" : null} ]", `[1,{"a":null}]`},
		{"numbers are rewritten like JavaScript", `[1.50, 1E2, 0.1e1, -0, 1e400]`, `[1.5,100,1,0,null]`},
		{"HTML characters are not escaped", `"<&>"`, `"<&>"`},
		{"escaped letters and slashes are written plainly", `"A\/"`, `"A/"`},
		{"control characters use lowercase escapes", `"\u001F\n\t"`, `"\u001f\n\t"`},
		{"emoji written as surrogate escapes come out as the emoji", `"🚀"`, "\"\xF0\x9F\x9A\x80\""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			value, err := parseJavaScriptJSON([]byte(test.json))
			if err != nil {
				t.Fatalf("parseJavaScriptJSON(%s): %v", test.json, err)
			}
			if got := value.stringify(); got != test.want {
				t.Errorf("stringify = %s, want %s", got, test.want)
			}
		})
	}
}

func TestParseRefusesWhatJSONParseRefuses(t *testing.T) {
	tests := []struct {
		name string
		json string
	}{
		{"an empty body", ""},
		{"text that isn't JSON", "not json"},
		{"data after the value", `{} {}`},
		{"an unfinished object", `{"a":`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := parseJavaScriptJSON([]byte(test.json)); err == nil {
				t.Errorf("parseJavaScriptJSON(%q) succeeded, want an error", test.json)
			}
		})
	}
}

func TestIsTruthyFollowsJavaScript(t *testing.T) {
	tests := []struct {
		name string
		json string
		want bool
	}{
		{"null is false", `null`, false},
		{"false is false", `false`, false},
		{"zero is false", `0`, false},
		{"empty text is false", `""`, false},
		{"true is true", `true`, true},
		{"a number is true", `1`, true},
		{"text is true", `"no"`, true},
		{"an empty list is true", `[]`, true},
		{"an empty object is true", `{}`, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			value, err := parseJavaScriptJSON([]byte(test.json))
			if err != nil {
				t.Fatal(err)
			}
			if got := value.isTruthy(); got != test.want {
				t.Errorf("isTruthy(%s) = %v, want %v", test.json, got, test.want)
			}
		})
	}
	if (jsValue{}).isTruthy() {
		t.Error("undefined is truthy, want false")
	}
}

func TestToJavaScriptString(t *testing.T) {
	tests := []struct {
		name  string
		value jsValue
		want  string
	}{
		{"a missing value is undefined", jsValue{}, "undefined"},
		{"null is null", jsNullValue(), "null"},
		{"text is itself", jsStringValue("gpt-5.4"), "gpt-5.4"},
		{"a number uses JavaScript's format", jsNumberValue(1e21), "1e+21"},
		{"a list is joined with commas, null as empty", jsArrayValue(jsStringValue("a"), jsNullValue(), jsNumberValue(2)), "a,,2"},
		{"an object is [object Object]", jsObjectValue(), "[object Object]"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := test.value.toJavaScriptString(); got != test.want {
				t.Errorf("toJavaScriptString() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestUTF16LengthCountsEmojiTwice(t *testing.T) {
	// "A", "é" and the rocket emoji: JavaScript's length is 1 + 1 + 2.
	if got := utf16Length("A\xC3\xA9\xF0\x9F\x9A\x80"); got != 4 {
		t.Errorf("utf16Length = %d, want 4", got)
	}
}
