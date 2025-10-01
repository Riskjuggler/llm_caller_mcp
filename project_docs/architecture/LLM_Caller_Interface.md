# LLM caller interface brief

<!-- cSpell:ignore lmstudio deepseek -->

## Integration context

- **Consumers**: Internal MCP-compatible tools requiring unified chat and
  embedding services.

- **Invocation path**: Loopback-only MCP transport exposed on `127.0.0.1:4037`.
- **Data flow**: Tools call MCP `chat`, `chatStream`, `embed`, `listModels`, and
  `getHealth` methods; LLM Caller orchestrates provider adapters and returns
  normalized JSON responses.

## Interface decision summary

- **Primary interface**: MCP (JSON-RPC over loopback) per governance standards.
- **Alternatives considered**:
  - **MCP + CLI**: Deferred; CLI workflows would duplicate transport safeguards
    and complicate token enforcement.

  - **Direct API**: Rejected; violates requirement that consumers interact only
    through MCP contracts.

- **Decision rationale**: MCP ensures consistent tool integration, aligns with
  agent governance, and leverages existing schema/transport investments.

## Method catalog

- `chat(request: ChatRequest) -> ChatResponse`
- `chatStream(request: ChatRequest) -> Async stream of ChatStreamEvent`
- `embed(request: EmbedRequest) -> EmbedResponse`
- `listModels(request?: ModelsRequest) -> ModelsResponse`
- `getHealth(request: HealthRequest) -> HealthResponse`

All payloads share the envelope (`requestId`, `timestamp`, `callerTool`) defined
in `api/schemas/v1/`.

`ModelsRequest` accepts an optional `provider` hint; when omitted, the service
uses the default provider in configuration. `ModelsResponse` returns the chosen
`provider` plus `models: Array<{ id: string; ready: boolean; description?: string }>`.

## Phase 3 capability-routing interface updates

- **listModels enhancements**: Responses now include optional capability
  descriptors and default selections per capability:

  ```json
  {
    "provider": "lmstudio_gpu",
    "models": [
      {
        "id": "deepseek-coder-33b",
        "ready": true,
        "description": "GPU-tuned coder",
        "defaults": ["chat", "chatStream"],
        "scores": { "coding": 95, "analysis": 85 }
      }
    ]
  }
  ```

  - `defaults` lists the capabilities this model services by default.
  - `scores` echoes the capability matrix (0-100) so tools can anticipate routing
  behavior; omitted when unknown.

- **Routing disclosure**: `chat`, `chatStream`, and `embed` responses append
  `providerInfo: { name, model, routing: { capability, strategy: "capability-default" | "caller-override" | "fallback" } }`.
- **Health reporting**: `getHealth` exposes `capabilityCoverage` per provider
  (e.g., `{ capability: "embed", status: "ready" }`) enabling clients to detect
  partial degradations.
- **Backwards compatibility**: Existing clients remain compatible because new
  fields are additive. When routing metadata is absent, consumers assume legacy
  single-model behavior.

## Response metadata

- `chat` replies include `providerInfo`, normalized `usage`, and the upstream
  `traceId`. When providers request backoff the transport surfaces the
  hint in both the JSON payload (`retryAfterMs`) and an HTTP `Retry-After`
  header that is clamped to 60 seconds. `providerInfo.routing` describes whether
  the capability default or a caller override was used.

- `chatStream` events are sanitized (control characters stripped, payloads
  truncated to 4,000 chars) before being delivered. On error, the final SSE
  chunk carries `{ error, message, retryAfterMs }` aligned with the taxonomy.

- `embed` responses return `{ vectors, usage, providerInfo, traceId }` plus an
  optional `retryAfterMs` field that mirrors the same clamp rules.

- Optional per-client rate limiting returns HTTP 429 with a normalized message
  and `Retry-After` guidance when callers exceed configured thresholds.
- `listModels` returns the provider key plus enriched model descriptors that may
  include `defaults` and `scores` when capability routing is configured. When
  providers do not expose discovery, the method responds with HTTP 500 and a
  sanitized error message.
- `getHealth` aggregates component statuses (`ok`, `degraded`, `failed`) and
  includes per-provider `details` when checks surface errors.

## Transport status & retry semantics

- Successful calls return HTTP 200 with normalized payloads.
- Transport rejects unauthenticated or unauthorized access with 401/403.
- Schema validation errors surface as HTTP 400 with `BAD_REQUEST` codes.
- When upstream providers fail, the transport maps error classifications to
  HTTP status codes and sanitizes messages:

  | Classification | HTTP status | Notes |
  | --- | --- | --- |
  | `RATE_LIMIT` | 429 | `Retry-After` header + payload field (clamped ≤ 60,000 ms) |
  | `TEMPORARY` | 503 | Client may retry after the hinted backoff |
  | `PERMANENT` | 422 | Contract violation; do not retry |
  | `AUTH` | 502 | Upstream credential issue |
  | `CONFIG` | 500 | Misconfiguration detected at dispatch |

- Health responses report `status: failed` when any provider health probe fails
  outright, `degraded` when probes succeed but return warnings (for example,
  LMStudio discovery responding 5xx), and `ok` when all components pass.

- All error payloads include the original `traceId` when available so tooling
  can correlate telemetry with provider logs.

## Error taxonomy

- `TEMPORARY`: Transient provider or network failures eligible for retry.
- `PERMANENT`: Validation or unsupported capability errors; no retry.
- `AUTH`: Provider authentication/authorization issues.
- `CONFIG`: Misconfiguration detected at dispatch time.
- `RATE_LIMIT`: Upstream throttle responses.

## Dependencies and contracts

- **Schema definitions**: `modules/llm_caller/api/schemas/v1/*.json`
- **Client registry**: `config/client-registry.json`
- **Provider catalog**: `config/providers.json`
- **Secrets provider**: Environment variables via `loadConfig` and future
  abstraction.

## Approval checklist

- [X] Architecture lead review
- [X] QA agent confirmation (contract completeness)
- [X] Assessor agent alignment sign-off
- [X] Human stakeholder approval

Update `.claude/decisions/interface-decisions.md` once approvals are secured.
