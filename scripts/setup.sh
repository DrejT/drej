#!/usr/bin/env bash
# One-time local dev setup for a freshly cloned drej repo.
# Installs deps, builds workspace packages, scaffolds .env, and verifies
# the toolchain with a typecheck + unit test pass. Does not touch Docker
# or start an OpenSandbox server — that step is left to the dev (see the
# "Next steps" printed at the end) since it spins up a container.
set -euo pipefail

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

info "Checking prerequisites..."

command -v bun >/dev/null 2>&1 || fail "Bun >= 1.3 is required. Install: https://bun.sh"
info "bun $(bun --version) found"

if command -v docker >/dev/null 2>&1; then
  info "docker found"
else
  warn "Docker not found — needed for 'bunx drejx init' (local OpenSandbox) and integration tests"
fi

if command -v uvx >/dev/null 2>&1; then
  info "uv found"
else
  warn "uv/uvx not found — alternative way to run OpenSandbox server. Install: https://github.com/astral-sh/uv"
fi

info "Installing dependencies (bun install)..."
bun install

info "Building workspace packages (examples run against dist/, not src/)..."
bun run build

if [ ! -f .env ]; then
  info "Creating .env from template..."
  cat > .env <<'EOF'
# OpenSandbox server used by examples and local dev.
# These defaults match `bunx drejx init` (Docker) and `uvx opensandbox-server` (manual).
# Leave as-is unless you're pointing at a remote/hosted OpenSandbox instance.
OPEN_SANDBOX_URL=http://localhost:8080
OPEN_SANDBOX_API_KEY=
EOF
else
  info ".env already exists, leaving it untouched"
fi

info "Typechecking..."
bun run typecheck

info "Running unit tests (no sandbox required)..."
bun run test

info "Setup complete."
cat <<'EOF'

Next steps:
  1. Start a local OpenSandbox server (pick one):
       bunx drejx init          # Docker-based, recommended
       uvx opensandbox-server   # manual — needs ~/.sandbox.toml, see CLAUDE.md

  2. Run an example against it:
       bun examples/hello-world/index.ts

  3. Run integration tests (needs the server from step 1):
       bun run test:integration

See CONTRIBUTING.md and CLAUDE.md for details.
EOF
