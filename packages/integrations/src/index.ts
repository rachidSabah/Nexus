/**
 * @anx/integrations — native integrations for Agent Nexus Gateway.
 *
 * Each integration auto-configures an AI tool (Claude Code, Cursor, OpenCode,
 * OpenCode Go, OpenCode Zen, Cline, Roo Code, Continue, OpenHands, Aider,
 * Zed, VS Code, JetBrains, Neovim, Emacs, Codex CLI, Gemini CLI, Hermes CLI)
 * to route its requests through the gateway.
 *
 * The CLI surfaces these via:
 *   anx integrations list
 *   anx integrations install <id>
 *   anx integrations uninstall <id>
 *   anx integrations verify <id>
 *   anx integrations install --all
 */

export {
  type IntegrationAdapter,
  type IntegrationContext,
  type IntegrationResult,
  type IntegrationStatus,
  type IntegrationCapabilities,
  type LaunchSpec,
  type ProcessState,
  type LifecycleAction,
  normalizeGatewayUrl,
  isNexusRoutingAlias,
  resolveModel,
  ok,
  fail,
  home,
  DEFAULT_CAPABILITIES,
} from './contract.js';

export { BaseIntegration, jsonString, maskSecret } from './base.js';
export {
  IntegrationProcessManager,
  integrationProcessManager,
} from './process-manager.js';

export {
  BUILTIN_INTEGRATIONS,
  BUILTIN_INTEGRATIONS_COUNT,
  INTEGRATION_IDS,
  createIntegrationRegistry,
  type IntegrationId,
} from './registry.js';

// ─── Individual adapters (re-exported for direct use) ───────────────────────
export { ClaudeCodeIntegration } from './adapters/claude-code.js';
export { CodexCliIntegration } from './adapters/codex-cli.js';
export { HermesCliIntegration } from './adapters/hermes-cli.js';
export {
  OpenCodeIntegration,
  OpenCodeGoIntegration,
} from './adapters/opencode.js';
export { QwenCodeIntegration } from './adapters/qwen-code.js';
export { CursorIntegration } from './adapters/cursor.js';
export { ContinueIntegration } from './adapters/continue.js';
export { ClineIntegration } from './adapters/cline.js';
export { RooCodeIntegration } from './adapters/roo-code.js';
export { OpenHandsIntegration } from './adapters/openhands.js';
export { AiderIntegration } from './adapters/aider.js';
export { ZedIntegration } from './adapters/zed.js';
export { VsCodeIntegration } from './adapters/vscode.js';
export { JetBrainsIntegration } from './adapters/jetbrains.js';
export { NeovimIntegration } from './adapters/neovim.js';
export { EmacsIntegration } from './adapters/emacs.js';
export { DeepSeekHarnessIntegration } from './adapters/deepseek-harness.js';

export {
  TRUSTED_AGENT_CATALOG,
  getAgentCatalogEntry,
  type AgentCatalogEntry,
} from './catalog.js';

export const INTEGRATIONS_VERSION = '0.1.0';

