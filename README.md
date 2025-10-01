# LLM Caller MCP

A unified, secure inference service providing consistent access to multiple Large Language Model providers through the Model Context Protocol (MCP).

## Overview

LLM Caller MCP serves as a centralized AI gateway that enables tools and applications to interact with various LLM providers (OpenAI, Anthropic, LM Studio) through a single, well-defined interface. Built with security, reliability, and operational excellence in mind, it simplifies AI integration while maintaining provider flexibility.

## Key Features

- **Multi-Provider Support**: Seamlessly route requests to OpenAI, Anthropic, or local LM Studio instances
- **MCP Protocol**: Standards-based interface for chat, streaming, and embeddings
- **Intelligent Routing**: Capability-based provider selection with automatic fallbacks
- **Security First**: Loopback-only operation, token authentication, and comprehensive request validation
- **Full Observability**: Structured logging, metrics, tracing, and health monitoring
- **Production Ready**: Rate limiting, retry logic, error handling, and streaming sanitization

## Quick Start

### Installation

```bash
cd modules/llm_caller
npm install
```

### Configuration

```bash
# Copy example configs
cp config/client-registry.example.json config/client-registry.json
cp config/providers.example.json config/providers.json
cp .env.example .env

# Configure using the interactive CLI
npm run config
```

### Run Tests

```bash
npm test
```

### Start Server

```bash
npm run build
node dist/src/index.js
```

The service binds to `127.0.0.1:4037` by default (configurable via `.env`).

## Core Capabilities

### Chat Completions

```typescript
POST /mcp/chat
{
  "messages": [{"role": "user", "content": "Hello!"}],
  "model": "gpt-4",
  "provider": "openai"
}
```

### Streaming Responses

```typescript
POST /mcp/chatStream
// Returns Server-Sent Events (SSE) stream
```

### Embeddings

```typescript
POST /mcp/embed
{
  "inputs": ["text to embed"],
  "model": "text-embedding-3-large"
}
```

### Health & Discovery

```typescript
GET /health          // Provider status and capabilities
GET /mcp/models      // Available models across all providers
```

## Architecture

```
┌─────────────────┐
│   Client Tool   │
└────────┬────────┘
         │ MCP Protocol (HTTP/SSE)
         ▼
┌─────────────────────────────────┐
│   LLM Caller MCP Service        │
│  ┌──────────────────────────┐   │
│  │  Transport Layer         │   │
│  │  - Auth & Validation     │   │
│  │  - Rate Limiting         │   │
│  └──────────┬───────────────┘   │
│             ▼                    │
│  ┌──────────────────────────┐   │
│  │  Provider Orchestrator   │   │
│  │  - Routing Logic         │   │
│  │  - Retry Policies        │   │
│  └──────────┬───────────────┘   │
│             ▼                    │
│  ┌──────────────────────────┐   │
│  │  Provider Adapters       │   │
│  │  - OpenAI                │   │
│  │  - Anthropic             │   │
│  │  - LM Studio             │   │
│  └──────────────────────────┘   │
└─────────────────────────────────┘
```

## Security Architecture

### 🔒 Security-First Design

LLM Caller MCP is designed for **local development and trusted environments only**. The service implements multiple defense-in-depth layers to protect API credentials, prevent unauthorized access, and maintain audit trails.

### Core Security Features

#### Network Isolation
- **Loopback-Only Binding**: Service binds exclusively to `127.0.0.1` and refuses external network connections
- **No Remote Exposure**: Not designed for internet-facing deployment without additional security infrastructure
- **Startup Validation**: Automatically fails if configured to bind to non-loopback addresses

#### Authentication & Authorization
- **Token-Based Authentication**: Client registry with cryptographically random tokens
- **Method Allow-Lists**: Per-client granular control over accessible endpoints (`chat`, `chatStream`, `embed`, `models`, `getHealth`)
- **Token Hashing**: Client tokens hashed in logs and metrics to prevent token leakage
- **Session Isolation**: Each request validated independently with no implicit trust

#### Request Security
- **JSON Schema Validation**: All payloads validated against versioned schemas before processing
- **Input Sanitization**: Streaming responses sanitized to strip control characters and limit chunk sizes
- **Retry Hint Clamping**: Provider retry suggestions capped at 60 seconds to prevent untrusted backoff guidance
- **Timeout Enforcement**: Per-request timeout limits to prevent resource exhaustion

#### Credential Protection
- **Environment-Based Secrets**: API keys loaded from environment variables, never stored in code or logs
- **Secrets Abstraction Layer**: Pluggable credential provider enables future integration with Vault, AWS Secrets Manager
- **Redaction Pipeline**: Sensitive fields (`prompt`, `rawError`, API keys) automatically scrubbed from logs
- **Debug Payload Controls**: Optional `LLM_CALLER_LOG_DEBUG_PAYLOADS` flag for local debugging only (disabled by default)

#### Rate Limiting & Abuse Prevention
- **Per-Token Throttling**: Configurable request limits per client token to prevent runaway usage
- **HTTP 429 Handling**: Rate limit violations return standardized error responses
- **Failure Tracking**: Hashed client-token failure counts tracked for anomaly detection
- **Provider Circuit Breaking**: Retry policies with exponential backoff to avoid amplifying provider outages

#### Audit & Compliance
- **Structured Logging**: Every request logged with `requestId`, `traceId`, caller identity, provider, and outcome
- **Sensitive Data Redaction**: Prompts, responses, and error details redacted in persistent logs
- **Immutable Audit Trail**: Logs include timestamps, classifications, and routing decisions for compliance
- **Log Rotation**: Configurable retention with size-based rotation to manage disk usage

### ⚠️ Security Warnings & Deployment Guidance

#### **DO NOT** Deploy This Service If:

- ❌ You need internet-facing AI inference (use managed services like OpenAI API directly)
- ❌ You require multi-tenant isolation (service uses shared provider credentials)
- ❌ You need certificate-based mTLS authentication (current implementation uses bearer tokens)
- ❌ You must comply with SOC2/HIPAA without additional controls (logging and encryption require external infrastructure)

#### **Required Security Practices**

- ✅ **Protect `.env` files**: Ensure API keys are never committed to version control (`.env` is in `.gitignore`)
- ✅ **Rotate tokens regularly**: Generate new client registry tokens and update consumer configurations
- ✅ **Monitor logs**: Review audit logs for unauthorized access attempts or anomalous patterns
- ✅ **Restrict file permissions**: Set `config/client-registry.json` and `.env` to `0600` (owner read/write only)
- ✅ **Use separate API keys**: Provision dedicated provider API keys for this service (not shared with other applications)
- ✅ **Enable rate limiting**: Configure `LLM_CALLER_RATE_LIMIT_MAX` to prevent cost overruns
- ✅ **Disable debug mode in production**: Never set `LLM_CALLER_LOG_DEBUG_PAYLOADS=true` in shared environments

#### **Known Limitations & Mitigation Roadmap**

The current HTTP/SSE transport carries inherent risks for streamable MCP deployments:

- **No Mutual Attestation**: Bearer tokens can be replayed by any local process with access
- **No Runtime Manifest Verification**: Configuration files are trusted without signature validation
- **Limited Transport Security**: HTTP over loopback lacks encryption (acceptable for local-only, not for remote)

**Planned Phase 3 Security Enhancements** (see [Architecture](project_docs/architecture/LLM_Caller_Architecture.md#security-review)):

1. **STDIO Transport Option**: Direct process-to-process communication with handshake keys
2. **Signed Configuration Manifests**: Cryptographic verification of provider and client registry files
3. **Short-Lived Session Tokens**: Nonce-based attestation to prevent token replay
4. **Operator Confirmation Hooks**: Interactive prompts for high-privilege operations

**Until these mitigations are implemented, operators must:**

- Run the service on trusted developer workstations only
- Use host-based firewalls to block port 4037 from network access
- Monitor process lists for unexpected client connections
- Audit configuration file changes via version control

### Credential Management Best Practices

```bash
# Set restrictive permissions on sensitive files
chmod 600 .env
chmod 600 config/client-registry.json
chmod 600 config/providers.json

# Verify loopback binding before starting
grep "LLM_CALLER_HOST=127.0.0.1" .env || echo "WARNING: Non-loopback binding detected!"

# Use separate API keys for development and production
OPENAI_API_KEY=sk-proj-dev-...  # Development key with spending limits
ANTHROPIC_API_KEY=sk-ant-test-... # Test key with restricted quotas

# Enable audit logging
LLM_CALLER_LOG_FILE=/var/log/llm-caller/audit.log
LLM_CALLER_LOG_LEVEL=info  # Never set to 'debug' in shared environments
```

### Reporting Security Issues

If you discover a security vulnerability, please **do not** open a public GitHub issue. Instead:

1. Email security details to [security contact to be added]
2. Include steps to reproduce, impact assessment, and suggested mitigations
3. Allow 90 days for coordinated disclosure before public announcement

See [SECURITY.md](SECURITY.md) for our responsible disclosure policy.

## Documentation

Comprehensive documentation is available in the `README/` directory:

- **[Developer Guide](README/Developer_Guide.md)**: Integration patterns, API reference, and code examples
- **[Runbook](README/LLM_Caller_Runbook.md)**: Operational procedures, monitoring, and troubleshooting
- **[Pilot Integration Checklist](README/Pilot_Integration_Checklist.md)**: Step-by-step integration guide for new consumers

Additional technical documentation:

- **Architecture**: See `project_docs/architecture/LLM_Caller_Architecture.md`
- **Vision & Roadmap**: See `project_docs/LLM_Caller_vision.md`
- **Module README**: See `modules/llm_caller/README.md` for detailed setup

## Configuration

### Environment Variables

```bash
# Server configuration
LLM_CALLER_HOST=127.0.0.1
LLM_CALLER_PORT=4037

# Provider credentials
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Logging
LLM_CALLER_LOG_LEVEL=info
LLM_CALLER_LOG_FILE=/var/log/llm-caller.log
LLM_CALLER_LOG_MAX_BYTES=10485760
LLM_CALLER_LOG_MAX_FILES=5

# Rate limiting
LLM_CALLER_RATE_LIMIT_MAX=100
LLM_CALLER_RATE_LIMIT_INTERVAL_MS=60000
```

### Provider Configuration

```json
{
  "providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "defaultModel": "gpt-4",
      "capabilities": ["chat", "chatStream", "embed"],
      "defaults": {
        "chat": "gpt-4",
        "chatStream": "gpt-4",
        "embed": "text-embedding-3-large"
      }
    },
    "lmstudio": {
      "baseUrl": "http://localhost:1234/v1",
      "defaultModel": "local-model",
      "capabilities": ["chat", "chatStream"]
    }
  }
}
```

## Development

### Requirements

- Node.js 20+
- TypeScript 5.5+
- npm 9+

### Project Structure

```
modules/llm_caller/
├── src/                    # TypeScript source code
│   ├── adapters/          # Provider implementations
│   ├── config/            # Configuration management
│   ├── secrets/           # Credential providers
│   ├── transport.ts       # MCP HTTP/SSE server
│   ├── orchestrator.ts    # Request routing
│   ├── logger.ts          # Structured logging
│   └── metrics.ts         # Telemetry
├── tests/                 # Jest test suite
├── config/                # Runtime configuration
└── api/schemas/v1/        # JSON Schema definitions
```

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- tests/orchestrator.spec.ts
```

### Code Quality

```bash
# Lint markdown documentation
npm run lint:md

# Spell check
npm run lint:spell
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines, code standards, and submission process.

## Current Status

- **Phase 1 (Foundation)**: ✅ Complete
- **Phase 2 (Hardening)**: ✅ Complete
- **Phase 3 (Launch Readiness)**: 🔄 In Progress

All 66 automated tests passing. Production-ready for loopback deployment with comprehensive observability.

## License

[License details to be added]

## Support

For operational guidance, see the [Runbook](README/LLM_Caller_Runbook.md).

For integration assistance, see the [Developer Guide](README/Developer_Guide.md).

For issues and questions, please open a GitHub issue.
