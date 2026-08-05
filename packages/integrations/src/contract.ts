import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Native Integration Contract
 *
 * Every supported AI tool (Claude Code, Cursor, OpenCode, OpenCode Go,
 * OpenCode Zen, Cline, Roo Code, Continue, OpenHands, Aider, Zed, VS Code,
 * JetBrains, Neovim, Emacs, Codex CLI, Gemini CLI, Hermes CLI) implements
 * this interface.
 *
 * The contract is deliberately small:
 *   - detect(): is the tool installed on this machine?
 *   - install(): write the config files / env vars needed to point it at the gateway
 *   - uninstall(): remove those config files / env vars
 *   - verify(): test the setup (HTTP ping through the tool's lens if possible)
 *   - status(): human-readable summary
 *
 * Implementations are pure — they never reach for the network on their own
 * during `install()`. `verify()` may make a single HTTP request to the
 * gateway's /health endpoint.
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface IntegrationContext {
  /** Gateway base URL, e.g. http://localhost:8787 */
  readonly gatewayUrl: string;
  /** Gateway API key (may be empty if auth is disabled) */
  readonly apiKey?: string;
  /** Default model alias to configure the tool with */
  readonly defaultModel: string;
  /** Dry-run mode: emit what would happen but write nothing */
  readonly dryRun?: boolean;
  /** Force overwrite of existing config */
  readonly force?: boolean;
  /** Optional custom home dir (for testing) */
  readonly homeDir?: string;
}

export interface IntegrationStatus {
  readonly id: string;
  readonly displayName: string;
  readonly installed: boolean;
  readonly configured: boolean;
  readonly configPath?: string;
  readonly details?: string;
}

export interface IntegrationAdapter {
  /** Stable identifier, e.g. "claude-code" */
  readonly id: string;
  /** Human-friendly name, e.g. "Claude Code" */
  readonly displayName: string;
  /** One-line description */
  readonly description: string;
  /** Category for grouping in CLI output */
  readonly category: 'cli' | 'editor' | 'ide' | 'agent';
  /** Project home page (for `anx integrations info <id>`) */
  readonly homepage?: string;

  /**
   * Is the tool installed on this machine? Should be fast and side-effect free.
   * Implementations typically check for a binary on PATH or a config dir.
   */
  detect(ctx: IntegrationContext): Promise<boolean>;

  /**
   * Configure the tool to use the gateway. Should be idempotent — running
   * twice produces the same result. Should not throw if the tool isn't
   * installed (callers should `detect()` first); instead return a result
   * with `ok: false` and a helpful message.
   */
  install(ctx: IntegrationContext): Promise<IntegrationResult>;

  /**
   * Remove the gateway configuration from the tool. Should preserve any
   * other settings the user had.
   */
  uninstall(ctx: IntegrationContext): Promise<IntegrationResult>;

  /**
   * Verify the tool can reach the gateway. May make an HTTP request to
   * `${gatewayUrl}/health`.
   */
  verify(ctx: IntegrationContext): Promise<IntegrationResult>;

  /**
   * Return a human-readable status. Used by `anx integrations list`.
   */
  status(ctx: IntegrationContext): Promise<IntegrationStatus>;
}

export interface IntegrationResult {
  readonly ok: boolean;
  readonly message: string;
  readonly actions: readonly string[];
  readonly errors?: readonly string[];
}

// ─── Helpers shared by all adapters ─────────────────────────────────────────

export function home(ctx: IntegrationContext): string {
  return ctx.homeDir ?? homedir();
}

export function path(...segments: string[]): string {
  return join(...segments);
}

export function ok(message: string, actions: readonly string[] = []): IntegrationResult {
  return { ok: true, message, actions };
}

export function fail(message: string, errors: readonly string[] = [], actions: readonly string[] = []): IntegrationResult {
  return { ok: false, message, actions, errors };
}

/**
 * All registered integrations, keyed by id. Populated by `./registry.ts`.
 */
export type IntegrationRegistry = Map<string, IntegrationAdapter>;
