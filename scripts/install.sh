#!/usr/bin/env bash
# Agent Nexus Gateway — one-command installer for Linux/macOS/WSL
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.sh | bash
#
# Or from a local clone:
#   bash scripts/install.sh
#
# Master prompt #26: "Create installation commands for WSL/Linux:
#   curl -fsSL <official-install-url> | bash"
#
# The installer:
#   1. Detects OS + architecture
#   2. Checks for Node.js 22+ and pnpm
#   3. Installs pnpm if missing (via corepack)
#   4. Clones the repo (or uses existing clone)
#   5. Installs dependencies + builds
#   6. Registers the CLI globally (anx)
#   7. Starts the gateway as a background service
#   8. Verifies health
#   9. Detects coding agents
#   10. Displays dashboard URL

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}ℹ${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
fail()  { echo -e "${RED}✗${NC} $1"; exit 1; }

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Agent Nexus Gateway — Installer (Linux/macOS/WSL)"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── 1. Detect OS + architecture ─────────────────────────────────────────
OS=$(uname -s)
ARCH=$(uname -m)
info "OS: ${OS} ${ARCH}"

if [[ "$OS" == "MINGW"* ]] || [[ "$OS" == "MSYS"* ]] || [[ "$OS" == "CYGWIN"* ]]; then
  fail "This script is for Linux/macOS/WSL. On Windows, use install.ps1 instead."
fi

# ── 2. Check for Node.js 22+ ──────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Install Node.js 22+ from https://nodejs.org/ first."
fi

NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  fail "Node.js $NODE_VERSION is too old. Install Node.js 22+ from https://nodejs.org/"
fi
ok "Node.js $(node --version) detected"

# ── 3. Install pnpm if missing ───────────────────────────────────────────
if ! command -v pnpm &>/dev/null; then
  info "Installing pnpm via corepack..."
  corepack enable 2>/dev/null || npm install -g pnpm
fi
ok "pnpm $(pnpm --version) detected"

# ── 4. Clone or use existing repo ─────────────────────────────────────────
INSTALL_DIR="${ANX_HOME:-$HOME/.agent-nexus}"
REPO_DIR="$INSTALL_DIR/codingghosts"

if [ -d "$REPO_DIR/.git" ]; then
  info "Existing repo found at $REPO_DIR — pulling latest..."
  cd "$REPO_DIR"
  git pull --ff-only 2>/dev/null || warn "Could not pull latest (offline?)"
else
  info "Cloning repo to $REPO_DIR..."
  mkdir -p "$INSTALL_DIR"
  git clone --depth 1 https://github.com/rachidSabah/codingghosts.git "$REPO_DIR"
  cd "$REPO_DIR"
fi

# ── 5. Install dependencies + build ──────────────────────────────────────
info "Installing dependencies..."
pnpm install --no-frozen-lockfile 2>&1 | tail -3

info "Building all packages..."
pnpm build 2>&1 | tail -3
ok "Build complete"

# ── 6. Register CLI globally ─────────────────────────────────────────────
info "Registering CLI..."
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
ln -sf "$REPO_DIR/packages/cli/dist/bin.js" "$BIN_DIR/anx"
chmod +x "$REPO_DIR/packages/cli/dist/bin.js"

# Add to PATH if not already there
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  warn "Add $BIN_DIR to your PATH to use 'anx' globally."
  echo "  Add this to your ~/.bashrc or ~/.zshrc:"
  echo "    export PATH=\"$BIN_DIR:\$PATH\""
fi
ok "CLI registered at $BIN_DIR/anx"

# ── 7. Start gateway as background service ────────────────────────────────
info "Starting gateway on 127.0.0.1:8787..."
# Kill any existing instance
pkill -f "node.*gateway/dist/bin" 2>/dev/null || true
sleep 1

# Start detached
setsid bash -c "cd $REPO_DIR && exec node apps/gateway/dist/bin.js" > "$INSTALL_DIR/gateway.log" 2>&1 < /dev/null &
disown

# ── 8. Verify health ──────────────────────────────────────────────────────
info "Waiting for gateway to start..."
HEALTH_OK=false
for i in $(seq 1 15); do
  if curl -s http://127.0.0.1:8787/health > /dev/null 2>&1; then
    HEALTH_OK=true
    break
  fi
  sleep 1
done

if [ "$HEALTH_OK" = "true" ]; then
  HEALTH=$(curl -s http://127.0.0.1:8787/health)
  ok "Gateway is healthy: $(echo $HEALTH | python3 -c 'import json,sys; d=json.load(sys.stdin); print(f"{d[\"status\"]} · {d[\"endpoints\"][\"healthy\"]}/{d[\"endpoints\"][\"total\"]} endpoints")' 2>/dev/null || echo "running")"
else
  warn "Gateway didn't respond within 15s. Check $INSTALL_DIR/gateway.log"
fi

# ── 9. Detect coding agents ───────────────────────────────────────────────
info "Detecting coding agents..."
if [ "$HEALTH_OK" = "true" ]; then
  DETECT=$(curl -s http://127.0.0.1:8787/v1/agents/detect 2>/dev/null || echo '{"foundCount":0,"totalCount":0}')
  FOUND=$(echo $DETECT | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("foundCount",0))' 2>/dev/null || echo "0")
  TOTAL=$(echo $DETECT | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("totalCount",0))' 2>/dev/null || echo "0")
  ok "Coding agents detected: $FOUND/$TOTAL"
fi

# ── 10. Display dashboard URL + next steps ──────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Installation Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  Gateway:  http://127.0.0.1:8787"
echo "  Health:   curl http://127.0.0.1:8787/health"
echo "  CLI:      anx doctor    (run diagnostics)"
echo "            anx health    (check gateway)"
echo "            anx models    (list models)"
echo "            anx models --free  (list free models)"
echo ""
echo "  To start the dashboard:"
echo "    cd $REPO_DIR && pnpm --filter @anx/dashboard dev"
echo "    Then open http://localhost:3000"
echo ""
echo "  To stop the gateway:"
echo "    pkill -f 'node.*gateway/dist/bin'"
echo ""
echo "  Logs: $INSTALL_DIR/gateway.log"
echo "  Repo: $REPO_DIR"
echo ""
