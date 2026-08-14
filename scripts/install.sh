#!/usr/bin/env bash
# Agent Nexus Gateway — Linux / WSL / macOS installer
# Usage:  curl -fsSL https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.sh | bash
#
# Steps:
#   1. Detect OS / architecture / WSL
#   2. Verify Node.js (>= 20) and npm; print actionable message if missing
#   3. Install the `nexus-gateway` CLI globally via npm
#   4. Create ~/.agent-nexus and a local config
#   5. Start the gateway (no systemd assumptions)
#   6. Print the dashboard URL
#
# Does NOT install unrelated software. Node.js must be present.

set -euo pipefail

REPO_URL='https://github.com/rachidSabah/codingghosts'   # <-- set before publishing
INSTALL_DIR="${ANX_HOME:-$HOME/.agent-nexus}"
GATEWAY_PORT=8787
DASHBOARD_URL="http://127.0.0.1:${GATEWAY_PORT}/dashboard"

step() { printf '\n\033[36m[nexus]\033[0m %s\n' "$1"; }

step "Agent Nexus Gateway installer ($(uname -s))"

# --- 1. platform ---
ARCH="$(uname -m)"
WSL=0
if [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/version 2>/dev/null; then WSL=1; fi
echo "  OS: $(uname -s) | arch: $ARCH | wsl: $WSL"

# --- 2. node/npm ---
step "Checking Node.js..."
if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js >= 20 is required but was not found." >&2
  echo "  Install it (e.g. via nvm, apt, or https://nodejs.org) then re-run." >&2
  exit 1
fi
NODE_VER="$(node --version | sed 's/^v//')"
NODE_MAJOR="$(printf '%s' "$NODE_VER" | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "  Node.js >= 20 required (found $NODE_VER)." >&2
  exit 1
fi
echo "  Node.js $NODE_VER OK"
command -v npm >/dev/null 2>&1 || { echo "  npm not found." >&2; exit 1; }

# --- 3. install package ---
step "Installing nexus-gateway CLI (global)..."
npm install -g nexus-gateway@latest

# --- 4. config ---
step "Creating $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"
if [ ! -f "$INSTALL_DIR/config.json" ]; then
  if command -v openssl >/dev/null 2>&1; then
    VAULT_KEY="$(openssl rand -hex 32)"
  else
    VAULT_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  cat > "$INSTALL_DIR/config.json" <<JSON
{
  "port": ${GATEWAY_PORT},
  "vaultPath": "${INSTALL_DIR}/vault.json",
  "security": { "vaultKey": "${VAULT_KEY}" }
}
JSON
  echo "  Generated config + vault key."
fi

# --- 5. start gateway (best-effort; no systemd) ---
step "Starting gateway..."
nohup nexus-gateway --config "$INSTALL_DIR/config.json" >"$INSTALL_DIR/gateway.log" 2>&1 &
sleep 4

# --- 6. report ---
step "Done."
echo "  Gateway  : http://127.0.0.1:${GATEWAY_PORT}"
echo "  Dashboard: ${DASHBOARD_URL}"
echo "  Config   : ${INSTALL_DIR}/config.json"
echo "  Logs     : ${INSTALL_DIR}/gateway.log"
echo ""
echo "  Next: open the dashboard, add a provider API key, and point your"
echo "  coding agent at http://127.0.0.1:${GATEWAY_PORT}/v1"
echo ""
echo "  Source: ${REPO_URL}"
