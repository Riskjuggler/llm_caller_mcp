# LLM Caller project definition – capability routing refresh

<!-- cSpell:ignore runbook misselection -->

## Purpose

Reopen the LLM Caller project scope to implement capability-based model routing
so MCP consumers can rely on the service to select the most appropriate LMStudio
model per request type. This update positions the module to support
multi-provider LMStudio configurations (multiple local deployments) and
per-capability model preferences across chat, streaming chat, and embeddings.

*Status: Drafted 2025-09-28 pending human, assessor, and QA approvals.*

## Objectives

- Allow each LMStudio provider entry to define capability-specific default
  models (e.g., `chat`, `chatStream`, `embed`) while preserving global overrides
  via request metadata.
- Enable configuration of multiple LMStudio providers in a single runtime (for
  example, CPU vs. GPU deployments) with deterministic routing rules.
- Extend the orchestrator so it selects a provider/model based on declared
  capability scores, request intent, and call type before falling back to
  existing defaults.
- Keep routing decisions transparent through metrics, logging, and the MCP
  `listModels` interface so operators can audit behavior.

## Success metrics

- Configuration flexibility: operators can declare at least two LMStudio
  providers with unique capability maps and observe deterministic routing in
  integration tests.
- Functional coverage: chat, chatStream, and embed requests route to their
  configured models without regression in existing provider adapters.
- Observability: routing decisions emit structured logs including chosen
  provider/model, scored capabilities, and fallback reason.
- Documentation: updated interface, configuration, and runbook guidance land in
  `project_docs/architecture/` and module README with routing examples.

## In-scope deliverables

- Updated provider configuration schema supporting capability-specific model
  defaults and multiple LMStudio entries.
- Routing engine enhancements inside the orchestrator, leveraging the capability
  catalogue defined in `project_docs/planning/Model_Capability_Routing_System.md`.
- Adapter updates (LMStudio, OpenAI, Anthropic if needed) exposing explicit
  model metadata through `listModels`.
- TDD scenarios covering capability routing decisions, fallback behavior, and
  per-call overrides.
- Observability improvements capturing routing metadata in metrics/logs.

## Out-of-scope items

- Real-time performance tuning or GPU scheduling beyond routing rules.
- Dynamic fine-tuning or on-the-fly model loading/unloading logic.
- Cross-host orchestration or remote LMStudio cluster management.
- Non-MCP interfaces (CLI/API) unless separately approved.

## Assumptions

- LMStudio instances remain OpenAI-compatible and reachable on loopback-hosted
  endpoints per operations guidance.
- Model capability scores are curated manually during this phase; automated
  benchmarking is deferred.
- Consumers may still pin `provider`/`model` explicitly in requests, bypassing
  routing when necessary.
- New configuration schema changes will ship with migration guidance and example
  files.

## Dependencies

- Human approval of updated interface expectations documented in
  `project_docs/architecture/LLM_Caller_Interface.md`.
- Refresh of the architecture design describing routing flow and data sources.
- QA and assessor validation that the Model Capability Routing concept doc
  aligns with the proposed implementation.
- Coordination with operations to capture deployment profiles for multiple
  LMStudio instances.

## Risks and mitigations

- **Configuration complexity**: provide schema validation and detailed examples
  to reduce operator error.
- **Routing misselection**: implement deterministic fallbacks and log anomalies
  for quick diagnosis.
- **Performance variance**: record timing metrics per provider/model to surface
  regressions early.
- **Scope creep**: limit work to routing and observability; defer dynamic
  scaling to a future phase.

## Approval checklist

- [ ] Product owner review of refreshed objectives and scope
- [ ] Architecture lead approval of capability routing design
- [ ] Operations sign-off on multi-provider LMStudio deployment assumptions
- [ ] QA lead confirmation of planned TDD coverage and metrics
- [ ] Documentation owner verification of required updates

## Next steps after approval

1. Update the detailed architecture design to capture capability routing data
   flows, configuration schema changes, and orchestrator logic.
2. Produce the interface selection memo documenting how MCP contracts expose
   routing metadata and overrides.
3. Refresh the implementation roadmap with phased tasks (schema work, adapter
   updates, routing engine, observability, validation) and queue assessor/QA
   checkpoints per `CLAUDE.md`.
