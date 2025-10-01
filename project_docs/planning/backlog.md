# Backlog

Items deferred from the Phase 1 security review for future planning (e.g., Phase
2+ hardening):

*Status (2025-09-27): All backlog items remain open until scheduled during Phase
3+ planning.*

- Stream buffering strategies (chunking beyond baseline truncation) for large
  SSE payloads.

- Secrets rotation playbooks and pluggable secret providers.
- Enhanced telemetry hooks once centralized observability targets are defined.
- OAuth issuer integration for client authentication.
- Managed secret storage integration (Vault/AWS Secrets Manager).

- Flush-delay mitigation documentation owner: QA agent. Track toggle usage and revert once root cause addressed (Workstream C1).
- Log-size monitoring thresholds owned by Ops liaison; trigger follow-up when base log >5 MiB or rotations exceed ceiling (Workstream C2).
- Stream chunking/secrets rotation/telemetry export/OAuth follow-ups captured in runbook remediation playbook; create backlog tickets with owners when pilots or stakeholders request them (Workstream C3).
- Pilot follow-up tickets: create items for extended UAT coverage, pilot-specific telemetry dashboards, and post-session retros (owners assigned per pilot).
