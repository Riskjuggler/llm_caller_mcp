# Security Recommendations – Phase 1 Transport & Orchestrator Updates

## Review scope

- MCP transport changes for `chat`, `chatStream`, and `embed` endpoints in
  `modules/llm_caller/src/transport.ts`.

- Orchestrator retry/metadata propagation
  (`modules/llm_caller/src/orchestrator.ts`).

- Provider adapters and streaming helpers underpinning the new functionality.

## Key observations

1. **Loopback enforcement & client registry** remain intact, but rate limiting
   and per-client throttling are still absent. Streaming endpoints may amplify
   DoS exposure if a client floods requests.

2. **Provider error surfaces** now leak upstream classification text verbatim.
   Messages are currently generic, yet future adapter work could pass through
   provider-specific strings that reveal internal context.

3. **Retry hints via headers and SSE** improve resilience, but there is no cap
   on `retryAfterMs` values. A malicious adapter (or compromised provider) could
   coerce clients into long sleep intervals.

4. **Streaming pipeline** writes JSON events directly. Although current payloads
   are sanitized objects, there is no escaping/validation to prevent control
   characters or excessively large deltas.

5. **Secrets handling** relies entirely on environment variables in-process.
   Errors might leak whether an API key is missing, and no secret rotation hooks
   exist.

6. **Telemetry/logging** currently records generic error messages. Sensitive
   metadata (e.g., request IDs) is fine, but transcript content may enter logs
   when future adapters include message context.

## Recommendations

- **Add per-client rate limiting**: enforce a minimum delay or capped concurrent
  streams per registry entry to mitigate local flooding. *(Implemented
  2025-09-22 – token-based throttling in transport)*

- **Normalize provider error text**: replace upstream messages with
  repository-defined phrases before emitting to clients or logs. *(Implemented
  2025-09-22 – sanitized error messages with raw context logged only in
  metadata)*

- **Clamp retry hints**: bound `retryAfterMs` to a reasonable maximum (e.g.,
  60s) and log when providers exceed it to avoid untrusted back-off guidance.
  *(Implemented 2025-09-22)*

- **Stream payload guards**: validate delta payload size, strip control
  characters, and consider chunking to avoid writing arbitrary binary data to
  event streams. *(Implemented 2025-09-22)*

- **Secrets hardening**: document rotation playbooks and ensure missing-key logs
  do not expose environment variable names. Consider pluggable secret providers
  ahead of external integrations. *(Logs hardened 2025-09-22; rotation/backends
  deferred)*

- **Audit trail**: expand telemetry to flag repeated failures by client token,
  enabling future anomaly detection and blocking logic. *(Implemented 2025-09-22
  via hashed token counters)*

## Next steps

1. Capture these items in Phase 1 quality gates / roadmap docs.
2. Schedule implementation or governance follow-up before exposing endpoints
   beyond local trusted clients.

3. Re-review once adapter implementations evolve beyond stubs to ensure
   consistent sanitization.
