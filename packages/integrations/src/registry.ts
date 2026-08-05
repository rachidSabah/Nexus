import type { IntegrationAdapter } from './contract.js';

import { ClaudeCodeIntegration } from './adapters/claude-code.js';
import { CodexCliIntegration } from './adapters/codex-cli.js';
import { GeminiCliIntegration } from './adapters/gemini-cli.js';
import { HermesCliIntegration } from './adapters/hermes-cli.js';
import {
  OpenCodeIntegration,
  OpenCodeGoIntegration,
  OpenCodeZenIntegration,
} from './adapters/opencode.js';
import { CursorIntegration } from './adapters/cursor.js';
import { ContinueIntegration } from './adapters/continue.js';
import { ClineIntegration } from './adapters/cline.js';
import { RooCodeIntegration } from './adapters/roo-code.js';
import { OpenHandsIntegration } from './adapters/openhands.js';
import { AiderIntegration } from './adapters/aider.js';
import { ZedIntegration } from './adapters/zed.js';
import { VsCodeIntegration } from './adapters/vscode.js';
import { JetBrainsIntegration } from './adapters/jetbrains.js';
import { NeovimIntegration } from './adapters/neovim.js';
import { EmacsIntegration } from './adapters/emacs.js';

/**
 * All built-in integrations, in display order. This is the canonical list
 * referenced by the CLI's `anx integrations list`.
 */
export const BUILTIN_INTEGRATIONS: IntegrationAdapter[] = [
  // ─── CLI tools ───────────────────────────────────────────────────────────
  new ClaudeCodeIntegration(),
  new CodexCliIntegration(),
  new GeminiCliIntegration(),
  new HermesCliIntegration(),
  new OpenCodeIntegration(),
  new OpenCodeGoIntegration(),
  new OpenCodeZenIntegration(),
  new AiderIntegration(),
  new OpenHandsIntegration(),

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
 * All integration IDs as a const tuple — useful for typed CLI args.
 */
export const INTEGRATION_IDS = BUILTIN_INTEGRATIONS.map((i) => i.id) as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];
