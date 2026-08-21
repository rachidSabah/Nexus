# NEXUS AGENT & IDE HARNESS LINK INTEGRITY AUDIT

**Target Page**: `One-Click Agent & IDE Harness` (`/integrations`)  
**Component**: `apps/dashboard/src/app/integrations/page.tsx`  
**Registry Backend**: `@anx/integrations` (`packages/integrations`)  
**Gateway Endpoint**: `GET /v1/integrations`

---

## 1. Executive Summary & Inventory

An exhaustive audit was performed across all 18 built-in agent harness integrations, external documentation links, CLI installation commands, and internal dashboard navigation routes.

### Integrations Audited (18 Total)

| Category | Integration ID | Display Name | Official Documentation Target | Command Syntax | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **CLI** | `claude-code` | Claude Code | `https://docs.anthropic.com/en/docs/claude-code` | `anx integrations install claude-code` | Verified (Valid HTTPS) |
| **CLI** | `codex-cli` | Codex CLI | `https://github.com/openai/codex` | `anx integrations install codex-cli` | Verified (Valid HTTPS) |
| **CLI** | `gemini-cli` | Gemini CLI | `https://github.com/google-gemini/gemini-cli` | `anx integrations install gemini-cli` | Verified (Valid HTTPS) |
| **CLI** | `hermes-cli` | Hermes CLI | `https://github.com/NousResearch/hermes-cli` | `anx integrations install hermes-cli` | Verified (Valid HTTPS) |
| **CLI** | `opencode` | OpenCode | `https://github.com/sst/opencode` | `anx integrations install opencode` | Verified (Valid HTTPS) |
| **CLI** | `opencode-go` | OpenCode Go | `https://github.com/opencode-ai/opencode` | `anx integrations install opencode-go` | Verified (Valid HTTPS) |
| **CLI** | `opencode-zen` | OpenCode Zen | `https://github.com/opencode-zen/opencode-zen` | `anx integrations install opencode-zen` | Verified (Valid HTTPS) |
| **CLI** | `aider` | Aider | `https://github.com/Aider-AI/aider` | `anx integrations install aider` | Verified (Valid HTTPS) |
| **Agent** | `openhands` | OpenHands | `https://github.com/All-Hands-AI/OpenHands` | `anx integrations install openhands` | Verified (Valid HTTPS) |
| **Editor** | `cursor` | Cursor | `https://cursor.sh` | `anx integrations install cursor` | Verified (Valid HTTPS) |
| **Editor** | `continue` | Continue | `https://www.continue.dev` | `anx integrations install continue` | Verified (Valid HTTPS) |
| **Editor** | `cline` | Cline | `https://github.com/cline/cline` | `anx integrations install cline` | Verified (Valid HTTPS) |
| **Editor** | `roo-code` | Roo Code | `https://github.com/RooCodeInc/Roo-Code` | `anx integrations install roo-code` | Verified (Valid HTTPS) |
| **Editor** | `zed` | Zed | `https://zed.dev` | `anx integrations install zed` | Verified (Valid HTTPS) |
| **Editor** | `neovim` | Neovim | `https://neovim.io` | `anx integrations install neovim` | Verified (Valid HTTPS) |
| **Editor** | `emacs` | Emacs | `https://www.gnu.org/software/emacs/` | `anx integrations install emacs` | Verified (Valid HTTPS) |
| **IDE** | `vscode` | VS Code | `https://code.visualstudio.com` | `anx integrations install vscode` | Verified (Valid HTTPS) |
| **IDE** | `jetbrains` | JetBrains IDEs | `https://www.jetbrains.com` | `anx integrations install jetbrains` | Verified (Valid HTTPS) |

---

## 2. Identified Deficiencies & Hardening Actions

1. **Dashboard Navigation Gaps**: Added direct header navigation links from `/integrations` to `/agents` (Runtime Agent Matrix) and `/router-studio` (Router Studio).
2. **Command Clickability Semantics**: Replaced plain static terminal text blocks with an interactive single-click copy-to-clipboard action with visual success feedback (`Check` icon and 2s timeout).
3. **Gateway Public Prefix Whitelisting**: Added `/v1/integrations` to `PUBLIC_PREFIXES` in `apps/gateway/src/server.ts` to prevent authorization blockage during unauthenticated local inspection.
4. **Canonical Gateway WebSocket Protocol**: Replaced stale `ws://localhost:8787/ws` in `apps/dashboard/src/app/requests/page.tsx` with canonical `ws://127.0.0.1:8787/ws`.
