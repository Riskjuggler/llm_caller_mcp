# LLM caller implementation roadmap

<!-- cSpell:ignore Runbook runbook lmstudio deepseek nomic Workstream -->

## Phase 1 – Foundation sprint (Weeks 1-2)

### Phase 1 goals

- Stand up MCP transport bound to `127.0.0.1` with local client registry
  checks. ✔️
- Implement request normalizer, provider orchestrator, and response composer for
  chat, chatStream, embed, and getHealth. ✔️
- Deliver provider adapters for OpenAI, Anthropic, and LMStudio using the
  secrets provider abstraction. ✔️

### Phase 1 key tasks

- [x] Scaffolded module repository with MCP schemas, local registry config, and
  TDD harness (Owner: Core Engineering – completed 2025-09-21).
- [x] Implemented transport layer plus authentication hooks and redaction
  pipeline (Owner: Platform Team – completed 2025-09-21).
- [x] Built provider adapters and orchestrator with retry/error taxonomy logic
  (Owner: Integrations Team – completed 2025-09-21).
- [x] Authored automated tests covering schemas, adapter fakes, retries, and
  telemetry assertions (Owner: QA Enablement – completed 2025-09-21).
- [x] Clamped provider retry hints to a bounded window and logged violations
  (Owner: Platform Team – completed 2025-09-22).
- [x] Added streaming payload guards before emitting SSE events (Owner:
  Platform Team – completed 2025-09-22).
- [x] Hardened secrets handling so missing-key logs avoid exposing environment
  variable names (Owner: Integrations Team – completed 2025-09-22).
- [x] Expanded telemetry/audit trail to flag repeated client-token failures for
  future blocking logic (Owner: QA Enablement – completed 2025-09-22).

> **Status**: Telemetry instrumentation, streaming guards, secrets logging, and
> failure-injection tests completed 2025-09-22. Remaining backlog items (rate
> limiting, provider error normalization) tracked in `project_docs/planning/backlog.md`.

### Phase 1 validation gate

- All automated tests (unit + integration) pass locally. ✔️
- Checklist in `project_docs/archive/LLM_Caller_Project_Definition.md` marked
  complete for foundation scope. ✔️
- Architecture lead signs off after code walk-through and documentation review. ✔️

> **Status**: Completed 2025-09-22. Proceeding to Phase 2 hardening per approvals.

## Phase 2 – Hardening sprint (Weeks 3-4)

### Phase 2 goals

- Expand observability hooks with local exporters and trace stubs.
- Stress-test loopback transport and retry policies under failure scenarios.
- Finalize documentation (README, interface reference, troubleshooting guide).

### Phase 2 key tasks

- [x] Wired structured logs, metrics counters, and trace hooks into the
  telemetry pipeline with local sink adapters (Owner: Platform Team – completed
  2025-09-22).
- [x] Executed failure injection scenarios (provider timeouts, credential
  issues) and codified regression tests (Owner: QA Enablement – completed
  2025-09-22).
- [x] Updated `CLAUDE.md` and module README with integration steps, auth registry
  instructions, and TDD coverage summary (Owner: Developer Experience –
  completed 2025-09-24).

### Phase 2 validation gate

- [x] Failure scenarios captured in automated tests with expected outcomes.
- [x] Documentation lint (`npx markdownlint-cli "**/*.md"`) and spell check
  (`npx cspell "**/*.md"`) pass (recorded 2025-09-24).
- [x] Product owner approved updated docs and release notes (recorded
  2025-09-24).

## Phase 3 – Launch readiness (Weeks 5-6)

### Phase 3 goals

- Prepare deployment artifacts for local environments and internal tooling.
- Conduct end-to-end rehearsals with consuming modules.
- Define backlog for deferred security enhancements and external integrations
  (including STDIO transport option, signed manifest verification, and session
  attestation backlog items).
- Finalize improved logging so telemetry meets architecture objectives
  (structured fields, retention, and redaction guardrails).

> **Status**: Phase 2 complete (telemetry, rate limiting, sanitization). Phase 3
> focuses on packaging, UAT, and operational readiness.

### Phase 3 key tasks

- [ ] Create `.env.example`, launch scripts, and operational runbook for local
  deployment (Owner: DevOps Liaison).
  - [x] `.env.example` authored and committed (2025-09-23).
  - [x] Runbook updated with rate-limit configuration guidance (2025-09-24).
  - [ ] Extend UAT scripts for pilot-specific cases (pending hand-off).
- [x] Deliver logging upgrades to satisfy architecture requirements (Owner:
  Platform Team – completed 2025-09-24).
  - [x] Introduced configurable log levels, rotation, and structured field
    enforcement with request/trace identifiers.
  - [x] Added redaction helpers and unit tests preventing sensitive payload
    persistence.
  - [x] Extended documentation (`README`, runbook) with configuration examples
    for file sinks and retention expectations.
- [ ] Execute capability-based routing for multi-provider LMStudio support
  (Owner: Platform Team, QA Enablement, Operations).
  - [x] Architecture addendum drafted (2025-09-28) – approvals pending.
  - [x] Interface memo updated with routing metadata (2025-09-28) – approvals pending.
  - [ ] Update configuration examples (`config/providers*.json`) with
    capability defaults for chat/chatStream/embed.
  - [ ] Implement orchestrator routing logic and adapter discovery integration
    under TDD (chat/chatStream/embed scenarios).
  - [ ] Expand Jest/UAT suites to cover routing decisions, fallbacks, and manual
    overrides.
  - [ ] Record assessor, QA, and tattle-tale sign-offs plus stakeholder approval
    in `.claude/decisions/log.md` before release.
- [ ] Harden MCP transport against streamable HTTP risks (Owner: Platform
  Security, Platform Team, QA Enablement).
  - [ ] Design and prototype optional STDIO transport with handshake/nonce
    validation, including test harness updates.
  - [ ] Implement manifest/package signing verification during startup and
    document operator workflow.
  - [ ] Extend token registry to support short-lived session attestation and
    audit logging of transport mode selection.
  - [ ] Update QA checklist and automated suites to cover both HTTP and STDIO
    modes, including negative cases for unsigned manifests and invalid
    attestations.
  - [ ] Capture assessor/QA approvals for mitigations and link decision records
    before expanding deployment surface.
- [ ] Partner with two pilot tools to run end-to-end scenarios via the MCP
  surface and capture feedback (Owner: Integration Champions).
  - [ ] Extend `uat/run_uat.py` for pilot-specific cases (scheduled for pilot
    kickoff).
- [ ] Build provider + client configuration CLI assistant (Owner: Developer
  Experience, Platform Team).
  - [ ] Provide interactive menu to list/add/update/remove providers and client
    registry entries using JSON schema validation.
  - [ ] Support LM Studio discovery: fetch `/models` from the configured host to
    pre-populate available model IDs and select defaults/capabilities.
  - [ ] Capture OpenAI/Anthropic credentials, base URLs, capability lists, and
    scoring metadata with secure prompt handling.
  - [ ] Persist updated `config/providers.json` and `config/client-registry.json`
    via atomic writes with backup/rollback support and schema validation.
  - [ ] Emit configuration summaries, run optional health probes, and log
    changes for audit before saving.
- [ ] Log future-phase tickets for OAuth issuers, managed secrets, and
  observability sinks based on
  `project_docs/architecture/external_dependencies.md` (Owner: Product
  Manager).
  - [ ] Update backlog with advanced stream chunking and secrets rotation exit
    criteria.

### Phase 3 validation gate

- [ ] Pilot tools sign off on integration readiness (< 1 hour onboarding target).
- [ ] Operations review the runbook, including rollback steps and monitoring plan.
- [ ] Steering group approves backlog entries for post-MVP security upgrades.
- [ ] MCP transport mitigations (STDIO option, manifest signing, session
  attestation) implemented or scheduled with signed decision record and QA
  checklist updates.
- [ ] Capability routing approvals captured (architecture, interface, roadmap,
  assessor, QA, stakeholder, tattle-tale) before enabling configuration rollout.
- [x] Assessor and QA agents approved the enhanced logging plan and confirmed
  test coverage (2025-09-24).

## Tracking and governance

- Status updates recorded weekly in `project_docs/memory/` with links to test
  runs and decision logs.
- Each phase requires documented approval before moving forward; approvals stored
  alongside the project definition checklist.
- Roadmap adjustments must reference the deferred security items to avoid scope
  creep.
