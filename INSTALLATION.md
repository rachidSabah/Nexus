# Installation

Nexus is a local-first Universal AI Coding-Agent Gateway. You install it once;
it then serves a single local endpoint that all your coding agents point at.

## One-line install

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/rachidSabah/Nexus/main/scripts/install.ps1 | iex
```

### Linux / WSL / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/rachidSabah/Nexus/main/scripts/install.sh | bash
```

Both installers verify Node.js (>= 20), install the `nexus-gateway` CLI, create
`~/.agent-nexus`, generate a local config + vault key, start the gateway, and
print the dashboard URL. They do **not** overwrite existing credentials and do
**not** silently install unrelated software.

## From source

```bash
git clone https://github.com/rachidSabah/Nexus.git
cd codingghosts
pnpm install
pnpm build
node apps/gateway/dist/bin.js      # gateway on :8787
pnpm --filter @anx/dashboard dev   # dashboard on :3000
```

## First run

1. Open `http://127.0.0.1:8787/dashboard`.
2. **Add a provider** → enter its API key (stored encrypted in the local vault).
3. Nexus **discovers models dynamically** — no manual model list, no restart.
4. Point your coding agent at `http://127.0.0.1:8787/v1` as its base URL.
5. Pick a routing policy (e.g. `nexus/best-coding`) and start coding.

## Uninstall

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/rachidSabah/Nexus/main/scripts/uninstall.ps1 | iex
```

### Linux / WSL / macOS (bash)

```bash
curl -fsSL https://raw.githubusercontent.com/rachidSabah/Nexus/main/scripts/uninstall.sh | bash
```

The uninstaller removes the CLI and local config but **never deletes your
vault/credentials** unless you explicitly pass `-RemoveData`.

## Requirements

- Node.js >= 20
- pnpm >= 9 (the source build) **or** just Node.js (the one-line installer)
- Windows 10/11, WSL2 (Ubuntu/Debian), or any Linux/macOS
