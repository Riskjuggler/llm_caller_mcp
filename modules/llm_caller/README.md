# LLM caller module

<!-- cSpell:ignore Runbook runbook lmstudio deepseek nomic -->

## Purpose

Implements the loopback-only MCP interface described in
`../project_docs/architecture/LLM_Caller_Architecture.md`. Phase 1 delivered the
transport, normalization, and adapter scaffolding. Phase 2 adds telemetry hooks,
guarded streaming, and richer failure handling so the module can move toward
hardening goals.

## References

- Architecture: `../project_docs/architecture/LLM_Caller_Architecture.md`
- Project definition: `../project_docs/archive/LLM_Caller_Project_Definition.md`
- Roadmap: `../project_docs/planning/LLM_Caller_Implementation_Roadmap.md`
- External dependencies (future): `../project_docs/architecture/external_dependencies.md`

## Standalone integration

When transplanting this module into another project:

1. Copy the entire `modules/llm_caller/` directory, including `api/schemas/v1/`
   and `config/` samples.
2. Bring the documentation bundle stored at `../README/` (Developer Guide,
   Runbook, Pilot Integration Checklist) so downstream operators retain the
   published guidance.
3. Recreate or map the root-level npm scripts (`npm test`, `npm run build`,
   `npm run config`) so they proxy to the module commands.
4. Update `.env.example` and config values to match the new environment but keep
   the schema structure so the CLI and validators continue to work.
5. Re-run `npm install` inside `modules/llm_caller` to restore local package
   dependencies.

## Directory layout

```text
modules/llm_caller/
  api/schemas/v1/        # JSON schema contracts for MCP payloads
  config/                # Local client registry and provider templates
  src/                   # Transport, orchestration, provider adapters (stubs)
  tests/                 # Jest-based TDD harness
  README.md              # Module guidance
  package.json           # Node/TypeScript project definition
  tsconfig.json          # TypeScript compiler settings
```

## First-time setup

1. Install dependencies:

   ```bash
   cd modules/llm_caller
   npm install
   ```

2. Copy sample configs:

   ```bash
   cp config/client-registry.example.json config/client-registry.json
   cp config/providers.example.json config/providers.json
   cp .env.example .env
   ```

3. Run tests:

   ```bash
   npm test
   ```

## Local MCP assumptions

- Service binds to `127.0.0.1:4037` (override via `.env`).
- Callers present tokens listed in `config/client-registry.json`.
- Provider credentials load through environment variables accessed by the
  secrets provider abstraction.
- Clients that need model discovery must include the `models` method in
  `allowedMethods`; `getHealth` permission gates the `/health` endpoint.

## Capability routing configuration

- Each provider entry in `config/providers.json` can now declare per-capability
  defaults via a `defaults` object and optional `scores` to influence routing.

  ```json
  "lmstudio_gpu": {
    "baseUrl": "http://localhost:1234/v1",
    "defaultModel": "deepseek-coder-33b",
    "capabilities": ["chat", "chatStream", "embed"],
    "defaults": {
      "chat": "deepseek-coder-33b",
      "chatStream": "deepseek-coder-33b",
      "embed": "nomic-embed-text"
    },
    "scores": {
      "chat": 95,
      "chatStream": 95,
      "embed": 65
    }
  }
  ```

  - `defaults` controls which model the orchestrator selects when a caller does
    not supply `provider`/`model`.
  - `scores` bias provider selection when multiple entries advertise the same
    capability. Higher scores win; ties fall back to configuration order.
  - Omit entries to fall back to `defaultModel` with a `fallback` routing
    strategy.
- Responses now surface routing metadata via `providerInfo.routing`, enabling
  clients and operators to audit the chosen capability and strategy.
- `/mcp/models` enriches each model descriptor with `defaults` (capabilities
  served) and the provider `scores`. `/health` includes
  `capabilityCoverage` for each provider.
- Update existing configs to include capability defaults before enabling
  multi-provider routing. Example files in `config/providers.example.json`
  showcase dual LMStudio profiles (GPU/CPU) alongside OpenAI/Anthropic.

## Configuration CLI assistant

- An interactive helper is available to inspect and edit
  `config/providers.json` and `config/client-registry.json` without manual
  editing. The script compiles the module before launching, so the first run may
  take a few seconds.

  ```bash
  # from repository root
  npm run config

  # or inside modules/llm_caller
  npm run config:cli
  ```

- Features:
  - List, add, update, or delete provider entries with JSON Schema validation
    before saving.
  - Auto-discover models from a running LM Studio instance (`/models`) so you
    can pick default chat/chatStream/embed models without copying IDs manually.
  - Guided prompts for OpenAI and Anthropic providers capture base URLs,
    default models, capability lists, and optional scoring metadata.
  - Client registry management (list/add/update/delete) with allowed method
    prompts to keep tokens and permissions tidy.
  - Changes are written atomically with timestamped backups (`*.bak`) in case
    you need to roll back.

- Run the CLI after updating configs to verify schema compliance and perform an
  optional health probe before restarting the MCP service.

## Telemetry & metrics

- Every request records structured metrics (success/error counts, average
  latency) via `modules/llm_caller/src/metrics.ts`. The transport logs a summary
  for each completion, and hashed client-token failure counts are emitted when
  provider errors occur. Metrics snapshots now include retry averages and error
  classification tallies per method to speed triage. For ad-hoc inspection
  inside tests or tooling, call:

  ```ts
  import { getMetricsSnapshot } from './src/metrics.js';
  ```

- Streaming responses are sanitized: control characters are stripped and each
  chunk is truncated to 4,000 characters before being sent to clients.
- Non-text/binary streaming payloads are dropped with a warning to avoid
  leaking unexpected content to clients.
- Retry hints (`Retry-After` header and `retryAfterMs` payload field) are
  clamped to 60 seconds to avoid untrusted backoff guidance.
- Provider health probes aggregate `ok` / `degraded` / `failed` statuses and
  surface details when discovery encounters issues (for example, LMStudio
  returning 5xx).

## Logging

- Structured logs always include `timestamp`, `level`, `message`, and any caller
  supplied `requestId`/`traceId`. Metadata is inspected against
  `project_docs/architecture/LLM_Caller_Logging_Design.md` to redact sensitive
  fields such as prompts or raw provider payloads (replaced with `[redacted]`).
- Console output remains enabled by default. To write to disk, set
  `LLM_CALLER_LOG_FILE` in `.env`; logs rotate when the file exceeds
  `LLM_CALLER_LOG_MAX_BYTES`, keeping up to `LLM_CALLER_LOG_MAX_FILES`
  historical files.
- `LLM_CALLER_LOG_LEVEL` controls severity filtering (`error`, `warn`, `info`,
  `debug`). Entries below the threshold are skipped across all sinks.
- For local debugging only, `LLM_CALLER_LOG_DEBUG_PAYLOADS=true` disables
  redaction. Use with caution and never in shared environments.

## Rate limiting

- Optional per-token throttling is controlled via environment variables:
  - `LLM_CALLER_RATE_LIMIT_MAX`: maximum requests per interval (default 0 to
    disable).
  - `LLM_CALLER_RATE_LIMIT_INTERVAL_MS`: window size in milliseconds.
- When limits are exceeded, the transport returns HTTP 429 with a sanitized
  message and hashed telemetry so operators can investigate abuse while keeping
  tokens obscured.

## Runbook & UAT

- Operational steps for pilots live in
  `../README/LLM_Caller_Runbook.md` (copy this file when transplanting the
  module).
- UAT helpers (`uat/start_server.sh`, `uat/run_uat.py`) install/build the module
  and exercise `/mcp/chat`, `/mcp/chatStream`, `/mcp/embed`, `/mcp/models`, and
  `/health` endpoints.

## Failure injection & testing

- Unit tests cover provider authentication failures, rate limits, missing
  credentials, and transport-level sanitization.
- Transport integration tests assert retry metadata, SSE sanitization, and
  telemetry logging. See `modules/llm_caller/tests/transport.spec.ts` for
  guidance when adding new scenarios.

## Next steps

- Continue Phase 2 hardening tasks from the roadmap (structured metrics exports,
  documentation refresh, rate limiting backlog) before exposing the service to
  additional clients.
- Log ongoing progress and approvals in `.claude/sessions/current-work.md` and
  related tracking files.
