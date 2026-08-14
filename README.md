# Nexus

> **Universal AI Coding-Agent Gateway**

A local-first AI proxy and model-routing fabric that connects your coding
agents — Claude Code, Codex, OpenCode, Hermes, Gemini CLI, Qwen Code, Kimi
Code, Aider, Cline, Roo Code, and any other OpenAI/Anthropic-compatible agent —
to **multiple AI providers, multiple API keys, and a dynamically discovered
model catalog** with automatic failover and token optimization.

```
                 CODING AGENTS  (Claude Code, Codex, OpenCode, Hermes, Gemini CLI, …)
                       │
                NEXUS GATEWAY   (one local endpoint: http://127.0.0.1:8787)
                       │
               MODEL FABRIC
                       │
               ROUTING ENGINE
                       │
          MULTIPLE PROVIDERS / KEYS
                       │
                    MODELS
```

Nexus is the **control plane**, not another coding agent. You point your agents
at a single local endpoint; Nexus routes each request to the best available,
healthy, cost-appropriate model across all your configured providers — and
surfaces every discovered model to every compatible agent automatically.

---

## Why Nexus?

- **Multiple subscriptions / provider rate limits** — Nexus fans load across
  every key and provider you configure, with automatic key rotation and cooldown.
- **Expensive models** — route routine work to free/cheap models and only spend
  premium tokens when a task needs them.
- **API key limits** — register many keys per provider; Nexus rotates through
  them and isolates failures.
- **Manually changing models** — alias policies (`nexus/free`, `nexus/best-coding`,
  `nexus/reasoning`, …) pick the best healthy candidate for you and re-route on
  failure.
- **Coding-agent incompatibility** — Nexus projects each provider's catalog into
  the protocol your agent expects (OpenAI-compatible or Anthropic Messages).
- **Token waste** — prompt compression, tool-schema normalization, and
  context budgeting run in the gateway and report measured savings.

---

## Feature matrix

| Feature | Nexus |
|---|---|
| Dynamic model discovery (no hardcoded catalog) | ✅ |
| Multi-provider | ✅ |
| Multi-key rotation | ✅ |
| Automatic failover (model → key → provider) | ✅ |
| Free model routing | ✅ |
| Cheap model routing | ✅ |
| Coding model routing | ✅ |
| Reasoning routing | ✅ |
| Vision routing | ✅ |
| Long-context routing | ✅ |
| Tool calling | ✅ |
| Streaming (SSE pass-through) | ✅ |
| Claude Code (live-verified) | ✅ |
| Codex (live-verified) | ✅ |
| OpenCode (detected / building agent) | ✅ |
| Hermes (detected / building agent) | ✅ |
| Gemini CLI (detected) | ✅ |
| Token optimization | ✅ |
| Model catalog synchronization (delta + ETag) | ✅ |
| Runtime agent configuration | ✅ |
| Dashboard | ✅ |
| Windows | ✅ |
| WSL | ✅ |

> "Live-verified" means the agent was detected on this machine and a real
> request through Nexus succeeded. "Detected" means the agent binary is present
> but live verification has not been run in this environment.

---

## Quick start

### Windows

```powershell
irm https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.ps1 | iex
```

### Linux / WSL / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.sh | bash
```

> Replace `rachidSabah/codingghosts` with the real repository slug once published.
> Both installers verify Node.js, install Nexus, create `~/.agent-nexus`,
> generate a local config, start the gateway, and print the dashboard URL.

### From source

```bash
git clone https://github.com/rachidSabah/codingghosts.git
cd <REPO>
pnpm install
pnpm build
# start the gateway (default port 8787)
node apps/gateway/dist/bin.js
# start the dashboard (default port 3000)
pnpm --filter @anx/dashboard dev
```

Open the dashboard at `http://127.0.0.1:8787/dashboard`.

---

## First run

1. The dashboard prints the gateway URL (`http://127.0.0.1:8787`) and the
   dashboard URL.
2. **Add a provider** → enter the API key (stored encrypted in the local vault).
3. Nexus **discovers models dynamically** and updates the catalog immediately
   (no restart, no hardcoded model list).
4. **Configure your coding agent** to use `http://127.0.0.1:8787/v1` as its
   base URL.
5. Select a routing policy (e.g. `nexus/best-coding`) and start coding.

---

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full diagram and a
description of each subsystem: protocol adapters, Model Fabric, Routing Engine,
Key Registry, Provider/Model failover, catalog synchronization, token
optimization, and observability.

---

## Documentation

- [Architecture](docs/architecture.md)
- [Provider onboarding](docs/PROVIDERS.md)
- [API reference](docs/API.md)
- [Workflow fabric](docs/WORKFLOW.md)
- [Security policy](SECURITY.md)

## CLI usage

The `nexus` CLI (package `nexus-gateway`, binary `anx`) provides:

```bash
anx health                 # gateway health
anx doctor                 # diagnostics (connectivity, providers, models)
anx config init            # write a local .anxrc.json (baseUrl + apiKey)
anx providers list         # list configured providers
anx integrations list      # list supported coding agents
anx integrations install claude-code   # configure an agent for Nexus
anx integrations verify claude-code    # live-verify an agent
anx chat --model nexus/best-coding --message "hello"   # one-shot chat via Nexus
anx version
```

> Note: there is currently no `nexus update` command; upgrade by re-running the
> install script (it preserves `~/.agent-nexus` config and vault) or pulling the
> latest source and rebuilding.

---

## License

MIT — see [LICENSE](LICENSE).
