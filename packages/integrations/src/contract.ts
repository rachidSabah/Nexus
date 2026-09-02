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
  /** Endpoint the agent's config currently points at (raw, e.g. http://localhost:8787/v1). */
  readonly configuredEndpoint?: string;
  /** The Nexus gateway endpoint the integration expects (ctx.gatewayUrl + /v1). */
  readonly expectedEndpoint?: string;
  /** True when configuredEndpoint differs from expectedEndpoint (normalized). Surfaces a CONFIGURATION MISMATCH in the UI. */
  readonly mismatch?: boolean;
  /** Resolved executable path (best-effort). */
  readonly executable?: string;
  /** Detected version (best-effort; may be undefined). */
  readonly version?: string;
  /** Coarse health for the control-center card. */
  readonly health?: 'unknown' | 'healthy' | 'mismatch' | 'not-configured';
  readonly installRecipe?: {
    readonly type: 'npm' | 'pip' | 'binary' | 'manual';
    readonly packageName?: string;
    readonly guideUrl?: string;
    /** Extra args appended to the install command (e.g. pip dependency pins
     *  to resolve an upstream ResolutionImpossible for a specific package). */
    readonly pipConstraints?: readonly string[];
  };
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

  /**
   * Declare which lifecycle operations this adapter supports. Used by the
   * dashboard to show only the buttons the backend can actually execute.
   * Defaults are provided by `BaseIntegration` (start/stop/restart = false
   * unless the adapter overrides `getLaunchSpec`).
   */
  capabilities(ctx: IntegrationContext): Promise<IntegrationCapabilities>;

  /**
   * Return the normalized launch specification for this agent, or `null` if
   * the adapter does not (yet) support process management for it. The generic
   * `IntegrationProcessManager` executes this spec — it never receives an
   * executable/command/args from the dashboard request.
   *
   * Adapters with `getLaunchSpec` returning a non-null spec automatically
   * advertise `supportsStart/Stop/Restart: true` via `BaseIntegration`.
   */
  getLaunchSpec(ctx: IntegrationContext): Promise<LaunchSpec | null>;

  /**
   * Start the agent process using the adapter's launch spec. Delegates to the
   * shared `IntegrationProcessManager`. A no-op (with a clear result) when the
   * adapter does not provide a launch spec.
   */
  start(ctx: IntegrationContext): Promise<IntegrationResult>;

  /**
   * Stop the agent process. Only terminates a PID the manager itself launched
   * for this integration id — never an unrelated process the user started.
   */
  stop(ctx: IntegrationContext): Promise<IntegrationResult>;

  /**
   * Restart the agent process: stop (if running) then start. Restarting one
   * integration never affects any other integration's process.
   */
  restart(ctx: IntegrationContext): Promise<IntegrationResult>;

  /**
   * Return the current runtime state (pid, running, health) tracked by the
   * manager for this integration, or a default "not running" state.
   */
  runtime(ctx: IntegrationContext): Promise<ProcessState>;
}

export interface IntegrationResult {
  readonly ok: boolean;
  readonly message: string;
  readonly actions: readonly string[];
  readonly errors?: readonly string[];
}

// ─── Lifecycle / process-management extensions ──────────────────────────────
//
// The integration layer is also a UNIVERSAL CODING AGENT LIFECYCLE MANAGER.
// Each adapter may declare how to launch its agent (a normalized `LaunchSpec`)
// and which lifecycle operations it supports. The generic `IntegrationProcessManager`
// owns start/stop/restart + per-agent PID tracking and knows NOTHING about any
// specific agent executable — it only spawns the spec an adapter returns.

/**
 * Normalized launch specification. The adapter supplies this; the generic
 * process manager executes it. Never constructed from untrusted request input
 * (see security: the dashboard sends only `integrationId`).
 */
export interface LaunchSpec {
  /** Absolute or PATH-resolvable executable, e.g. `claude` or `C:\...\claude.exe`. */
  readonly executable: string;
  /** Arguments passed to the executable. */
  readonly args: readonly string[];
  /** Working directory for the spawned process. */
  readonly cwd?: string;
  /** Environment variables for the spawned process (merged over process.env). */
  readonly env: Readonly<Record<string, string>>;
  /**
   * When true, the manager spawns the executable inside a new interactive
   * shell window (Windows `cmd /k`, macOS/Linux `xterm`/`gnome-terminal`).
   * Used for interactive CLI agents that need a TTY. When false, the process
   * is spawned headless/detached in the background.
   */
  readonly interactive: boolean;
  /** Human-readable command, for logging/display only. */
  readonly display?: string;
  /**
   * Optional web UI URL. When set, the process manager opens it in the
   * OS default browser right after the process starts (cross-platform), so
   * web-UI agents (e.g. DeepSeek Harness `dsh web`) auto-surface instead of
   * requiring the user to manually navigate.
   */
  readonly webUrl?: string;
}

/**
 * Per-agent runtime state tracked by the generic manager.
 * `pid` is only ever a PID the manager itself launched (never an unrelated
 * process the user started manually).
 */
export interface ProcessState {
  readonly id: string;
  readonly running: boolean;
  readonly pid?: number;
  readonly executable?: string;
  readonly args?: readonly string[];
  readonly startedAt?: string;
  readonly gatewayTarget?: string;
  readonly health: 'unknown' | 'healthy' | 'unhealthy' | 'exited';
  readonly exitCode?: number;
  readonly lastError?: string;
}

/**
 * Declares which lifecycle operations an adapter supports, so the UI can
 * show only buttons the backend can actually execute (no dead buttons).
 */
export interface IntegrationCapabilities {
  readonly supportsDetect: true;
  readonly supportsInstall: boolean;
  readonly supportsUninstall: boolean;
  readonly supportsVerify: boolean;
  readonly supportsStart: boolean;
  readonly supportsStop: boolean;
  readonly supportsRestart: boolean;
  /** Whether this adapter can bind the agent's config to the gateway URL. */
  readonly supportsGatewayBinding: boolean;
  /** Whether the agent needs an interactive terminal window. */
  readonly interactive: boolean;
}

export const DEFAULT_CAPABILITIES: IntegrationCapabilities = {
  supportsDetect: true,
  supportsInstall: true,
  supportsUninstall: true,
  supportsVerify: true,
  supportsStart: false,
  supportsStop: false,
  supportsRestart: false,
  supportsGatewayBinding: true,
  interactive: false,
};

export type LifecycleAction = 'start' | 'stop' | 'restart';

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

export function normalizeGatewayUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  if (u.endsWith('/v1')) {
    u = u.slice(0, -3);
  }
  return u;
}

/**
 * True when `model` is a Nexus routing policy / virtual alias (e.g. `nexus/*`,
 * `local/*`, `claude-gw-*`) rather than a concrete agent-native model id.
 *
 * These identifiers resolve dynamically at the gateway (Model Fabric / Alias
 * Registry) and are NOT valid persisted `model` values for most agents — e.g.
 * Claude Code rejects `nexus/auto` on startup with "not a model this version
 * recognizes". Adapters must never pin a routing alias as an agent's model.
 */
export function isNexusRoutingAlias(model: string | undefined): boolean {
  if (!model) return false;
  const m = model.toLowerCase();
  return m.startsWith('nexus/') || m.startsWith('local/') || m.startsWith('claude-gw-');
}

/**
 * Resolve the model that should be persisted for an agent's native config.
 *
 * Universal rule (enforced for EVERY adapter via this single helper):
 *   - A concrete user-selected model (`claude-haiku-4-5`, `gpt-4o`, …) is kept.
 *   - A Nexus routing alias (`nexus/auto`, `local/*`, `claude-gw-*`) is NOT
 *     written — the gateway resolves it at request time. If the existing
 *     config already pins a stale alias, it is dropped so the agent stops
 *     warning on startup.
 *   - When neither a concrete default nor an existing concrete model exists,
 *     returns `undefined` (the adapter omits the model field).
 *
 * This keeps agent-specific configuration semantics INSIDE each adapter (the
 * adapter still chooses which field and format to write); only the *value* is
 * sanitized here, so no agent ever receives a Nexus routing alias as its
 * native model id.
 */
export function resolveModel(
  ctx: IntegrationContext,
  existingModel?: string,
): string | undefined {
  if (ctx.defaultModel && !isNexusRoutingAlias(ctx.defaultModel)) {
    return ctx.defaultModel; // explicit concrete selection wins
  }
  if (existingModel && !isNexusRoutingAlias(existingModel)) {
    return existingModel; // preserve the agent's own concrete selection
  }
  return undefined; // drop stale alias / none
}
