#!/usr/bin/env bash
# Agent Nexus Gateway — Uninstaller for Linux/macOS/WSL
# Usage: curl -fsSL https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/uninstall.sh | bash
set -e
echo ""
echo "Stopping gateway + dashboard..."
pkill -f "node.*gateway/dist/bin" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
sleep 2
echo "Processes stopped."
rm -f "$HOME/.local/bin/anx" 2>/dev/null
INSTALL_DIR="${ANX_HOME:-$HOME/.agent-nexus}"
rm -rf "$INSTALL_DIR/codingghosts" 2>/dev/null
rmdir "$INSTALL_DIR" 2>/dev/null || true
for PROFILE in "$HOME/.bashrc" "$HOME/.zshrc"; do
  if [ -f "$PROFILE" ]; then sed -i '/\.local\/bin/d' "$PROFILE" 2>/dev/null || true; fi
done
echo ""
echo "Uninstall complete. Node.js and pnpm left installed."
