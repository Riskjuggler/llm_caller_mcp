#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Install dependencies if needed and build the module
pushd "$ROOT_DIR/modules/llm_caller" > /dev/null
if [ ! -d node_modules ]; then
  npm install
fi
npm run build
popd > /dev/null


# Run the server from the module directory so relative schema paths resolve
cd "$ROOT_DIR/modules/llm_caller"

# Start the MCP server (dotenv will load variables from ROOT_DIR/.env)
exec node --enable-source-maps dist/src/index.js "$@"
