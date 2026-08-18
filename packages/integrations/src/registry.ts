
import { AiderIntegration } from './adapters/aider.js';
import { ClaudeCodeIntegration } from './adapters/claude-code.js';
import { ClineIntegration } from './adapters/cline.js';
import { CodexCliIntegration } from './adapters/codex-cli.js';
import { ContinueIntegration } from './adapters/continue.js';
import { CursorIntegration } from './adapters/cursor.js';
import { DeepSeekHarnessIntegration } from './adapters/deepseek-harness.js';
import { EmacsIntegration } from './adapters/emacs.js';
import { GeminiCliIntegration } from './adapters/gemini-cli.js';
import { HermesCliIntegration } from './adapters/hermes-cli.js';
import { JetBrainsIntegration } from './adapters/jetbrains.js';
import { NeovimIntegration } from './adapters/neovim.js';
import {
  OpenCodeIntegration,
  OpenCodeGoIntegration,
  OpenCodeZenIntegration,
} from './adapters/opencode.js';
import { OpenHandsIntegration } from './adapters/openhands.js';
import { QwenCodeIntegration } from './adapters/qwen-code.js';
import { RooCodeIntegration } from './adapters/roo-code.js';
import { VsCodeIntegration } from './adapters/vscode.js';
import { ZedIntegration } from './adapters/zed.js';
import type { IntegrationAdapter } from './contract.js';

/**
 * All built-in integrations, in display order. This is the canonical list
 * referenced by the CLI's `anx integrations list`.
 */
export const BUILTIN_INTEGRATIONS: IntegrationAdapter[] = [
  // ─── CLI tools ───────────────────────────────────────────────────────────
  new ClaudeCodeIntegration(),
  new CodexCliIntegration(),
  new GeminiCliIntegration(),
  new QwenCodeIntegration(),
  new HermesCliIntegration(),
  new OpenCodeIntegration(),
  new OpenCodeGoIntegration(),
  new OpenCodeZenIntegration(),
  new AiderIntegration(),
  new OpenHandsIntegration(),
  new DeepSeekHarnessIntegration(),

  // ─── Editors ─────────────────────────────────────────────────────────────
  new CursorIntegration(),
  new ContinueIntegration(),
  new ClineIntegration(),
  new RooCodeIntegration(),
  new ZedIntegration(),
  new NeovimIntegration(),
  new EmacsIntegration(),

  // ─── IDEs ────────────────────────────────────────────────────────────────
  new VsCodeIntegration(),
  new JetBrainsIntegration(),
];

/**
 * Map of integration id → adapter, for O(1) lookup by the CLI.
 */
export function createIntegrationRegistry(): Map<string, IntegrationAdapter> {
  const m = new Map<string, IntegrationAdapter>();
  for (const i of BUILTIN_INTEGRATIONS) m.set(i.id, i);
  return m;
}

/**
 * All integration IDs — useful for typed CLI args.
 */
export const INTEGRATION_IDS: readonly string[] = BUILTIN_INTEGRATIONS.map((i) => i.id);
export type IntegrationId = string;
