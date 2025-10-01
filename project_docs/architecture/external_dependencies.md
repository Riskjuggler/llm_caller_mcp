# Future external dependencies for LLM caller

The MVP is designed to operate with local configuration only. The integrations
below are deferred until the next maturity phase but are documented now to guide
infrastructure planning.

## OAuth token issuer (Future)

The MCP transport currently relies on a local client registry. A later phase
will introduce per-tool authentication via short-lived tokens. That phase will
require an external issuer capable of minting signed JWTs or providing mutual
TLS certificates and exposing public keys for verification.

### OAuth readiness checklist

- Ability to assign scopes (`chat`, `chatStream`, `embed`, `getHealth`).
- Token lifetime configuration aligned with automation use cases.
- Revocation or rotation mechanism for compromised credentials.

## Secrets management (Future)

Provider adapters presently read credentials from environment variables through
the secrets provider abstraction. When scaling beyond local development, we plan
to plug in Vault, AWS Secrets Manager, or another secret store by implementing
a compatible `SecretsProvider` client.

### Secrets readiness checklist

- Access to provider API keys for OpenAI, Anthropic, and LMStudio.
- Support for credential rotation without service restarts.
- Local development fallback that reads from `.env` while production remains
  secure.

## Observability sinks (Future)

Structured logs, metrics, and traces are emitted locally during the MVP. A
future release will connect them to Prometheus/Grafana or similar stacks to
surface latency, usage, and error trends.

### Observability readiness checklist

- Endpoint for metrics scraping or push gateway configuration.
- Log collector capable of ingesting structured JSON (e.g., Loki, ELK).
- Trace collector (OpenTelemetry endpoint) to accept span data when enabled.

## Certificate and key infrastructure (Future)

If mTLS replaces the local client registry, a certificate authority must issue
client certificates to each tool. The LLM Caller transport will validate client
certs against the trusted bundle loaded at startup.

### Certificate readiness checklist

- CA management process for issuing and revoking tool certificates.
- Distribution mechanism for trusted CA bundle to the LLM Caller.
- Automated renewal workflow to avoid service interruptions.
