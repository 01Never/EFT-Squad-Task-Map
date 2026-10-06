# OpenAI client (`internal/openai`)

**What it's for:** the small client the task scan and AI Categorize share: `POST /responses`
(the Responses API with strict JSON schemas), `GET /models/<model>` to check a key, and OpenAI's
errors turned into readable sentences.

**Where the key goes:** only to `https://api.openai.com/v1` (or `STM_OPENAI_API`, the offline mock
in tests), in the `Authorization` header. The key is kept in the settings on this PC and passed in
for each call; the client doesn't store or log it, and the page never sees it whole (CLAUDE.md).

**What it deliberately doesn't do:** retries, streaming, an SDK, or anything about the features'
prompts and schemas (those live in `taskscan` and `aicategorize`).

**The rules / limits:**
- `DefaultModel` = `gpt-5.4-mini`, used when Settings has none.
- Checking a key in Settings: `CheckKeyShape` (`sk-` and at least 20 letters, digits, `_` or `-`),
  `CheckModelName` (2–80 letters, digits, `.`, `_`, `:` or `-`), then `CheckKey` asks OpenAI for
  the model, which fails for a bad key or a model the key can't use.
- `SupportsReasoning`: model names starting with `gpt-5`, `gpt-6` or `o` plus a digit take a
  reasoning effort.
- `OutputText` joins the text the model wrote; a refusal becomes "The AI declined: …".
  `FunctionCalls` lists the tool calls (AI Categorize's wiki tool).
- Errors read "OpenAI <status>: <OpenAI's message>", plus a hint: 401 "(check the API key)", 404
  "(model name not available to this key)", 429 "(rate limit or out of credit on this OpenAI
  account)".
- `requestTimeout` = 5 minutes per call, only to stop a hung connection (v2 had none).
- User-Agent: `SquadTaskMap/<version> (personal local map tool)`.

**Files:** `client.go`.

**Tests:** none in Go. The offline mock (`go run ./cmd/mock`) accepts only
`sk-test_1234567890abcdefghijkl`. **Needs a real key** (HANDOFF §10.6).
