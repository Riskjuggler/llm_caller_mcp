# LLM caller architecture

<!-- cSpell:ignore lmstudio deepseek nomic STDIO SSE -->

## Overview

The LLM Caller module delivers a unified inference surface for all tools, acting
as the single MCP endpoint that brokers requests to external providers and
local LMStudio instances. The foundation phase targets chat and embedding
capabilities with deterministic reliability, loopback-only exposure, and the
contract discipline required by the project definition.

## Scope

This design covers the minimum viable platform needed to satisfy the approved
project definition. It includes the MCP contract, core service components,
provider adapter responsibilities, observability hooks, security controls for
loopback-only operation, and a basic client authentication mechanism suitable
for local development. Integrations that rely on external infrastructure (OAuth
issuers, certificate authorities, managed secret stores) are deferred to a later
phase.

## Component model

- **MCP transport**: Handles JSON-RPC style requests, binds exclusively to
  `127.0.0.1`, and consults a locally managed client registry to validate the
  caller.
- **Request normalizer**: Validates payloads against schemas, enforces required
  fields, and expands defaults (temperature, max tokens, provider hints).
- **Provider orchestrator**: Chooses the adapter (OpenAI, Anthropic, LMStudio)
  based on explicit provider selection or default preferences and manages retry
  policies.
- **Adapter host**: Runs provider adapters with shared logging, timeout, and
  tracing utilities.
- **Response composer**: Normalizes adapter responses, attaches metadata, and
  emits structured errors when all retries fail.
- **Telemetry pipeline**: Captures request metrics, latency samples, and
  structured logs for later export to Prometheus or another collector.
- **Secrets provider**: Abstracts credential retrieval. MVP implementation reads
  from environment variables; plugging in external secret stores is future work.

## MCP interface contract

All methods share a common envelope with `requestId`, `timestamp`, and
`callerTool`. Payload schemas are versioned under `v1`.

- `chat`: Accepts `messages[]`, optional `systemPrompt`, `model`, `provider`,
  `temperature`, and `maxTokens`. Returns `message`, `usage`, `providerInfo`, and
  `traceId`.
- `chatStream`: Same request contract; returns an event stream of `delta`
  chunks, ending with a `completion` summary that includes `traceId`.
- `embed`: Accepts `inputs[]`, `model`, and optional `dimensions`. Returns
  `vectors[]`, `usage`, `providerInfo`, and `traceId`.
- `getHealth`: Uses the same local client registry. Returns component status
  list, including provider reachability, adapter health, and last heartbeat time.

Schema definitions live in `api/schemas/v1/*.json` (to be created) and are
mirrored in the module README per documentation standards.

## Provider adapter responsibilities

Each adapter implements `chat`, `chatStream`, `embed`, and `getHealth`, taking a
normalized request and returning a normalized response. Adapters handle
provider-specific authentication, request shaping, and error translation. They
must emit the standard error taxonomy (`TEMPORARY`, `PERMANENT`, `AUTH`,
`CONFIG`, `RATE_LIMIT`) so the orchestrator can apply retries or fail fast. The
LMStudio adapter assumes the local server at `http://localhost:1234` and uses
OpenAI-compatible routes.

Adapters receive credentials through the secrets provider interface and must not
access environment variables directly. Error payloads are sanitized to avoid
leaking provider stack traces or sensitive identifiers.

## Phase 3 capability-routing extension

### Objectives

- Support multiple LMStudio deployments in a single configuration (for example,
  CPU-tuned and GPU-tuned instances) while keeping remote providers (OpenAI,
  Anthropic) available as fallbacks.
- Allow each provider entry to declare capability-specific default models for
  `chat`, `chatStream`, and `embed` so requests can route to the most suitable
  model without explicit caller overrides.
- Introduce a capability scoring table (seeded from
  `project_docs/planning/Model_Capability_Routing_System.md`) that informs
  provider/model selection based on task intent and request metadata.
- Preserve existing MCP contracts while exposing the chosen provider/model via
  `providerInfo` and the `/mcp/models` discovery endpoint.

### Configuration schema changes

Provider configs will expand from a single `defaultModel` to a structured
section:

```json
{
  "providers": {
    "lmstudio_gpu": {
      "baseUrl": "http://localhost:1235/v1",
      "capabilities": ["chat", "chatStream", "embed"],
      "defaults": {
        "chat": "deepseek-coder-33b",
        "chatStream": "deepseek-coder-33b",
        "embed": "nomic-embed-text"
      },
      "scores": {
        "coding": 95,
        "analysis": 85,
        "general": 70,
        "embeddings": 40
      },
      "notes": "GPU-backed LMStudio instance"
    }
  }
}
```

- `defaults` maps each supported capability to a preferred model. Missing keys
  fall back to a provider-wide `defaultModel` for backward compatibility.
- `scores` is optional metadata used by the orchestrator when multiple providers
  advertise the same capability; values align with the capability matrix in the
  routing system design doc.
- Configuration validation ensures at least one provider exposes each core
  capability required for the MVP (chat, chatStream, embed).

### Orchestrator selection flow

1. Normalize the request (existing behavior) and derive the requested
   capability: chat, chatStream, or embed.
2. If the caller supplied `provider`/`model`, honor those overrides exactly as in
   Phase 1/2.
3. Otherwise, evaluate candidate providers that advertise the requested
   capability. Rank them using the `scores` metadata and fallback to declared
   precedence (configuration order) when scores tie or are absent.
4. Choose the provider-specific default model from `defaults[capability]` or
   `defaultModel` when no capability-specific entry exists.
5. Record the chosen provider/model in telemetry and `providerInfo`. Emit a
   routing decision log entry (debug level) that captures inputs, ranking, and
   final selection for audit purposes.
6. Surface the routing metadata through `/mcp/models` so operators can confirm
   availability and defaults at runtime.

### Adapter responsibilities

- LMStudio adapter must surface `listModels` with readiness info for each local
  deployment (e.g., GPU vs CPU). The orchestrator combines this with capability
  metadata to detect stale or unavailable models.
- Remote adapters (OpenAI, Anthropic) continue to supply static metadata; when
  they lack capability scores, the orchestrator marks them as fallback options
  that are only selected if LMStudio instances are unavailable.
- Health checks include capability coverage assertions (capability declared in
  config but missing from `/models` results triggers degraded status).

### Observability and testing

- Add routing-specific metrics (`llm_caller_routing_decisions_total`) labeled by
  capability, provider, and model to monitor selection frequency.
- Extend Jest suites to cover routing decisions: mock capability scores,
  multiple providers, and verify fallback ordering plus manual overrides.
- Add integration/UAT cases that run chat/chatStream/embed flows against a
  multi-provider configuration ensuring each capability reaches the expected
  model.
- Log routing decisions at debug level with sanitized inputs (capability
  request, candidate providers, final choice) to aid troubleshooting without
  exposing prompts.

### Scope guardrails

- Routing logic is limited to capability-based selection; cost optimization and
  dynamic performance telemetry remain out of scope for this phase.
- Configuration changes require updated examples and migration notes in
  `modules/llm_caller/config/providers*.json` and the README before release.
- Any expansion beyond MCP interface (e.g., CLI bridging) still requires a
  separate governance approval cycle.

## Control flow

1. MCP transport accepts a request over loopback, verifies the caller against
   the local registry, and checks the method allow-list.
2. Request normalizer validates the payload against the schema repository.
3. Provider orchestrator selects an adapter, applies timeout configuration, and
   dispatches the normalized request.
4. Adapter invokes the upstream provider, mapping errors into the shared
   taxonomy and returning normalized data.
5. Response composer merges usage metrics, attaches provider metadata and
   `traceId`, runs redaction hooks on log-safe fields, and emits structured logs.
   On failures it retries per policy, then returns a terminal error with trace
   identifiers.
6. Telemetry pipeline records request duration, result classification, and
   payload size and forwards the data to local sinks.

## Reliability and security

- Service binds to `127.0.0.1` only, enforced by configuration defaults and
  startup assertions.
- Caller validation relies on a local registry (config file or environment
  mapping). Full OAuth or mTLS integration is deferred.
- Retries follow exponential backoff with a maximum of two attempts for
  transient errors.
- Health checks poll each adapter and expose the results through `getHealth`,
  which shares the same validation path as functional calls.
- Credentials load via the secrets provider abstraction with environment
  variables as the MVP implementation.
- Access logs include caller identity, provider outcome, and trace identifiers
  without storing raw prompt content or secrets.
- Redaction hooks scrub sensitive fields before logs or metrics are persisted.

### Security review – streamable HTTP MCP risk (2025-09-29)

The recently surfaced advisory highlights systemic weaknesses in
streamable-HTTP MCP deployments that automatically trust remote manifests and
runtime commands. Our implementation currently:

- Serves the MCP contract over HTTP/SSE using Fastify (`transport.ts`), bound to
  loopback only (`127.0.0.1`).
- Requires an authenticated caller token plus per-tool method allow-lists before
  accepting requests.
- Performs JSON Schema validation on every payload via `validation.ts`.
- Reads configuration exclusively from local files (`config/client-registry.json`
  and `config/providers.json`) that are provisioned by operators, not remote URLs.

These controls reduce the remote-injection vector described in the advisory;
however, remaining gaps keep us short of the hardened STDIO pattern:

- There is no mutual attestation or signature verification between caller and
  transport beyond bearer-style tokens stored in local configuration.
- Any process with local access (including a compromised developer tool) could
  reuse the token to stream arbitrary requests over HTTP.
- The transport lacks runtime gating for dynamic MCP manifest installation; the
  architecture implicitly trusts clients not to mutate configuration at runtime.

#### Mitigation plan

1. **Introduce optional STDIO transport**: add a sibling process entry point
   that exposes the MCP contract via STDIO pipes with explicit handshake keys
   and schema negotiation. This mode becomes the recommended deployment path
   for high-trust environments, while HTTP remains available for development.
2. **Token attestation upgrades**: extend the existing token registry to include
   per-tool signing keys (for STDIO) and short-lived session nonces that are
   validated on connect, preventing blind replay of static tokens.
3. **Manifest/source control**: require configuration manifests to be packaged
   with a signed checksum that the transport verifies at startup; reject runtime
   attempts to fetch manifests over HTTP.
4. **Client confirmation hooks**: add optional confirmation prompts for
   high-privilege actions (e.g., enabling new providers) so downstream tools
   cannot silently change routing behavior.

Action items 1–3 will be captured in the Phase 3 security backlog and tracked in
`.claude/decisions/architecture-decisions.md` once design work begins. Until
then, operators must continue running the service on loopback with tightly
controlled client tokens and local configuration management.

## Observability

- Structured logs emit `requestId`, `callerTool`, `provider`, latency,
  token usage, error classification, and `traceId`. Planned upgrades for
  rotation and redaction controls are detailed in
  `project_docs/architecture/LLM_Caller_Logging_Design.md`.
- Metrics counters track total requests by outcome, aggregate retry counts, and
  provider mix. Average latency per method is derived from cumulative totals to
  highlight regressions without a full histogram implementation yet.
- Trace hooks forward span metadata to downstream collection (left as a stub in
  MVP but instrumented in code for later Prometheus/Grafana integration).
- Debug mode captures sanitized payload snippets locally to aid TDD scenarios
  while honoring redaction rules.

## Deferred security enhancements

The following improvements require external dependencies and are scheduled for a
future phase:

- Integration with an OAuth issuer or mTLS certificate authority for token or
  certificate-based authentication.
- Secrets provider plugins for Vault, AWS Secrets Manager, or similar services.
- Automated linkage to centralized observability stacks (metrics, logs, traces).

## Deployment considerations

Configuration files specify the listening address, enabled providers, retry
policies, credential sources, and default models. The codebase ships with a
sample `.env.example` showing loopback binding and the local client registry
configuration. Startup checks fail fast if the service is not bound to loopback
or if mandatory credentials are missing. TDD harnesses mock adapters, the
secrets provider, and the client registry to assert contract compliance and
telemetry emission.
