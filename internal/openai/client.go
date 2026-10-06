// Package openai is a small client for the OpenAI API (Responses API with strict JSON schemas),
// shared by the task scan and AI Categorize. The API key stays on this PC and is only ever sent
// to api.openai.com (or the offline mock while testing: STM_OPENAI_API).
package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

// DefaultModel is used when the user hasn't picked one.
const DefaultModel = "gpt-5.4-mini"

// requestTimeout: a vision or categorize call can take a while; this only stops a hung connection.
const requestTimeout = 5 * time.Minute

// Client talks to the OpenAI API.
type Client struct {
	baseURL   string
	userAgent string
	http      *http.Client
}

// NewClient makes a client; STM_OPENAI_API points it at the mock server in tests.
func NewClient(userAgent string) *Client {
	baseURL := os.Getenv("STM_OPENAI_API")
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), userAgent: userAgent, http: &http.Client{Timeout: requestTimeout}}
}

// CheckKey asks for the model's details, which fails with a clear message for a bad key or model.
func (client *Client) CheckKey(ctx context.Context, key, model string) error {
	_, err := client.call(ctx, key, http.MethodGet, "/models/"+url.PathEscape(model), nil)
	return err
}

// Responses calls POST /responses with a request body and returns the decoded response.
func (client *Client) Responses(ctx context.Context, key string, body any) (map[string]any, error) {
	return client.call(ctx, key, http.MethodPost, "/responses", body)
}

func (client *Client) call(ctx context.Context, key, method, path string, body any) (map[string]any, error) {
	var payload io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("encoding the OpenAI request: %w", err)
		}
		payload = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, client.baseURL+path, payload)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+key)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", client.userAgent)
	response, err := client.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("OpenAI: %w", err)
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(response.Body)
	var decoded map[string]any
	_ = json.Unmarshal(responseBody, &decoded)
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return nil, errorFromResponse(response, decoded)
	}
	return decoded, nil
}

// errorFromResponse turns an OpenAI error into a sentence with a hint for the usual causes.
func errorFromResponse(response *http.Response, decoded map[string]any) error {
	// OpenAI's own message when it sent one, else the status text ("Unauthorized"), as v2 showed.
	message := http.StatusText(response.StatusCode)
	if errorObject, ok := decoded["error"].(map[string]any); ok {
		if text, ok := errorObject["message"].(string); ok && text != "" {
			message = text
		}
	}
	hint := ""
	switch response.StatusCode {
	case http.StatusUnauthorized:
		hint = " (check the API key)"
	case http.StatusNotFound:
		hint = " (model name not available to this key)"
	case http.StatusTooManyRequests:
		hint = " (rate limit or out of credit on this OpenAI account)"
	}
	return fmt.Errorf("OpenAI %d: %s%s", response.StatusCode, message, hint)
}

// OutputText joins the text the model wrote, and reports a refusal as an error.
func OutputText(response map[string]any) (string, error) {
	var text strings.Builder
	for _, output := range asList(response["output"]) {
		if asMap(output)["type"] != "message" {
			continue
		}
		for _, content := range asList(asMap(output)["content"]) {
			part := asMap(content)
			switch part["type"] {
			case "refusal":
				return "", fmt.Errorf("The AI declined: %v", part["refusal"])
			case "output_text":
				if piece, ok := part["text"].(string); ok {
					text.WriteString(piece)
				}
			}
		}
	}
	return text.String(), nil
}

// FunctionCalls lists the tool calls the model asked for in a response.
func FunctionCalls(response map[string]any) []map[string]any {
	var calls []map[string]any
	for _, output := range asList(response["output"]) {
		if asMap(output)["type"] == "function_call" {
			calls = append(calls, asMap(output))
		}
	}
	return calls
}

// reasoningModels are the models that accept a reasoning effort.
var reasoningModels = regexp.MustCompile(`^(gpt-5|gpt-6|o\d)`)

// SupportsReasoning reports whether a model accepts a "reasoning" setting.
func SupportsReasoning(model string) bool { return reasoningModels.MatchString(model) }

func asMap(value any) map[string]any {
	object, _ := value.(map[string]any)
	return object
}

func asList(value any) []any {
	list, _ := value.([]any)
	return list
}

var (
	apiKeyShape    = regexp.MustCompile(`^sk-[A-Za-z0-9_\-]{20,}$`)
	modelNameShape = regexp.MustCompile(`^[A-Za-z0-9._:-]{2,80}$`)
)

// CheckKeyShape refuses text that can't be an OpenAI API key (they start with sk-).
func CheckKeyShape(key string) error {
	if !apiKeyShape.MatchString(key) {
		return errors.New("That doesn't look like an OpenAI API key (they start with sk-)")
	}
	return nil
}

// CheckModelName refuses text that can't be a model name.
func CheckModelName(model string) error {
	if !modelNameShape.MatchString(model) {
		return errors.New("Model name looks wrong")
	}
	return nil
}
