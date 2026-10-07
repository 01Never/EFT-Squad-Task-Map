// The fake OpenAI API: key check, GET /v1/models/<id> and POST /v1/responses. A request with a
// screenshot gets the preset task rows ("Scan tasks"); any other request is treated as
// AI Categorize and moves every part that needs a key to a new "Key runs" category.

package main

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// The only API key the fake OpenAI accepts. Tests use it as "a valid key"; any other is refused.
const acceptedAPIKey = "sk-test_1234567890abcdefghijkl"

// The category the fake categorize answer creates and moves keyed parts into.
const (
	keyRunsCategoryName  = "Key runs"
	keyRunsCategoryColor = "#4dabf7"
	keyRunsCategoryIcon  = "star"
)

// The app's categorize request puts the parts to sort, as JSON, after this marker in the first
// message (server/ai.ts in v2, internal/features/aicategorize in Go).
const partsMarker = "PARTS:\n"

// The app's extract-list request asks "Read the extract list in this screenshot." (ticket 06);
// the task scan's asks for task rows.
const extractListMarker = "extract list"

// handleOpenAI checks the key, then answers /v1/models/<id> and /v1/responses.
// Any other /v1/ path gets 404 "nf", as in v2.
func (mock *mockServer) handleOpenAI(writer http.ResponseWriter, request *http.Request, path string) {
	if !hasAcceptedAPIKey(request) {
		refusal := jsObjectValue(field("error", jsObjectValue(
			field("message", jsStringValue("Incorrect API key provided")),
		)))
		writeJSON(writer, http.StatusUnauthorized, refusal)
		return
	}
	if modelID, isModelPath := strings.CutPrefix(path, "/v1/models/"); isModelPath {
		writeJSON(writer, http.StatusOK, jsObjectValue(field("id", jsStringValue(modelID))))
		return
	}
	if path == "/v1/responses" {
		mock.handleResponses(writer, request)
		return
	}
	writeText(writer, http.StatusNotFound, "nf")
}

// hasAcceptedAPIKey compares the whole Authorization header, as v2 did. Repeated headers are
// joined with ", " like the Fetch API's headers.get().
func hasAcceptedAPIKey(request *http.Request) bool {
	authorization := strings.Join(request.Header.Values("Authorization"), ", ")
	return authorization == "Bearer "+acceptedAPIKey
}

// handleResponses answers POST /v1/responses. A request whose input mentions "input_image" is a
// screenshot to read; anything else is a categorize request. Each request adds one log line:
//
//	responses model=<model> vision=<true|false> reasoning=<JSON or null> imgBytes=<n>
//
// where imgBytes is the length of the input as JSON (0 when there's no image), counted the way
// JavaScript counts text length.
func (mock *mockServer) handleResponses(writer http.ResponseWriter, request *http.Request) {
	body, err := readJSONBody(request)
	if err != nil {
		writeServerError(writer, err)
		return
	}
	input := body.get("input")
	if input.kind == jsUndefined {
		writeServerError(writer, errors.New("the request has no input"))
		return
	}

	inputJSON := input.stringify()
	isVision := strings.Contains(inputJSON, "input_image")
	isExtractList := isVision && strings.Contains(inputJSON, extractListMarker)
	logLine := responsesLogLine(body, inputJSON, isVision)
	if isExtractList {
		logLine += " extracts=true" // lets tests count the extract reads apart from the task scan's
	}
	mock.addToLog(logLine)

	model := body.get("model")
	if isExtractList {
		mock.mutex.Lock()
		list := mock.extractList
		mock.mutex.Unlock()
		writeJSON(writer, http.StatusOK, responseWithText("r3", model, list.stringify()))
		return
	}
	if isVision {
		mock.mutex.Lock()
		rows := mock.visionRows
		mock.mutex.Unlock()
		answer := jsObjectValue(field("rows", rows))
		writeJSON(writer, http.StatusOK, responseWithText("r1", model, answer.stringify()))
		return
	}

	answer, err := categorizeAnswer(input)
	if err != nil {
		writeServerError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, responseWithText("r2", model, answer.stringify()))
}

// responsesLogLine writes v2's log line for a /v1/responses request. The model is written as
// JavaScript text ("undefined" when missing); a missing or empty reasoning is written as null.
func responsesLogLine(body jsValue, inputJSON string, isVision bool) string {
	reasoning := body.get("reasoning")
	if !reasoning.isTruthy() {
		reasoning = jsNullValue()
	}
	imageBytes := 0
	if isVision {
		imageBytes = utf16Length(inputJSON)
	}
	return fmt.Sprintf("responses model=%s vision=%t reasoning=%s imgBytes=%d",
		body.get("model").toJavaScriptString(), isVision, reasoning.stringify(), imageBytes)
}

// responseWithText wraps an answer the way the Responses API does: one message holding one
// output_text. A request without a model gets an answer without one (JSON.stringify drops it).
func responseWithText(responseID string, model jsValue, text string) jsValue {
	outputText := jsObjectValue(
		field("type", jsStringValue("output_text")),
		field("text", jsStringValue(text)),
	)
	message := jsObjectValue(
		field("type", jsStringValue("message")),
		field("content", jsArrayValue(outputText)),
	)
	return jsObjectValue(
		field("id", jsStringValue(responseID)),
		field("model", model),
		field("output", jsArrayValue(message)),
	)
}

// categorizeAnswer is the fake categorize result: a new "Key runs" category and every part with
// an objective that needs a key moved into it, with "Needs <first key>" as the reason.
func categorizeAnswer(input jsValue) (jsValue, error) {
	parts, err := partsFromInput(input)
	if err != nil {
		return jsValue{}, err
	}

	assignments := jsArrayValue()
	for _, part := range parts.items {
		keyedObjective, needsKey, err := firstObjectiveWithKeys(part)
		if err != nil {
			return jsValue{}, err
		}
		if needsKey {
			assignments.items = append(assignments.items, keyRunsAssignment(part, keyedObjective))
		}
	}

	reply := fmt.Sprintf("Moved %d parts that need keys.", len(assignments.items))
	keyRunsCategory := jsObjectValue(
		field("name", jsStringValue(keyRunsCategoryName)),
		field("color", jsStringValue(keyRunsCategoryColor)),
		field("icon", jsStringValue(keyRunsCategoryIcon)),
	)
	answer := jsObjectValue(
		field("reply", jsStringValue(reply)),
		field("new_categories", jsArrayValue(keyRunsCategory)),
		field("assignments", assignments),
	)
	return answer, nil
}

// partsFromInput reads the parts list from the first message's text, after "PARTS:\n".
// No marker (for example a follow-up request carrying wiki tool results) means no parts.
func partsFromInput(input jsValue) (jsValue, error) {
	content := input.at(0).get("content")
	if content.kind != jsString {
		// v2 used `content || ""`; a message whose content is a list holds no PARTS text either.
		return jsArrayValue(), nil
	}
	_, partsJSON, hasParts := strings.Cut(content.text, partsMarker)
	if !hasParts {
		return jsArrayValue(), nil
	}
	parts, err := parseJavaScriptJSON([]byte(partsJSON))
	if err != nil {
		return jsValue{}, fmt.Errorf("reading PARTS: %w", err)
	}
	if parts.kind != jsArray {
		return jsValue{}, errors.New("PARTS is not a list")
	}
	return parts, nil
}

// firstObjectiveWithKeys finds the part's first objective whose "keys" is set (JavaScript
// truthiness, so even an empty list counts, as in v2).
func firstObjectiveWithKeys(part jsValue) (jsValue, bool, error) {
	objectives := part.get("objectives")
	if objectives.kind != jsArray {
		return jsValue{}, false, fmt.Errorf("part %s has no objectives list",
			part.get("id").toJavaScriptString())
	}
	for _, objective := range objectives.items {
		if objective.get("keys").isTruthy() {
			return objective, true, nil
		}
	}
	return jsValue{}, false, nil
}

// keyRunsAssignment moves one part to "Key runs". The reason names the objective's first key
// as JavaScript text ("Needs undefined" for an empty list, as v2 wrote).
func keyRunsAssignment(part jsValue, keyedObjective jsValue) jsValue {
	firstKey := keyedObjective.get("keys").at(0)
	return jsObjectValue(
		field("part_id", part.get("id")),
		field("category", jsStringValue(keyRunsCategoryName)),
		field("reason", jsStringValue("Needs "+firstKey.toJavaScriptString())),
	)
}
