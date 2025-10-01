# MVP Completion Tasks

<!-- cSpell:ignore Workstream Workstreams deepflawss -->

> Context: Refer back to `project_docs/planning/MVP_Completion_Plan.md` for
> program-level status and dependencies. Each task below expands a remaining MVP
> objective into actionable work with explicit success criteria.

---

## Task 1: Complete LMStudio Discovery & Health Foundations

- **Plan reference**: `project_docs/planning/MVP_Completion_Plan.md:31`;
  detailed scope lives in `project_docs/planning/LMStudio_Integration_Plan.md:24`.
- **Objective**: Deliver LMStudio model discovery endpoint coverage, dedicated
  health probes, and configuration scaffolding so the local provider meets MVP
  reliability targets.
- **Scope & deliverables**:
  - Implement discovery handling in `LMStudioAdapter` plus transport plumbing.
  - Extend `/health` to surface LMStudio-specific component status.
  - Add LMStudio entries to config templates (`config/providers*.json`) with
    `.env` wiring and documentation updates.
- **Status**: Discovery endpoint, health probes, and config templates delivered
  2025-09-28; configuration preference/fallback work remains in LMStudio plan.
- **TDD expectations**:
  - Author failing unit tests for adapter discovery/health logic.
  - Add integration tests exercising `/mcp/embed`/`/mcp/chat` flows under the
    LMStudio configuration, including health checks.
- **Validation**:
  - `npm test`, integration test suite, `npm run build`.
  - QA executes targeted sanity run; assessor reviews contract alignment.
  - Tattle-tale agent confirms QA/assessor evaluations cover new behavior.
- **Done when**: Tests green, docs refreshed, QA & assessor sign-offs recorded
  with tattle-tale confirmation logged in `.claude/agents/*.md`.

---

## Task 2: Phase 3 Launch Readiness & Pilot UAT Enablement

- **Plan reference**: `project_docs/planning/MVP_Completion_Plan.md:31` and
  roadmap items `project_docs/planning/LLM_Caller_Implementation_Roadmap.md:91`.
- **Objective**: Finalize Phase 3 deliverables (pilot-specific scripting,
  backlog ticketing, operational collateral) to unlock launch gate approvals.
- **Scope & deliverables**:
  - Extend `uat/run_uat.py` (or successor tooling) with pilot scenarios.
  - Populate pilot contact table and run pre-flight checklist in
    `README/Pilot_Integration_Checklist.md`.
  - Capture backlog tickets for post-MVP follow-ups referenced in the roadmap.
- **Status**: UAT script updated with models/health checks, pilot checklist populated with upcoming pilots, backlog notes added 2025-09-28. Remaining work: pilot-specific test cases and execution.
- **TDD expectations**:
  - Add failing integration tests/UAT scripts that simulate pilot workflows; CI
    should execute them.
  - Include smoke coverage for operational scripts (start/stop, env validation).
- **Validation**:
  - `npm test` + UAT script run documented.
  - QA signs off on pilot rehearsal evidence; assessor reviews operational
    readiness.
  - Tattle-tale agent evaluates the QA and assessor reports for completeness.
- **Done when**: Pilot checklists updated with target dates, tests and scripts
  pass, approvals and tattle-tale confirmation recorded.

---

## Task 3: Logging Remediation Workstreams B–D

- **Plan reference**: `project_docs/planning/MVP_Completion_Plan.md:31` and
  remediation detail in `project_docs/deepflawss-repair-plan.md:82`.
- **Objective**: Close remaining remediation governance tasks so MVP logging commitments are fully satisfied.
- **Scope & deliverables**:
  - Workstream B/C achieved (tests, guardrails); retain coverage references for regression.
  - Complete Workstream D by recording approvals and ensuring scope decisions reflect updates.
- **TDD expectations**:
  - Confirm existing tests remain in suite; no additional failing tests required unless scope changes.
- **Validation**:
  - `npm test`, `npm run build` to confirm regressions remain green.
  - QA/Assessor reviews documented in `.claude/agents/*.md`; tattle-tale confirms completion.
- **Done when**: Governance entries updated, approvals logged, and remediation plan reflects Workstream D completion.

---

## Task 4: Security Backlog Triage & Scheduling

- **Plan reference**: `project_docs/planning/MVP_Completion_Plan.md:31` and
  backlog summary `project_docs/planning/backlog.md:9`.
- **Objective**: Convert deferred security items into scheduled work with clear
  owners or approved deferrals so MVP sign-off has a documented path forward.
- **Scope & deliverables**:
  - Evaluate stream chunking, secrets rotation, observability exporters, and
    OAuth tasks; assign owners, acceptance criteria, and target phases.
  - Update backlog file with decisions; raise scope/architecture records in
    `.claude/decisions/` where needed.
- **TDD expectations**:
  - For any item pulled into MVP, add failing tests (unit/integration) before
    implementation; otherwise note approved deferral with rationale.
- **Validation**:
  - QA verifies that any immediate security work has tests covering the new
    controls.
  - Assessor confirms deferrals align with governance risk tolerance.
  - Tattle-tale agent reviews QA/assessor documentation for completeness.
- **Done when**: Backlog entries carry explicit status, approvals logged, and
  tattle-tale sign-off recorded alongside QA/assessor reviews.

---

## Task 5: Model Routing Initiative Handoff Plan

- **Plan reference**: `project_docs/planning/MVP_Completion_Plan.md:31` and
  concept doc `project_docs/planning/Model_Capability_Routing_System.md:5`.
- **Objective**: Prepare the model routing workstream for post-MVP execution
  while confirming no hidden blockers remain for current scope.
- **Scope & deliverables**:
  - Document dependencies, data requirements, and integration points for future
    routing work.
  - Validate that current MVP commitments do not rely on routing deliverables.
- **TDD expectations**:
  - If any routing pre-work touches the codebase, introduce failing tests to
    define expected behavior toggles before enabling them.
- **Validation**:
  - QA reviews any preparatory changes; assessor confirms separation from MVP
    scope.
  - Tattle-tale agent ensures QA/assessor assessments acknowledge routing
    deferral.
- **Done when**: Handoff notes added to the routing design doc, approvals logged
  with tattle-tale confirmation, and MVP plan updated if dependencies shift.
