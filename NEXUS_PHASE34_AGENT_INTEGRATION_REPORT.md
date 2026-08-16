# NEXUS PHASE 34 — MACHINE AGENT INTEGRATION REPORT

## 1. Scope & Integration Overview

Agent Nexus supports 18 built-in AI coding agents and IDE adapters via `@anx/integrations` and `@anx/core`. Phase 34 guarantees cross-platform shell compatibility, resilient routing semantics, and truthful runtime representation across CLI and GUI surfaces.

---

## 2. Supported Adapters & Cross-Platform Buckle Matrix

| Agent ID | Display Name | Protocol | PowerShell Command | CMD Command | Bash/WSL/macOS Command |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `claude-code` | Claude Code | Anthropic Messages | `$env:ANTHROPIC_BASE_URL="http://127.0.0.1:8787"` | `set ANTHROPIC_BASE_URL=http://127.0.0.1:8787` | `export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"` |
| `codex-cli` | Codex CLI | OpenAI Chat | `$env:OPENAI_BASE_URL="http://127.0.0.1:8787/v1"` | `set OPENAI_BASE_URL=http://127.0.0.1:8787/v1` | `export OPENAI_BASE_URL="http://127.0.0.1:8787/v1"` |
| `gemini-cli` | Gemini CLI | OpenAI / Google | `$env:OPENAI_BASE_URL="http://127.0.0.1:8787/v1"` | `set OPENAI_BASE_URL=http://127.0.0.1:8787/v1` | `export OPENAI_BASE_URL="http://127.0.0.1:8787/v1"` |
| `hermes-cli` | Hermes CLI | OpenAI Chat | `$env:OPENAI_BASE_URL="http://127.0.0.1:8787/v1"` | `set OPENAI_BASE_URL=http://127.0.0.1:8787/v1` | `export OPENAI_BASE_URL="http://127.0.0.1:8787/v1"` |
| `opencode` | OpenCode | OpenAI Chat | `$env:OPENAI_BASE_URL="http://127.0.0.1:8787/v1"` | `set OPENAI_BASE_URL=http://127.0.0.1:8787/v1` | `export OPENAI_BASE_URL="http://127.0.0.1:8787/v1"` |
| `cursor` | Cursor IDE | OpenAI Proxy | Set OpenAI Base URL to `http://127.0.0.1:8787/v1` in Settings | Set OpenAI Base URL to `http://127.0.0.1:8787/v1` in Settings | Set OpenAI Base URL to `http://127.0.0.1:8787/v1` in Settings |
| `cline` | Cline | Anthropic / OpenAI | Configure Custom Endpoint `http://127.0.0.1:8787` | Configure Custom Endpoint `http://127.0.0.1:8787` | Configure Custom Endpoint `http://127.0.0.1:8787` |
| `roo-code` | Roo Code | Anthropic / OpenAI | Configure Custom Endpoint `http://127.0.0.1:8787` | Configure Custom Endpoint `http://127.0.0.1:8787` | Configure Custom Endpoint `http://127.0.0.1:8787` |
| `continue` | Continue | OpenAI / Ollama | Base URL: `http://127.0.0.1:8787/v1` | Base URL: `http://127.0.0.1:8787/v1` | Base URL: `http://127.0.0.1:8787/v1` |
| `openhands` | OpenHands | OpenAI Chat | LLM_BASE_URL=`http://127.0.0.1:8787/v1` | LLM_BASE_URL=`http://127.0.0.1:8787/v1` | LLM_BASE_URL=`http://127.0.0.1:8787/v1` |
| `aider` | Aider | OpenAI Chat | `$env:OPENAI_API_BASE="http://127.0.0.1:8787/v1"` | `set OPENAI_API_BASE=http://127.0.0.1:8787/v1` | `export OPENAI_API_BASE="http://127.0.0.1:8787/v1"` |
| `zed` | Zed Editor | Anthropic / OpenAI | Configure `api_url: "http://127.0.0.1:8787"` in `settings.json` | Configure `api_url: "http://127.0.0.1:8787"` in `settings.json` | Configure `api_url: "http://127.0.0.1:8787"` in `settings.json` |
| `vscode` | VS Code Extension | OpenAI Chat | Settings -> `agentNexus.endpoint: "http://127.0.0.1:8787/v1"` | Settings -> `agentNexus.endpoint: "http://127.0.0.1:8787/v1"` | Settings -> `agentNexus.endpoint: "http://127.0.0.1:8787/v1"` |
| `jetbrains` | JetBrains IDEs | OpenAI Chat | Settings -> AI Assistant -> Custom URL `http://127.0.0.1:8787/v1` | Settings -> AI Assistant -> Custom URL `http://127.0.0.1:8787/v1` | Settings -> AI Assistant -> Custom URL `http://127.0.0.1:8787/v1` |
| `neovim` | Neovim (Avante) | OpenAI Chat | `endpoint = "http://127.0.0.1:8787/v1"` | `endpoint = "http://127.0.0.1:8787/v1"` | `endpoint = "http://127.0.0.1:8787/v1"` |
| `emacs` | Emacs (gptel) | OpenAI Chat | `(setq gptel-host "127.0.0.1:8787")` | `(setq gptel-host "127.0.0.1:8787")` | `(setq gptel-host "127.0.0.1:8787")` |
| `opencode-go`| OpenCode Go | OpenAI Chat | `$env:OPENAI_BASE_URL="http://127.0.0.1:8787/v1"` | `set OPENAI_BASE_URL=http://127.0.0.1:8787/v1` | `export OPENAI_BASE_URL="http://127.0.0.1:8787/v1"` |
| `opencode-zen`| OpenCode Zen | OpenAI Chat | `$env:OPENAI_BASE_URL="http://127.0.0.1:8787/v1"` | `set OPENAI_BASE_URL=http://127.0.0.1:8787/v1` | `export OPENAI_BASE_URL="http://127.0.0.1:8787/v1"` |

---

## 3. Dynamic Model Fabric Reflection

Rather than hardcoding static models for each agent card, agents display their connection to the **Dynamic Nexus Model Fabric**, showing the total live discovered models across providers with automatic failover and circuit breaking.
