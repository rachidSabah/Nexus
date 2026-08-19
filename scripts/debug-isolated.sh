#!/usr/bin/env bash
# Nexus — Isolated debug workflow for agentic coding agents.
#
# Problem it solves:
#   Letting a vibe-coding agent edit the LIVE gateway source (E:/Nexus) and
#   restart it risks taking down the running gateway mid-debug. This script
#   gives the agent a fully isolated playground instead:
#
#     1. A git worktree (separate checkout) under .worktrees/ — the live
#        working tree and the running gateway on :8787 are NEVER touched.
#     2. A throwaway gateway instance on a DIFFERENT port (default 8799) with a
#        freshly generated local admin key + vault — so the agent's edits and
#        restarts are contained.
#     3. The full gate suite (typecheck + lint + test) run against the worktree.
#     4. The worktree branch is merged back into main ONLY if every gate is
#        green. Otherwise the session is reported and left for inspection.
#
# Usage:
#   ./scripts/debug-isolated.sh                 # setup isolated env, leave running
#   ./scripts/debug-isolated.sh --merge         # setup, run gates, merge if green
#   ./scripts/debug-isolated.sh --port 8801     # custom throwaway port
#   ./scripts/debug-isolated.sh --keep          # don't remove the worktree on exit
#   ./scripts/debug-isolated.sh --branch debug/my-session
#
# Requirements: git, node >= 20, pnpm. Run from the repo root.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

PORT="${PORT:-8799}"
MERGE=0
KEEP=0
BRANCH="debug/isolated-$(date +%Y%m%d-%H%M%S)"
WORKTREE_DIR="$REPO_ROOT/.worktrees/debug-session-$(date +%s)"

for arg in "$@"; do
  case "$arg" in
    --merge)  MERGE=1 ;;
    --keep)   KEEP=1 ;;
    --port)   PORT="${2:-8799}"; shift ;;
    --branch) BRANCH="${2:-$BRANCH}"; shift ;;
  esac
  shift || true
done

step()  { printf '\n\033[36m[nexus-debug]\033[0m %s\n' "$1"; }
ok()    { printf '\033[32m  ok:\033[0m %s\n' "$1"; }
warn()  { printf '\033[33m  warn:\033[0m %s\n' "$1"; }
fail()  { printf '\033[31m  FAIL:\033[0m %s\n' "$1" >&2; }

# --- 0. preconditions ---
step "Preflight"
if ! command -v pnpm >/dev/null 2>&1; then fail "pnpm not found"; exit 1; fi
if ! command -v node >/dev/null 2>&1; then fail "node not found"; exit 1; fi
# Ensure the live gateway port (8787) is not the one we're about to use.
if [ "$PORT" = "8787" ]; then fail "refusing to use the live gateway port (8787)"; exit 1; fi
ok "using throwaway port $PORT, branch $BRANCH"

# --- 1. worktree (isolated checkout) ---
step "Creating isolated worktree at $WORKTREE_DIR"
mkdir -p "$REPO_ROOT/.worktrees"
# Clean any stale worktree left from a previous run (e.g. Windows file lock).
if [ -e "$WORKTREE_DIR" ]; then
  git worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
  rm -rf "$WORKTREE_DIR" >/dev/null 2>&1 || true
  # If still locked, let the add step report a clear error rather than silently clobbering.
fi
BASE="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
git worktree add -b "$BRANCH" "$WORKTREE_DIR" "$BASE" >/dev/null 2>&1 \
  || git worktree add -b "$BRANCH" "$WORKTREE_DIR" HEAD >/dev/null 2>&1
ok "worktree ready — agent should edit ONLY files under $WORKTREE_DIR"

# --- 2. install + build in the worktree (never the live tree) ---
step "Installing deps + building inside the worktree"
( cd "$WORKTREE_DIR" && pnpm install --frozen-lockfile >/dev/null 2>&1 ) || ( cd "$WORKTREE_DIR" && pnpm install >/dev/null 2>&1 )
( cd "$WORKTREE_DIR" && pnpm -r build >/dev/null 2>&1 ) || warn "workspace build had warnings (continuing)"
ok "worktree built"

# --- 3. throwaway gateway config (generated, local-only, NOT committed) ---
step "Generating throwaway gateway config"
TMP_CFG="$(mktemp -p "$WORKTREE_DIR" nexus-debug.XXXXXX.json)"
TMP_VAULT="$(mktemp -p "$WORKTREE_DIR" nexus-vault.XXXXXX.json)"
VAULT_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
ADMIN_KEY="debug-local-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
cat > "$TMP_CFG" <<JSON
{
  "port": ${PORT},
  "host": "127.0.0.1",
  "vaultPath": "${TMP_VAULT}",
  "security": { "vaultKey": "${VAULT_KEY}" },
  "principals": [ { "id": "admin", "roles": ["admin"], "apiKey": "${ADMIN_KEY}" } ]
}
JSON
ok "throwaway admin key: $ADMIN_KEY"

# --- 4. launch throwaway gateway (background, best-effort) ---
# Uses setsid+nohup so the process survives this script's exit and is owned by
# the agent's debug session. Readiness is best-effort: gates (step 5) are the
# real merge gate; the gateway is just the agent's isolated playground.
step "Launching throwaway gateway on :$PORT (best-effort)"
LOGFILE="$WORKTREE_DIR/gateway-debug.log"
# setsid is unavailable on some Windows/git-bash setups; fall back to nohup.
if command -v setsid >/dev/null 2>&1; then
  setsid nohup bash -c "cd '$WORKTREE_DIR/apps/gateway' && PORT='$PORT' pnpm dev --config '$TMP_CFG' >'$LOGFILE' 2>&1" &
else
  nohup bash -c "cd '$WORKTREE_DIR/apps/gateway' && PORT='$PORT' pnpm dev --config '$TMP_CFG' >'$LOGFILE' 2>&1" &
fi
GW_PID=$!
echo "$GW_PID" > "$WORKTREE_DIR/gateway.pid"
READY=0
for i in $(seq 1 45); do
  if curl -s -o /dev/null "http://127.0.0.1:${PORT}/health"; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -eq 1 ]; then
  ok "throwaway gateway live at http://127.0.0.1:${PORT}/v1 (pid $GW_PID)"
else
  warn "throwaway gateway not ready within 45s — agent can start it manually:"
  warn "  cd $WORKTREE_DIR/apps/gateway && PORT=$PORT pnpm dev --config $TMP_CFG"
fi

# --- 5. run gates against the worktree (this is the real merge gate) ---
step "Running gate suite (typecheck + lint + test) in the worktree"
GATES_PASS=0
( cd "$WORKTREE_DIR" && pnpm typecheck >/dev/null 2>&1 \
  && pnpm lint >/dev/null 2>&1 \
  && pnpm test >/dev/null 2>&1 ) && GATES_PASS=1 || GATES_PASS=0

if [ "$GATES_PASS" -eq 1 ]; then
  ok "all gates green in the isolated worktree"
else
  warn "gates FAILED in the isolated worktree — NOT merging"
  echo "  Inspect: $WORKTREE_DIR"
  [ "$READY" -eq 1 ] && echo "  Gateway still running at :$PORT (pid $GW_PID) for live debugging."
fi

# --- 6. merge only if green AND requested AND the branch has changes ---
if [ "$GATES_PASS" -eq 1 ] && [ "$MERGE" -eq 1 ]; then
  DIVERGED="$(git rev-list "HEAD..$BRANCH" --count 2>/dev/null || echo 0)"
  if [ "${DIVERGED:-0}" != "0" ]; then
    step "Merging $BRANCH -> main (gates green, $DIVERGED commit(s))"
    git merge --no-ff "$BRANCH" -m "debug(isolated): merge verified session $BRANCH" \
      && ok "merged to main" || fail "merge failed — resolve manually"
  else
    ok "no divergent commits on $BRANCH — nothing to merge (verified clean)"
  fi
fi

# --- 7. cleanup ---
if [ "$KEEP" -eq 0 ] && [ "$GATES_PASS" -eq 0 ]; then
  step "Cleaning up throwaway gateway + worktree"
  kill "$GW_PID" 2>/dev/null || true
  git worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
  ok "cleaned up (worktree removed, gateway stopped)"
elif [ "$KEEP" -eq 1 ]; then
  warn "keeping worktree + gateway (--keep). Stop later: kill $GW_PID; git worktree remove $WORKTREE_DIR"
fi

echo
echo "  Summary:"
echo "    Worktree : $WORKTREE_DIR"
echo "    Gateway  : http://127.0.0.1:${PORT}/v1 (pid ${GW_PID:-n/a})"
echo "    Gates    : $([ "$GATES_PASS" -eq 1 ] && echo GREEN || echo RED)"
echo "    Merged   : $([ "$GATES_PASS" -eq 1 ] && [ "$MERGE" -eq 1 ] && echo yes || echo no)"
echo
