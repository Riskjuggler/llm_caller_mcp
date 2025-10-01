# LLM caller user stories

## Story 1: Tool developer routes chat requests

- **As a** tool developer building a research assistant
- **I want** to invoke the MCP `chat` method with provider hints
- **So that** my tool can reuse the shared LLM orchestration layer
- **Acceptance criteria**:
  - Given a registered client token, when the tool posts a valid chat request,
    then the orchestrator selects the provider and returns a normalized response
    with usage metrics.

  - Errors include machine-readable codes and human-friendly messages.

## Story 2: QA engineer validates embeddings

- **As a** QA engineer
- **I want** automated tests covering the `embed` method
- **So that** I can confirm vector responses conform to the schema before
  release

- **Acceptance criteria**:
  - Tests simulate at least one provider adapter and verify vector lengths,
    usage metadata, and trace identifiers.

  - Invalid payloads trigger schema validation failures captured in the TDD
    harness.

## Story 3: Operations monitor service health

- **As a** platform operations specialist
- **I want** to query `getHealth`
- **So that** I can verify adapters are reachable and retries are within
  thresholds

- **Acceptance criteria**:
  - Health responses list transport, orchestrator, and provider components with
    status and timestamp fields.

  - Failing adapters report classified errors without leaking secrets.

## Story 4: Security analyst audits configuration

- **As a** security analyst
- **I want** configuration files documented and secrets segregated
- **So that** I can audit loopback enforcement and credential handling
- **Acceptance criteria**:
  - Configuration README references `.env` variables and client registry
    structure.

  - No credentials are stored in the repository; documentation notes the
    external secret management process.
