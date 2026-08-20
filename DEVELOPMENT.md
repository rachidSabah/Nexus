# Development

This guide covers building and running Nexus from source. For end-user
installation, see [INSTALLATION.md](INSTALLATION.md).

## Prerequisites

- **Node.js** >= 20 (verify: `node --version`)
- **pnpm** >= 9 (`npm i -g pnpm` or via Corepack)
- A provider API key for model discovery (optional for local development; the
  gateway runs without keys and discovers models once a key is added)

## Setup

```bash
git clone https://github.com/rachidSabah/Nexus.git
cd codingghosts
pnpm install
pnpm build
```

## Running

```bash
# Gateway (default port 8787)
node apps/gateway/dist/bin.js

# Dashboard (default port 3000)
pnpm --filter @anx/dashboard dev
```

Open the dashboard at `http://127.0.0.1:8787/dashboard` (the gateway also serves
a reverse-proxied dashboard).

## Configuration

Configuration is environment-variable based. Copy `.env.example` to `.env` and
fill in what you need:

```bash
cp .env.example .env
```

Common variables:

| Variable | Purpose |
|---|---|
| `PORT` | Gateway port (default `8787`) |
| `NODE_ENV` | `development` / `production` |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, … | Provider credentials (stored encrypted in the vault) |
| `AGENT_NEXUS_VAULT_KEY` | 32-byte hex master key for the encrypted credential vault |
| `ANX_JWT_SECRET` | JWT signing secret |
| `ANX_ADMIN_API_KEY` | Dashboard admin key |
| `HTTP_PROXY` / `HTTPS_PROXY` | Outbound proxy for provider requests |

## Useful scripts

| Command | What it does |
|---|---|
| `pnpm build` | Build all packages and apps |
| `pnpm typecheck` | Type-check every workspace |
| `pnpm test` | Run the full test suite |
| `pnpm lint` | Lint all workspaces |
| `pnpm --filter @anx/gateway dev` | Run the gateway in watch mode |
| `pnpm --filter @anx/dashboard dev` | Run the dashboard in watch mode |

## Testing notes

- Tests must run on a clean machine with **no local `.env`**, **no real keys**,
  and **no local vault**. Provider-dependent paths use in-memory test adapters.
- CI enforces install → typecheck → test → build → lint, plus a gitleaks secret
  scan.

## Project layout

See [ARCHITECTURE.md](ARCHITECTURE.md) and [`docs/architecture.md`](docs/architecture.md).
