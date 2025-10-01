# LLM Caller Logging Design

<!-- cSpell:ignore Runbook runbook -->

## Purpose

Outline the improvements required to evolve the logging capability so it meets
the observability expectations defined in
`project_docs/architecture/LLM_Caller_Architecture.md` and the safeguards noted
in `project_docs/architecture/security-recommendations-phase1.md`. The design
captures scope, configuration surface, testing approach, and governance
checkpoints needed before implementation begins.

## Objectives

- Enforce a structured log payload that always includes `timestamp`, `level`,
  `message`, `requestId`, `traceId`, and sanitized metadata.
- Provide configurable log levels and sink controls (console-only vs.
  console + file).
- Support basic file retention through rotation by size with bounded history to
  avoid unbounded growth on pilot machines.
- Introduce a redaction layer so sensitive fields (prompt content, raw provider
  messages) cannot be written unless an explicit debug flag is enabled.
- Document operational workflows (setup, rotation tuning, redaction overrides)
  in the module README and runbook.

## Requirements & constraints

- **Governance**: Changes must stay within the approved Phase 3 scope and retain
  MCP-only exposure. Approvals are tracked via `.claude/decisions/scope-decisions.md`
  (entry dated 2025-09-24).
- **Security**: Align with recommendations that provider messages and transcripts
  are sanitized before persistence (`security-recommendations-phase1.md`).
- **Performance**: Logging must remain non-blocking for transport requests;
  synchronous disk writes should stay bounded.
- **Environment**: No external log shippers or network sinks are permitted in
  this phase; loopback and local filesystem only.

## Proposed architecture updates

1. **Log schema enforcement**
   - Define an internal `StructuredLogRecord` interface with required keys and a
     metadata map that is normalized before emission.
   - Add a normalization step inside `createLogger` that injects defaults
     (timestamp, level) and removes disallowed metadata keys.
2. **Level filtering**
   - Introduce `LLM_CALLER_LOG_LEVEL` (default `info`).
   - Map to ordered levels (`error` < `warn` < `info` < `debug`); records below
     the threshold bypass all sinks.
3. **Sink management**
   - Retain console logging by default.
   - Expand the file sink to support size-based rotation via:
     - `LLM_CALLER_LOG_FILE` (path)
     - `LLM_CALLER_LOG_MAX_BYTES` (default 5 MiB)
     - `LLM_CALLER_LOG_MAX_FILES` (default 100, rotated files suffixed with
       `.1`, `.2`, etc.)
   - Implement rotation locally without external dependencies.
4. **Redaction guardrail**
   - Inspect metadata keys for sensitive patterns (prompt, payload, body, raw
     content) and replace them with `[redacted]` unless
     `LLM_CALLER_LOG_DEBUG_PAYLOADS=true`.
   - Emit a warning when redaction occurs so operators know sensitive data was
     prevented from being written.
5. **Structured helpers**
   - Provide helper functions (`logRequestSuccess`, `logRequestFailure`) to
     standardize metadata assembly and reduce the risk of bypassing redaction.

## Configuration & documentation updates

- Add new env vars to `.env.example`, the README, and runbook with usage
  guidance.
- Document rotation behavior and redaction policy in
  `modules/llm_caller/README.md` and
  `README/LLM_Caller_Runbook.md`.
- Update the roadmap (Phase 3) and backlog tickets for future centralized
  logging integrations.

## Testing strategy

- Extend Jest coverage to include:
  - Level filtering behavior (records below threshold skipped).
  - Rotation triggering once file size exceeds the configured limit.
  - Redaction of disallowed metadata keys with the associated warning log.
  - Debug flag bypass that allows sensitive payloads while suppressing the
    warning.
  - Graceful handling when rotation fails (for example, permission issues).
- Ensure tests clean up temporary files and do not assume real filesystem
  rotation beyond local temp directories.

## Approval checklist

- [x] Stakeholder review of objectives and scope. *(SG 2025-09-24)*
- [x] Assessor agent confirmation (alignment with governance, no scope creep).
- [x] QA agent confirmation (test plan and quality gates sufficient).
- [x] Documentation owner acknowledgment of required updates. *(SG 2025-09-24)*

## Open questions

- Do we need to expose JSON log schema to pilot teams (for example, a contract in
  `api/schemas`)?
  - SG: No
- Should rotation be configurable per sink (`console` vs. `file`), or is
  file-only sufficient for this phase?
  - SG: File only
- Are additional metrics needed to track redaction counts for auditing?
  - SG: No

## Next steps

1. Circulate this design for documentation owner approval.
2. Execute the TDD cycle: write failing tests for level filtering, redaction,
   and rotation.
3. Implement logger enhancements and update documentation.
4. Capture results in `.claude/sessions/current-work.md`, the roadmap, and QA
   reports.
