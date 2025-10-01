# Contributing to LMStudio MCP Server

Thank you for your interest in contributing to the LLM Caller MCP Server! This guide will help you get started with local development and testing.

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- LM Studio installed (for local testing)
- Git

### Initial Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/lmstudio-mcp.git
   cd lmstudio-mcp
   ```

2. **Install dependencies**
   ```bash
   cd modules/llm_caller
   npm install
   ```

3. **Configure environment**
   ```bash
   # Copy example configuration files
   cp .env.example .env
   cp config/client-registry.example.json config/client-registry.json
   cp config/providers.example.json config/providers.json
   ```

4. **Edit configuration files**

   **`.env`** - Set your environment variables:
   ```bash
   # Network binding (defaults shown)
   LLM_CALLER_HOST=127.0.0.1
   LLM_CALLER_PORT=4037

   # Optional: Add API keys for external providers
   # OPENAI_API_KEY=your-key-here
   # ANTHROPIC_API_KEY=your-key-here
   ```

   **`config/client-registry.json`** - Create client tokens:
   ```json
   {
     "clients": [
       {
         "toolId": "my-dev-client",
         "token": "generate-a-secure-token-here",
         "allowedMethods": ["chat", "chatStream", "embed", "getHealth", "models"]
       }
     ]
   }
   ```

   **`config/providers.json`** - Configure your LM Studio and other providers:
   ```json
   {
     "providers": {
       "lmstudio": {
         "baseUrl": "http://localhost:1234/v1",
         "defaultModel": "your-loaded-model",
         "capabilities": ["chat", "chatStream", "embed"],
         "defaults": {
           "chat": "your-loaded-model"
         },
         "scores": {
           "chat": 90
         }
       }
     }
   }
   ```

5. **Verify setup**
   ```bash
   # Run tests
   npm test

   # Build TypeScript
   npm run build
   ```

## Development Workflow

### Running the Server Locally

```bash
# From modules/llm_caller/
npm run build
node dist/index.js
```

The server will start on `http://127.0.0.1:4037` (loopback-only).

### Testing Your Changes

**Run test suite:**
```bash
npm test
```

**Run with coverage:**
```bash
npm test -- --coverage
```

**Run specific test file:**
```bash
npm test -- tests/orchestrator.spec.ts
```

### Manual Testing with UAT Scripts

```bash
# From repo root
cd uat/
python3 run_uat.py

# Or test specific endpoints
curl -X POST http://127.0.0.1:4037/mcp/chat \
  -H "X-LLM-Caller-Token: your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "test-1",
    "callerTool": "my-dev-client",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### Configuration Management

The project includes an interactive CLI for managing configuration:

```bash
# From repo root
npm run config

# Options:
# 1. Manage providers (add/edit/remove)
# 2. Discover LM Studio models
# 3. Manage client tokens
# 4. Validate configuration
```

## Code Quality

### Linting and Formatting

```bash
# TypeScript compilation check
npm run build

# Spell checking (if cspell configured)
npx cspell "modules/**/*.{ts,md}"

# Markdown linting (if markdownlint configured)
npx markdownlint "**/*.md"
```

### Code Style

- **TypeScript**: Follow existing patterns in the codebase
- **Async/Await**: Use for all asynchronous operations
- **Error Handling**: Use try-catch with proper error classification
- **Types**: Maintain strong typing, avoid `any` when possible
- **Tests**: Write tests for all new functionality

## Project Structure

```
lmstudio-mcp/
├── modules/llm_caller/          # Main MCP server module
│   ├── src/                     # TypeScript source
│   │   ├── adapters/            # Provider adapters (LMStudio, OpenAI, Anthropic)
│   │   ├── transport.ts         # HTTP server and routing
│   │   ├── orchestrator.ts      # Request orchestration and capability routing
│   │   └── configCli.ts         # Interactive configuration tool
│   ├── tests/                   # Jest test suites
│   ├── api/schemas/v1/          # JSON Schema validation
│   ├── config/                  # Runtime configuration (gitignored)
│   │   ├── *.example.json       # Example configs (committed)
│   │   ├── providers.json       # Your providers (gitignored)
│   │   └── client-registry.json # Your tokens (gitignored)
│   ├── .env.example             # Example environment vars
│   └── package.json             # Dependencies and scripts
├── uat/                         # User acceptance tests
├── project_docs/                # Architecture and planning docs
└── README/                      # Guides and runbooks
```

## Making Contributions

### Before You Start

1. **Check existing issues** - Look for related issues or feature requests
2. **Discuss major changes** - Open an issue to discuss significant changes before implementing
3. **Read documentation** - Familiarize yourself with the architecture in `project_docs/`

### Contribution Process

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes**
   - Write code following existing patterns
   - Add tests for new functionality
   - Update documentation as needed

4. **Test thoroughly**
   ```bash
   npm test
   npm run build
   ```

5. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add capability X

   - Implement feature Y
   - Add tests for Z
   - Update documentation"
   ```

6. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

7. **Open a pull request**
   - Describe your changes clearly
   - Reference related issues
   - Include test results

### Commit Message Format

Follow conventional commits:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Test additions or changes
- `refactor`: Code refactoring
- `chore`: Maintenance tasks

**Examples:**
```
feat(orchestrator): add fallback routing strategy
fix(transport): handle rate limit headers correctly
docs(readme): update setup instructions
test(adapters): add integration tests for LMStudio
```

## Security Considerations

### Loopback-Only Enforcement

This server is **loopback-only** by design. All requests from non-localhost IPs are rejected.

**Never:**
- Disable loopback enforcement
- Expose the server to external networks
- Commit real API keys or tokens
- Share your `client-registry.json` or `providers.json`

**Always:**
- Test with example configurations
- Use environment variables for secrets
- Keep `.env` and config files gitignored
- Review changes for sensitive data before committing

### Handling Secrets

- **API Keys**: Store in `.env` file (gitignored)
- **Client Tokens**: Store in `config/client-registry.json` (gitignored)
- **Testing**: Use mock providers in tests, never real credentials

## Getting Help

- **Documentation**: Check `README/Developer_Guide.md` for integration details
- **Architecture**: Review `project_docs/architecture/` for design decisions
- **Issues**: Search existing issues or open a new one
- **Discussions**: Use GitHub Discussions for questions and ideas

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (see LICENSE file).

## Code of Conduct

- Be respectful and constructive
- Focus on the code, not the person
- Help others learn and grow
- Assume good intentions

Thank you for contributing to LMStudio MCP Server! 🚀
