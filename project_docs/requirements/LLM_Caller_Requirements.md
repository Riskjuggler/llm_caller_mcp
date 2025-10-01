# LLM caller requirements

## Functional requirements

- **FR1**: Provide MCP `chat` method supporting multi-message conversations with
  provider selection override.

- **FR2**: Provide MCP `embed` method capable of returning vector embeddings for
  multiple inputs.

- **FR3**: Enforce loopback-only access and token-based client authentication.
- **FR4**: Normalize provider responses into shared schemas with usage metadata
  and trace identifiers.

- **FR5**: Surface `getHealth` status including adapter reachability and last
  heartbeat timestamps.

## Non-functional requirements

- **NFR1**: Bind network listener to `127.0.0.1`; reject all non-loopback
  requests.

- **NFR2**: Return classified error codes within 500 ms for invalid requests.
- **NFR3**: Achieve ≥95% successful or gracefully handled responses during
  internal test runs.

- **NFR4**: Record structured logs for every request with `requestId`,
  `callerTool`, provider, and outcome.

- **NFR5**: Support configuration reload via process restart without code
  changes.

## Compliance checks

- Verify JSON schemas remain aligned with MCP contract templates.
- Ensure provider adapters honor secrets abstraction and never access
  environment variables directly.

- Confirm documentation updates across `README`, architecture, and planning
  artifacts during each release gate.

## Approval checklist

- [X] Product owner review
- [X] Architecture lead review
- [X] QA lead validation
- [X] Security review (loopback & secrets handling)
