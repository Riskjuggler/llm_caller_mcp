# LLM Caller Runbook (Phase 3)

<!-- cSpell:ignore Runbook runbook lmstudio Workstream -->

## Overview

This runbook describes how to start, monitor, and troubleshoot the local MCP LLM
Caller service. It targets Phase 3 pilot integrations and will expand as we move
toward broader deployment.

## Prerequisites

- Node.js (v18 or later; Phase 2 tests executed with v23.10.0)
- LMStudio or other configured providers running locally if required
- `config/client-registry.json` and `config/providers.json` populated with pilot
  tokens/providers (examples live in `config/*.example.json`)

## Environment configuration

1. Copy `.env.example` to `.env` in `modules/llm_caller/`:

   ```bash
   cp modules/llm_caller/.env.example modules/llm_caller/.env
   ```

2. Adjust values for host/port, retry attempts, and rate limit window as needed.
3. Export any provider credentials (for example, `OPENAI_API_KEY`) or add them
   to the `.env` file. **Do not commit `.env`.**
4. Populate `config/providers.json` with the desired provider entries. Each
  entry can now declare capability-specific defaults and scores to guide
  routing. The example file shows dual LMStudio profiles (`lmstudio_gpu`,
  `lmstudio_cpu`) alongside OpenAI/Anthropic defaults.

### LMStudio provider checklist

- Ensure each LMStudio instance you plan to route to is running with the
  OpenAI-compatible API enabled (for example, GPU on port `1234`, CPU on `1235`).
- Confirm `config/providers.json` contains corresponding entries (`lmstudio_gpu`,
  `lmstudio_cpu`, etc.) with `capabilities` including `chat`, `chatStream`, and
  `embed` where applicable.
- Set the `defaults` map so chat/chatStream/embed requests prefer the intended
  model per instance. Use `scores` to bias selection when multiple providers
  support the same capability.
- If LMStudio requires authentication, wire the necessary settings via `.env`
  and update the adapter once secrets support is extended.
- Add client tokens that need discovery access to `config/client-registry.json`
  with the `models` method permission.

## Starting the service

Use the UAT helper script:

```bash
./uat/start_server.sh
```

This script installs dependencies (if missing), runs `npm run build` inside the
module, and starts the server with source maps enabled. Logs stream to stdout.
Stop the service with `Ctrl+C` in the terminal running the script.

## Verifying endpoints

Run the bundled UAT script:

```bash
./uat/run_uat.py
```

The script exercises:

- `/mcp/chat`
- `/mcp/chatStream` (SSE)
- `/mcp/embed` (skipped if the provider lacks `embed` capability)
- `/mcp/models` (provider discovery)
- `/health` (component status aggregation)
- Rate-limit demonstration (optional)

Successful responses confirm runtime configuration. Any 403 errors usually mean
missing or mismatched client tokens; 500 errors often indicate missing provider
credentials or upstream issues.

When verifying `/mcp/chat` or `/mcp/embed`, confirm the response
`providerInfo.routing` metadata reflects the expected capability and strategy
(`capability-default`, `caller-override`, or `fallback`). `/mcp/models` should
list capability defaults and `/health` should include `capabilityCoverage` for
each provider entry.

### Configuration CLI backup hygiene

The configuration CLI (`npm run config`) keeps timestamped safety copies beside
the active files (for example, `providers.json.1759267718346.bak` and
`providers.json.bkup`). To avoid clutter and ensure operators can still roll
back recent edits:

- Retain the two most recent `.bak` files for each config; delete older copies
  once the changes have been validated.
- After a successful deployment, archive any `.bkup` snapshot to the
  environment’s secure backup location or remove it if Git history already
  captures the relevant state.
- Record cleanup in the session log or change ticket so auditors can confirm
  backup hygiene.
- If the CLI reports a failed save, leave the generated backup in place, fix
  the underlying issue, then re-run the CLI so a fresh backup is produced before
  removing older files.

## Monitoring & telemetry

- Each request prints a structured log line (`info`/`warn`/`error`) including
  `requestId`, `provider`, and rate-limit metadata.
- Sanitization/truncation events produce warn-level entries.
- Rate limiting warnings include a hashed token (`tokenHash`) for anomaly
  review.
- Configure persistent logging via `.env`:
  - `LLM_CALLER_LOG_FILE` writes JSON logs to disk in addition to stdout.
  - `LLM_CALLER_LOG_MAX_BYTES`/`LLM_CALLER_LOG_MAX_FILES` manage rotation (default
    5 MiB, 5 files).
  - `LLM_CALLER_LOG_LEVEL` filters noise; set to `warn` for quieter pilot runs.
  - Sensitive metadata (prompts, raw payloads) is redacted automatically with a
    console warning listing the stripped keys. Enable
    `LLM_CALLER_LOG_DEBUG_PAYLOADS=true` only in ephemeral, local debugging
    sessions.

### Metrics snapshot (optional)

When running integration tests or diagnostics, inspect in-memory metrics:

```ts
import { getMetricsSnapshot } from '../modules/llm_caller/src/metrics.js';
console.log(getMetricsSnapshot());
```

The snapshot now includes a `retries` object (total/average) and per-method
`classifications` map so operators can spot churn and pinpoint error taxonomy
trends without enabling verbose logs.

## Troubleshooting

- **403 Unknown client token**: Update `config/client-registry.json` with the
  token.
- **500 Chat dispatch failed**: Provider credentials are missing or the
  upstream provider returned an error.
- **SSE stream stops immediately**: Rate limit reached (look for `Rate limit
  exceeded` warnings in logs).
- **Binary data warnings in logs**: Provider sent non-text chunks that
  sanitization dropped.
- **Health endpoint reports `degraded`**: Provider discovery succeeded but
  returned warnings (for example, LMStudio responded 5xx); review LMStudio logs
  or restart the local server.
- **Health endpoint reports `failed`**: Provider health probe threw an error.
  Check network reachability and ensure the provider entry is configured
  correctly.

For persistent issues, capture the console logs and raise them with the team.

## Next steps

- Expand this runbook with operations contacts, alert thresholds, and rollback
  procedures once we move beyond pilot usage.
- Prepare integration checklists for each pilot tool and capture outcomes in
  `project_docs/memory/` during Phase 3.

### Flush-delay mitigation

- If logger tests exhibit timing flakes, temporarily increase the wait time inside the affected test (for example, bump the delay helper from 10ms to 50ms) and log the change; revert once the root cause is addressed.

### Log monitoring

- Monitor log files under the configured directory (`LLM_CALLER_LOG_FILE`).
- Default rotation retains up to 100 files (~5 MiB each) unless overridden. For pilots, lower `LLM_CALLER_LOG_MAX_FILES` to 3 and `LLM_CALLER_LOG_MAX_BYTES` to ~1 MiB to keep disk usage in check.
- During pilots, alert if the base log exceeds 5 MiB or rotation count reaches the configured ceiling; escalate via QA/assessor channels.

### Remediation playbook (Workstream C3)

- **Stream chunking**: If SSE payloads exceed 4k limit, capture metrics and raise a backlog ticket to introduce a configurable chunk size; document findings in `project_docs/memory/`.
- **Secrets rotation**: When rotating credentials, update `.env` with the new keys, restart the service, and record the change in `project_docs/memory/`.
- **Telemetry exports**: When external sinks are approved, create a backlog item to add an export toggle and capture requirements from operations before implementing.
- **OAuth integration**: If a pilot requires OAuth, capture requirements in the backlog and coordinate with security to define token acquisition steps before changes land.
