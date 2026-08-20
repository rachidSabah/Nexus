# 03 — Quickstart & Installation

[← Previous: Architecture & Mental Model](02-architecture-and-mental-model.md) | [Index](01-introduction-and-overview.md) | [Next: Universal Provider Fabric →](04-universal-provider-fabric.md)

---

## 1-Minute Automated Install

Nexus provides verified one-line installation scripts for Windows, Linux, and macOS.

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/rachidSabah/Nexus/main/install.ps1 | iex
```

### Linux & macOS (Bash)

```bash
curl -fsSL https://raw.githubusercontent.com/rachidSabah/Nexus/main/install.sh | bash
```

---

## Manual Installation from Source

### Prerequisites
- **Node.js**: v20.0.0 or higher (Node 22+ recommended for native SQLite)
- **pnpm**: v9.0.0 or higher
- **Git**

### Step-by-Step Setup

```bash
# 1. Clone the repository
git clone https://github.com/rachidSabah/Nexus.git
cd codingghosts

# 2. Install monorepo dependencies
pnpm install

# 3. Build all workspace packages
pnpm build

# 4. Start the Nexus Gateway
pnpm --filter @anx/gateway start
```

By default, the gateway listens on `http://127.0.0.1:8787`.

---

## Verification & Health Check

Verify your installation by issuing an HTTP GET to the readiness endpoint:

```bash
curl http://127.0.0.1:8787/ready
```

Expected response:
```json
{
  "ready": true,
  "status": "ready",
  "version": "0.5.0",
  "catalogVersion": 1,
  "subsystems": {
    "gateway": true,
    "modelRegistry": true,
    "routing": true,
    "keySubsystem": true,
    "catalog": true
  }
}
```

---

## Connecting Your First Coding Agent

### Claude Code

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
export ANTHROPIC_AUTH_TOKEN="nexus-local"
claude
```

### OpenAI / Cursor / Windsurf / Aider

```bash
export OPENAI_BASE_URL="http://127.0.0.1:8787/v1"
export OPENAI_API_KEY="nexus-local"
```

---

[← Previous: Architecture & Mental Model](02-architecture-and-mental-model.md) | [Index](01-introduction-and-overview.md) | [Next: Universal Provider Fabric →](04-universal-provider-fabric.md)
