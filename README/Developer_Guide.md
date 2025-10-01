# Developer Guide: Calling the LLM MCP Server

This guide helps downstream projects integrate with the loopback-only Model
Control Plane (MCP) server shipped in `modules/llm_caller`. It summarizes the
HTTP contract, authentication requirements, routing metadata, and testing
approach so teams can build confident, schema-compliant clients.

## Audience & Prerequisites

- You maintain a tool or service that must call the MCP endpoints exposed by the
  LLM Caller module.
- You can reach the host running the MCP server over `http://127.0.0.1:4037`
  (override host/port via `.env`).
- You are able to register a client token in
  `modules/llm_caller/config/client-registry.json` (or manage it via the config
  CLI helper) and arrange for the server operator to restart/reload the service.

## Authentication & Loopback Guardrails

- All endpoints enforce loopback only. Requests originating from any IP other
  than `127.0.0.1`, `::1`, or `::ffff:127.0.0.1` are rejected with HTTP 403.
- Include the header `X-LLM-Caller-Token: <client_token>` with every request.
  Tokens live in `config/client-registry.json` alongside the client `toolId` and
  the list of allowed methods. Missing or unknown tokens return HTTP 401/403.
- Configure method access per client to prevent accidental use of APIs you do
  not need. Example entry:

  ```json
  {
    "toolId": "my_cli_tool",
    "token": "super-secret-token",
    "allowedMethods": ["chat", "chatStream", "embed", "getHealth"]
  }
  ```

- Optional rate limiting can be enabled in `config/providers.json`. When active,
  callers who exceed their allowance receive HTTP 429 with a clamped
  `Retry-After` header and `retryAfterMs` payload field.

## Shared Request Envelope

Every request body is validated against JSON Schema (`api/schemas/v1`). Provide
these common fields:

- `requestId` — unique string per call (logged/returned for traceability).
- `callerTool` — identifier that matches the token entry (used in telemetry).
- `timestamp` — ISO-8601 string (optional but recommended).

Invalid payloads return HTTP 400 with `BAD_REQUEST` errors.

## Core Endpoints

### Chat

- **Method / Path**: `POST /mcp/chat`
- **Schema**: `chat_request.schema.json`
- **Purpose**: Send a synchronous chat completion request and receive a single
  message response.

#### Chat request example

```json
{
  "requestId": "chat-001",
  "timestamp": "2025-09-30T12:34:56Z",
  "callerTool": "my_cli_tool",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Summarize the project status." }
  ],
  "provider": "lmstudio_gpu",
  "model": "deepseek-coder-33b",
  "temperature": 0.2,
  "maxTokens": 512
}
```

#### Chat response snapshot

```json
{
  "requestId": "chat-001",
  "traceId": "req-8e2f7a",
  "message": { "role": "assistant", "content": "Status summary..." },
  "usage": { "inputTokens": 420, "outputTokens": 115 },
  "providerInfo": {
    "name": "lmstudio_gpu",
    "model": "deepseek-coder-33b",
    "routing": { "capability": "chat", "strategy": "caller-override" }
  },
  "retryAfterMs": null
}
```

### ChatStream

- **Method / Path**: `POST /mcp/chatStream`
- **Schema**: `chat_request.schema.json`
- **Purpose**: Receive a Server-Sent Events (SSE) stream of delta tokens.

Guidance:

- SSE events include `data` payloads with JSON objects `{ type, payload }`.
- The stream concludes with a `type: "completion"` frame that mirrors the chat
  response structure and echoes `traceId`/`providerInfo`.
- Control characters are stripped and each chunk is capped at 4,000 characters
  server-side.

### Embed

- **Method / Path**: `POST /mcp/embed`
- **Schema**: `embed_request.schema.json`
- **Purpose**: Generate embedding vectors for an array of strings.

#### Embed request example

```json
{
  "requestId": "embed-001",
  "callerTool": "my_cli_tool",
  "inputs": ["paragraph one", "paragraph two"],
  "model": "nomic-embed-text"
}
```

#### Embed response snapshot

```json
{
  "requestId": "embed-001",
  "traceId": "req-02c4b9",
  "vectors": [[0.12, -0.04, ...], [0.22, 0.19, ...]],
  "usage": { "inputTokens": 258, "outputTokens": 0 },
  "providerInfo": {
    "name": "lmstudio_gpu",
    "model": "nomic-embed-text",
    "routing": { "capability": "embed", "strategy": "capability-default" }
  }
}
```

### Model Discovery

- **Method / Path**: `GET /mcp/models`
- **Query Parameters**: Optional `provider` filter.
- **Purpose**: Inspect available models and routing metadata.

Response payload includes an array of provider objects:

```json
[
  {
    "name": "lmstudio_gpu",
    "capabilities": ["chat", "chatStream", "embed"],
    "defaults": { "chat": "deepseek-coder-33b", "embed": "nomic-embed-text" },
    "scores": { "chat": 95, "embed": 65 },
    "models": [
      { "id": "deepseek-coder-33b", "ready": true },
      { "id": "nomic-embed-text", "ready": true }
    ]
  }
]
```

Use this endpoint during integration tests to confirm capability coverage and
validate that provider aliases (for example, `lmstudio-chat`) appear as expected.

### Health

- **Method / Path**: `GET /health`
- **Purpose**: Retrieve overall service status plus per-provider
  `capabilityCoverage`. Combine with `/mcp/models` to monitor degraded or missing
  capabilities.

## Capability Routing Primer

- Provider entries in `config/providers.json` declare:
  - `capabilities`: which methods they support (`chat`, `chatStream`, `embed`).
  - `defaults`: preferred model per capability.
  - `scores`: relative ranking for tie-breaking when multiple providers service
    the same capability.
- Routing metadata exposed via `providerInfo.routing` helps clients reason about
  outcomes:
  - `capability`: The capability deduced from the request (`chat`, `embed`, etc.).
  - `strategy`: One of `capability-default`, `caller-override`, or `fallback`.
- If you explicitly provide `provider`/`model`, the strategy becomes
  `caller-override`. Without overrides, the orchestrator evaluates `scores`
  before selecting a capability default. When no defaults are present it falls
  back to the provider-wide `defaultModel`.

## Error Handling & Retries

- Errors from upstream providers are normalized using the classifications below:

  | Classification | HTTP | Retry guidance |
  | --- | --- | --- |
  | `TEMPORARY` | 503 | Retry with exponential backoff; respect `retryAfterMs`. |
  | `PERMANENT` | 422 | Do not retry until payload or config changes. |
  | `AUTH` | 502 | Check provider credentials. |
  | `CONFIG` | 500 | Server misconfiguration; escalate to operators. |
  | `RATE_LIMIT` | 429 | Obey `Retry-After` guidance (≤ 60,000 ms). |

- All error payloads include `traceId` when available so you can correlate with
  provider logs. The transport also emits structured logs keyed by `requestId`.

## Testing & Tooling

- **Schema validation**: Use the JSON Schema files under
  `modules/llm_caller/api/schemas/v1/` to auto-generate request/response types in
  your project.
- **Local UAT**: Run `python3 uat/run_uat.py` (requires loopback networking) to
  exercise `/mcp/chat`, `/mcp/chatStream`, `/mcp/embed`, `/mcp/models`, and
  `/health` end-to-end.
- **Configuration CLI**: `npm run config` (from repo root) launches an
  interactive CLI to manage provider entries, discover LM Studio models, and
  edit client tokens safely.
- **Telemetry hooks**: Metrics and logs tagged with `callerTool` and
  `providerInfo` allow downstream projects to track usage and troubleshoot.

## Integration Checklist

1. Register or update your client token in `config/client-registry.json` and
   arrange for the MCP server to reload configuration.
2. Confirm `config/providers.json` advertises the capabilities you plan to call
   (use the CLI helper to inspect defaults/scores).
3. Perform a smoke test against `/mcp/models` and `/health` to verify routing
   metadata and provider readiness.
4. Exercise each required endpoint with representative payloads, capturing
   `requestId`/`traceId` pairs for debugging.
5. Document the `strategy` outcomes you expect (`capability-default` vs
   `caller-override`) so future regressions are easy to detect.
6. Add automated validation in your project that asserts schema compliance
   before making live calls.
