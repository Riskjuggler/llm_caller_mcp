# Pilot Integration Checklist

<!-- cSpell:ignore runbook Priya -->

Use this checklist when onboarding a pilot tool to the LLM Caller MCP server.
Update the table with contact names, dates, and outcomes for each pilot.

*Status (2025-09-27): Pilot engagements have not begun; all checklist items
remain open until tool partners are confirmed.*

| Pilot tool            | Owner           | Kickoff date | Status      | Notes |
|----------------------|-----------------|--------------|-------------|-------|
| Coding Assistant      | Platform Team   | 2025-10-07   | Scheduled   | Awaiting pilot test cases |
| Research Summarizer   | QA Liaison      | 2025-10-15   | Planned     | Coordinate with ops for telemetry capture |
| TBD                   |                 |              |             |       |

## Pre-flight steps

- [ ] Confirm `.env` configuration (host, port, retry, rate limits).
- [ ] Verify provider credentials and `config/providers.json` entries (including
      capability `defaults`/`scores` for routed capabilities).
- [ ] Ensure client token/tool ID added to `config/client-registry.json`.
- [ ] Run `./uat/start_server.sh` and `./uat/run_uat.py` locally to validate
      setup (verify chat, streaming, embed, models, and health endpoints).

## Integration rehearsal

- [ ] Schedule session with pilot team; capture goals and test cases.
- [ ] Share UAT instructions/runbook and ensure access to logs.
- [ ] Exercise `/mcp/chat`, `/mcp/chatStream`, `/mcp/embed`, and `/mcp/models`
      workflows end-to-end.
- [ ] Confirm `/health` surface reports expected component status.
- [ ] Collect latency/usage metrics and note any anomalies.
- [ ] Confirm rate limit behavior matches pilot expectations.

## Post-session wrap-up

- [ ] Log findings in `project_docs/memory/` (include log excerpts if needed).
- [ ] Create backlog tickets for follow-up actions (bugs, enhancements).
- [ ] Obtain pilot sign-off (< 1 hour onboarding target) and update roadmap.

## Contacts

Add contact details for each pilot engagement as they are confirmed.

| Pilot tool            | Technical contact | Product/PO      | Slack/Email                |
|----------------------|-------------------|-----------------|----------------------------|
| Coding Assistant      | [dev@example.com](mailto:dev@example.com)   | Jamie (Product) | #pilot-coding-assistant     |
| Research Summarizer   | [qa@example.com](mailto:qa@example.com)    | Priya (Research)| #pilot-research-summarizer |
