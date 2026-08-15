#!/usr/bin/env bash
# Nexus — Linux / WSL / macOS installer
# Usage:  curl -fsSL https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.sh | bash
#
# Steps:
#   1. Detect OS / architecture / WSL
#   2. Verify Node.js (>= 20) and pnpm — prints actionable message if missing
#   3. Clone or update the Nexus repository into ~/.agent-nexus/repo
#   4. pnpm install + build
#   5. Create ~/.agent-nexus and write local config (vault key auto-generated)
#   6. Start the gateway (nohup, no systemd assumptions)
#   7. Print the dashboard URL and next steps
#
# Does NOT install unrelated software. Node.js must be present.

set -euo pipefail

REPO_URL="https://github.com/rachidSabah/codingghosts"
INSTALL_DIR="${ANX_HOME:-$HOME/.agent-nexus}"
REPO_DIR="${INSTALL_DIR}/repo"
GATEWAY_PORT=8787

step() { printf '\n\033[36m[nexus]\033[0m %s\n' "$1"; }

step "Nexus installer ($(uname -s))"

# --- 1. platform ---
ARCH="$(uname -m)"
WSL=0
if [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/version 2>/dev/null; then WSL=1; fi
echo "  OS: $(uname -s) | arch: $ARCH | wsl: $WSL"

# --- 2. node ---
step "Checking Node.js..."
if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js >= 20 is required but was not found." >&2
  echo "  Install via nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash" >&2
  echo "  Or visit https://nodejs.org" >&2
  exit 1
fi
NODE_VER="$(node --version | sed 's/^v//')"
NODE_MAJOR="$(printf '%s' "$NODE_VER" | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "  Node.js >= 20 required (found $NODE_VER)." >&2
  exit 1
fi
echo "  Node.js $NODE_VER OK"

# --- 3. pnpm ---
step "Checking pnpm..."
if ! command -v pnpm >/dev/null 2>&1; then
  echo "  Installing pnpm..."
  npm install -g pnpm@latest
fi
PNPM_VER="$(pnpm --version)"
echo "  pnpm $PNPM_VER OK"

# --- 4. clone or update ---
step "Setting up Nexus repository..."
mkdir -p "$INSTALL_DIR"

if [ -d "${REPO_DIR}/.git" ]; then
  echo "  Updating existing clone..."
  git -C "$REPO_DIR" pull --ff-only
else
  echo "  Cloning $REPO_URL ..."
  git clone --depth 1 "$REPO_URL" "$REPO_DIR"
fi

# --- 5. build ---
step "Installing dependencies and building..."
cd "$REPO_DIR"
pnpm install --frozen-lockfile
pnpm build
cd -

# --- 6. config ---
step "Creating configuration..."
if [ ! -f "${INSTALL_DIR}/config.json" ]; then
  if command -v openssl >/dev/null 2>&1; then
    VAULT_KEY="$(openssl rand -hex 32)"
  else
    VAULT_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  cat > "${INSTALL_DIR}/config.json" <<JSON
{
  "port": ${GATEWAY_PORT},
  "vaultPath": "${INSTALL_DIR}/vault.json",
  "security": { "vaultKey": "${VAULT_KEY}" }
}
JSON
  echo "  Generated config + vault key."
else
  echo "  Existing config preserved."
fi

# Create .env if not present
if [ ! -f "${REPO_DIR}/.env" ]; then
  cp "${REPO_DIR}/.env.example" "${REPO_DIR}/.env"
  echo "  Created .env from .env.example — add your API keys."
fi

# --- 7. start gateway (best-effort; no systemd) ---
step "Starting gateway (background)..."
nohup node "${REPO_DIR}/apps/gateway/dist/bin.js" \
  --config "${INSTALL_DIR}/config.json" \
  >"${INSTALL_DIR}/gateway.log" 2>&1 &
sleep 4

# --- 8. report ---
step "Done."
echo ""
echo "  Gateway   : http://127.0.0.1:${GATEWAY_PORT}"
echo "  Dashboard : http://127.0.0.1:${GATEWAY_PORT}/dashboard"
echo "  Config    : ${INSTALL_DIR}/config.json"
echo "  Logs      : ${INSTALL_DIR}/gateway.log"
echo "  Repo      : ${REPO_DIR}"
echo ""
echo "  Next steps:"
echo "    1. Open the dashboard and add a provider API key."
echo "    2. Point your coding agent at: http://127.0.0.1:${GATEWAY_PORT}/v1"
echo "    3. Select a routing policy (e.g. nexus/best-coding) and start coding."
echo ""
echo "  Source: ${REPO_URL}"
