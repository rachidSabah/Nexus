#!/usr/bin/env bash
#
# Agent Nexus Gateway — One-Command Installer for Linux/macOS/WSL
#
# Installs everything needed and starts both gateway + dashboard:
#   1. Installs Node.js 22+ (via nvm if missing)
#   2. Installs pnpm (via corepack)
#   3. Clones the repo
#   4. Installs all dependencies
#   5. Builds all packages
#   6. Registers the CLI globally (anx)
#   7. Starts the gateway (background, 127.0.0.1:8787)
#   8. Starts the dashboard (background, localhost:3000)
#   9. Verifies health
#  10. Detects coding agents
#  11. Displays URLs + next steps
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.sh | bash
#
# Or for WSL from Windows PowerShell:
#   wsl curl -fsSL https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.sh | bash

set -e

# ── Colors ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${BLUE}ℹ${NC}  $1"; }
ok()    { echo -e "${GREEN}✓${NC}  $1"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $1"; }
fail()  { echo -e "${RED}✗${NC}  $1"; exit 1; }

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Agent Nexus Gateway — Installer (Linux/macOS/WSL)${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo ""

# ── 1. Detect OS + architecture ───────────────────────────────────────────
OS=$(uname -s)
ARCH=$(uname -m)
info "OS: ${OS} ${ARCH}"

# Detect WSL
IS_WSL=false
if grep -qi microsoft /proc/version 2>/dev/null; then
  IS_WSL=true
  info "Running inside WSL"
fi

if [[ "$OS" == "MINGW"* ]] || [[ "$OS" == "MSYS"* ]] || [[ "$OS" == "CYGWIN"* ]]; then
  fail "This script is for Linux/macOS/WSL. On native Windows, use install.ps1 instead:\n  irm https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.ps1 | iex"
fi

# ── 2. Install Node.js 22+ if missing ────────────────────────────────────
if ! command -v node &>/dev/null; then
  info "Node.js not found — installing via nvm..."
  
  # Install nvm
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  
  # Install Node.js 22
  nvm install 22
  nvm use 22
  nvm alias default 22
  
  # Ensure nvm is loaded in shell profiles
  for PROFILE in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ -f "$PROFILE" ] && ! grep -q "NVM_DIR" "$PROFILE"; then
      echo 'export NVM_DIR="$HOME/.nvm"' >> "$PROFILE"
      echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> "$PROFILE"
    fi
  done
fi

NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  warn "Node.js v$NODE_VERSION is older than 22 — upgrading via nvm..."
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  nvm install 22
  nvm use 22
  nvm alias default 22
  NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
fi
ok "Node.js $(node --version) ready"

# ── 3. Install pnpm if missing ────────────────────────────────────────────
if ! command -v pnpm &>/dev/null; then
  info "Installing pnpm..."
  corepack enable 2>/dev/null || npm install -g pnpm
fi
ok "pnpm $(pnpm --version) ready"

# ── 4. Clone or update repo ──────────────────────────────────────────────
INSTALL_DIR="${ANX_HOME:-$HOME/.agent-nexus}"
REPO_DIR="$INSTALL_DIR/codingghosts"

if [ -d "$REPO_DIR/.git" ]; then
  info "Existing repo found at $REPO_DIR — updating..."
  cd "$REPO_DIR"
  git pull --ff-only 2>/dev/null || warn "Could not pull latest (offline?)"
else
  info "Cloning repo to $REPO_DIR..."
  mkdir -p "$INSTALL_DIR"
  git clone --depth 1 https://github.com/rachidSabah/codingghosts.git "$REPO_DIR"
  cd "$REPO_DIR"
fi

# ── 5. Install dependencies + build ──────────────────────────────────────
info "Installing dependencies (this may take 1-2 minutes)..."
pnpm install --no-frozen-lockfile 2>&1 | tail -3

info "Building all packages..."
pnpm build 2>&1 | tail -3
ok "Build complete"

# Fix duplicate shebang if present in dist/bin.js
if [ -f apps/gateway/dist/bin.js ]; then
  FIRST=$(head -1 apps/gateway/dist/bin.js)
  SECOND=$(sed -n '2p' apps/gateway/dist/bin.js)
  if [ "$FIRST" = "#!/usr/bin/env node" ] && [ "$SECOND" = "#!/usr/bin/env node" ]; then
    sed -i '1d' apps/gateway/dist/bin.js
    info "Fixed duplicate shebang in dist/bin.js"
  fi
fi

# ── 6. Register CLI globally ──────────────────────────────────────────────
info "Registering CLI..."
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
ln -sf "$REPO_DIR/packages/cli/dist/bin.js" "$BIN_DIR/anx"
chmod +x "$REPO_DIR/packages/cli/dist/bin.js"

# Add to PATH if not already there
SHELL_RC=""
if [ -n "$BASH_VERSION" ]; then SHELL_RC="$HOME/.bashrc"; fi
if [ -n "$ZSH_VERSION" ]; then SHELL_RC="$HOME/.zshrc"; fi
if [ -z "$SHELL_RC" ] && [ -f "$HOME/.bashrc" ]; then SHELL_RC="$HOME/.bashrc"; fi

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  export PATH="$BIN_DIR:$PATH"
  if [ -n "$SHELL_RC" ] && ! grep -q "$BIN_DIR" "$SHELL_RC" 2>/dev/null; then
    echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$SHELL_RC"
    info "Added $BIN_DIR to PATH in $SHELL_RC"
  fi
fi
ok "CLI registered: anx command available"

# ── 7. Kill any old instances ────────────────────────────────────────────
pkill -f "node.*gateway/dist/bin" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
sleep 2

# ── 8. Start gateway (background) ────────────────────────────────────────
info "Starting gateway on 127.0.0.1:8787..."
setsid bash -c "cd $REPO_DIR && exec node apps/gateway/dist/bin.js" > "$INSTALL_DIR/gateway.log" 2>&1 < /dev/null &
disown

info "Waiting for gateway to start..."
GW_OK=false
for i in $(seq 1 20); do
  if curl -s http://127.0.0.1:8787/health > /dev/null 2>&1; then
    GW_OK=true
    break
  fi
  sleep 1
done

if [ "$GW_OK" = "true" ]; then
  HEALTH=$(curl -s http://127.0.0.1:8787/health)
  ok "Gateway is healthy"
  echo -e "    ${BLUE}Status:${NC} $(echo $HEALTH | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["status"])' 2>/dev/null || echo 'ok')"
  echo -e "    ${BLUE}Endpoints:${NC} $(echo $HEALTH | python3 -c 'import json,sys; d=json.load(sys.stdin); print(f"{d[\"endpoints\"][\"healthy\"]}/{d[\"endpoints\"][\"total\"]} healthy")' 2>/dev/null || echo '?')"
else
  warn "Gateway didn't respond within 20s. Check: $INSTALL_DIR/gateway.log"
fi

# ── 9. Start dashboard (background) ───────────────────────────────────────
info "Starting dashboard on localhost:3000..."
setsid bash -c "cd $REPO_DIR && exec pnpm --filter @anx/dashboard dev" > "$INSTALL_DIR/dashboard.log" 2>&1 < /dev/null &
disown

info "Waiting for dashboard to start..."
DASH_OK=false
for i in $(seq 1 20); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "000")
  if [ "$CODE" = "200" ] || [ "$CODE" = "307" ]; then
    DASH_OK=true
    break
  fi
  sleep 2
done

if [ "$DASH_OK" = "true" ]; then
  ok "Dashboard is running at http://localhost:3000"
else
  warn "Dashboard didn't respond within 40s. Check: $INSTALL_DIR/dashboard.log"
  echo "    You can start it manually: cd $REPO_DIR && pnpm --filter @anx/dashboard dev"
fi

# ── 10. Detect coding agents ──────────────────────────────────────────────
if [ "$GW_OK" = "true" ]; then
  info "Detecting coding agents..."
  DETECT=$(curl -s http://127.0.0.1:8787/v1/agents/detect 2>/dev/null || echo '{}')
  FOUND=$(echo $DETECT | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("foundCount",0))' 2>/dev/null || echo "0")
  TOTAL=$(echo $DETECT | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("totalCount",0))' 2>/dev/null || echo "0")
  if [ "$FOUND" -gt 0 ]; then
    ok "Coding agents detected: $FOUND/$TOTAL"
  else
    info "No coding agents detected on this machine (install Claude Code, Codex, etc. to enable auto-integration)"
  fi
fi

# ── 11. Display summary ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✓ Installation Complete!${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo ""
if [ "$GW_OK" = "true" ]; then
  echo -e "  ${GREEN}Gateway:${NC}   http://127.0.0.1:8787"
  echo -e "  ${GREEN}Dashboard:${NC} http://localhost:3000"
else
  echo -e "  ${YELLOW}Gateway:${NC}   not running (check logs)"
  echo -e "  ${YELLOW}Dashboard:${NC} not running"
fi
echo ""
echo -e "  ${BLUE}CLI commands:${NC}"
echo "    anx doctor         — run full diagnostics"
echo "    anx health         — check gateway health"
echo "    anx models         — list available models"
echo "    anx models --free  — list free models"
echo "    anx integrations list  — detect coding agents"
echo "    anx integrations install --all  — auto-configure all agents"
echo ""
echo -e "  ${BLUE}API examples:${NC}"
echo "    curl http://127.0.0.1:8787/v1/models"
echo "    curl http://127.0.0.1:8787/v1/keys"
echo "    curl http://127.0.0.1:8787/v1/budget"
echo ""
echo -e "  ${BLUE}To stop:${NC}"
echo "    pkill -f 'node.*gateway/dist/bin'"
echo "    pkill -f 'next dev'"
echo ""
echo -e "  ${BLUE}Logs:${NC}"
echo "    Gateway:  $INSTALL_DIR/gateway.log"
echo "    Dashboard: $INSTALL_DIR/dashboard.log"
echo ""
echo -e "  ${BLUE}Repo:${NC} $REPO_DIR"
echo ""

# WSL-specific hint
if [ "$IS_WSL" = "true" ]; then
  echo -e "  ${YELLOW}WSL note:${NC} To open the dashboard in Windows browser:"
  echo "    Run in PowerShell:  start http://localhost:3000"
  echo ""
fi

# Open browser if possible (non-WSL)
if [ "$DASH_OK" = "true" ] && [ "$IS_WSL" = "false" ]; then
  if command -v xdg-open &>/dev/null; then
    xdg-open http://localhost:3000 2>/dev/null || true
  elif command -v open &>/dev/null; then
    open http://localhost:3000 2>/dev/null || true
  fi
fi
