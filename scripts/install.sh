#!/usr/bin/env bash
# Agent Nexus Gateway — installer (Linux / macOS)
# Usage: curl -fsSL https://agent-nexus-gateway.dev/install.sh | bash
# Or:    ./install.sh

set -euo pipefail

VERSION="${ANX_VERSION:-0.1.0}"
INSTALL_DIR="${ANX_INSTALL_DIR:-/usr/local/bin}"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux*)  PLATFORM="linux";;
  Darwin*) PLATFORM="darwin";;
  *) echo "Unsupported OS: $OS"; exit 1;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH="amd64";;
  arm64|aarch64) ARCH="arm64";;
  *) echo "Unsupported architecture: $ARCH"; exit 1;;
esac

echo "Installing Agent Nexus Gateway v${VERSION} (${PLATFORM}/${ARCH})..."

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "Node.js is required (v22+). Install from https://nodejs.org/"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22+ is required (found v$(node -v))."
  exit 1
fi

# Check pnpm
if ! command -v pnpm &> /dev/null; then
  echo "pnpm not found. Enabling via corepack..."
  corepack enable
  corepack prepare pnpm@9.12.0 --activate
fi

# Download the release tarball
URL="https://github.com/rachidSabah/codingghosts/releases/download/v${VERSION}/agent-nexus-gateway-${VERSION}.tar.gz"
echo "Downloading $URL..."
if ! curl -fsSL "$URL" -o "$TEMP_DIR/anx.tar.gz"; then
  echo "Failed to download. Building from source instead..."
  git clone --depth 1 --branch "v${VERSION}" https://github.com/rachidSabah/codingghosts.git "$TEMP_DIR/anx"
  cd "$TEMP_DIR/anx"
  pnpm install
  pnpm build
  # Install CLI globally
  cd packages/cli
  pnpm link --global
  echo "Installed via build-from-source."
  exit 0
fi

# Extract
tar -xzf "$TEMP_DIR/anx.tar.gz" -C "$TEMP_DIR"

# Install binary
if [ -w "$INSTALL_DIR" ]; then
  cp "$TEMP_DIR/anx" "$INSTALL_DIR/anx"
  chmod +x "$INSTALL_DIR/anx"
else
  echo "Installing to $INSTALL_DIR requires sudo."
  sudo cp "$TEMP_DIR/anx" "$INSTALL_DIR/anx"
  sudo chmod +x "$INSTALL_DIR/anx"
fi

# Verify
echo ""
echo "✓ Installed: $(which anx)"
echo "✓ Version:   $(anx version)"
echo ""
echo "Next steps:"
echo "  1. Set your provider API key:  export OPENAI_API_KEY=sk-..."
echo "  2. Start the gateway:          anx-gateway &"
echo "  3. Test it:                    anx health"
echo ""
echo "Documentation: https://github.com/rachidSabah/codingghosts/blob/main/docs/README.md"
