#!/usr/bin/env bash
# Nexus - Linux / WSL / macOS updater
# Usage:  curl -fsSL https://raw.githubusercontent.com/rachidSabah/Nexus/main/scripts/update.sh | bash
#
# Steps:
#   1. Locate the Nexus repository (ANX_HOME/repo, NEXUS_REPO_DIR, or CWD)
#   2. Fetch + fast-forward pull from the official repo
#   3. pnpm install + build
#   4. Stop the running gateway + dashboard, then restart them (health-checked)
#
# Does NOT reinstall Node.js, pnpm, or touch your config/vault.

set -euo pipefail

REPO_URL="https://github.com/rachidSabah/Nexus"
INSTALL_DIR="${ANX_HOME:-$HOME/.agent-nexus}"
CONFIG_PATH="$INSTALL_DIR/config.json"
GATEWAY_PORT=8787
DASHBOARD_PORT=3000

step() { printf '\n\033[36m[nexus]\033[0m %s\n' "$1"; }

step "Nexus updater ($(uname -s))"

# --- 1. locate repo ---
REPO_DIR=""
if [ -n "${NEXUS_REPO_DIR:-}" ] && [ -d "$NEXUS_REPO_DIR/.git" ]; then
  REPO_DIR="$NEXUS_REPO_DIR"
elif [ -n "${ANX_HOME:-}" ] && [ -d "$ANX_HOME/repo/.git" ]; then
  REPO_DIR="$ANX_HOME/repo"
elif [ -d "$INSTALL_DIR/repo/.git" ]; then
  REPO_DIR="$INSTALL_DIR/repo"
elif [ -d "./.git" ] && git remote get-url origin 2>/dev/null | grep -q "rachidSabah/Nexus"; then
  REPO_DIR="$(pwd)"
fi
if [ -z "$REPO_DIR" ]; then
  echo "  Could not locate the Nexus repository." >&2
  echo "  Run the installer first, or set NEXUS_REPO_DIR / ANX_HOME." >&2
  exit 1
fi
echo "  Repository: $REPO_DIR"

# --- 2. pull ---
step "Fetching updates from the official repository..."
cd "$REPO_DIR"
git fetch origin
LOCAL="$(git rev-parse --short HEAD)"
BRANCH="$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's#refs/remotes/origin/##' || true)"
[ -z "$BRANCH" ] && BRANCH="main"
UPSTREAM="origin/$BRANCH"
BEHIND="$(git rev-list --count "HEAD..$UPSTREAM" 2>/dev/null || echo 0)"
echo "  Local : $LOCAL ($BRANCH)"
echo "  Behind: $BEHIND commit(s)"
if [ "$BEHIND" -le 0 ]; then
  echo ""; echo "  Already up to date - nothing to install."; exit 0
fi
echo "  Pulling..."
git pull --ff-only

# --- 3. install + build ---
step "Reinstalling dependencies and rebuilding..."
pnpm install
pnpm build

# --- 4. restart services ---
step "Restarting services..."
pkill -f "apps/gateway/dist/bin.js" 2>/dev/null || true
pkill -f "next start -p $DASHBOARD_PORT" 2>/dev/null || true
pkill -f "next dev -p $DASHBOARD_PORT" 2>/dev/null || true
sleep 2

GW_ARGS="apps/gateway/dist/bin.js"
[ -f "$CONFIG_PATH" ] && GW_ARGS="$GW_ARGS --config $CONFIG_PATH"
nohup node "$GW_ARGS" >"$INSTALL_DIR/gateway.log" 2>&1 &
nohup pnpm --filter @anx/dashboard start >"$INSTALL_DIR/dashboard.log" 2>&1 &

# --- 5. health check ---
step "Waiting for services to become healthy..."
OK=0
for i in $(seq 1 45); do
  GW_OK=0; DASH_OK=0
  curl -fsS "http://127.0.0.1:$GATEWAY_PORT/health" >/dev/null 2>&1 && GW_OK=1
  curl -fsS "http://127.0.0.1:$DASHBOARD_PORT/" >/dev/null 2>&1 && DASH_OK=1
  if [ "$GW_OK" = 1 ] && [ "$DASH_OK" = 1 ]; then OK=1; break; fi
  sleep 1
done

step "Done."
if [ "$OK" = 1 ]; then
  echo "  Gateway  : http://127.0.0.1:$GATEWAY_PORT (health: OK)"
  echo "  Dashboard: http://127.0.0.1:$DASHBOARD_PORT (HTTP: OK)"
else
  echo "  Services started but not healthy yet - check $INSTALL_DIR/gateway.log / dashboard.log" >&2
fi
echo "  Repo     : $REPO_DIR"
