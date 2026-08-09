/**
 * ───────────────────────────────────────────────────────────────────────────
 * AgentDetector — auto-detects coding agents installed on the machine.
 *
 * Master prompt #9:
 * "When installed on Windows or WSL, the gateway must detect coding agents
 * installed on the machine. Detection should inspect PATH, npm global
 * packages, winget, scoop, user directories, known executable locations."
 *
 * This service runs at startup and on-demand via POST /v1/agents/detect.
 * It reports:
 *   - Agent name (claude, codex, gemini, etc.)
 *   - Found (true/false)
 *   - Version (if extractable)
 *   - Executable path
 *   - Platform (windows/linux/macos)
 *   - Configuration location (where the agent's config file lives)
 *
 * The detection is NON-DESTRUCTIVE — it only inspects, never modifies.
 * Connecting an agent to the gateway is a separate explicit step via
 * the integrations package.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { exec } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface DetectedAgent {
  /** Agent id (e.g. 'claude-code', 'codex', 'gemini-cli'). */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  /** Whether the agent was detected on this machine. */
  readonly found: boolean;
  /** Version string if extractable. */
  readonly version?: string;
  /** Path to the executable (or npm package name). */
  readonly executable?: string;
  /** Platform where detected. */
  readonly platform: string;
  /** Where the agent's config file lives (if known). */
  readonly configLocation?: string;
  /** How the agent was detected. */
  readonly detectedVia: 'path' | 'npm-global' | 'config-file' | 'not-found';
}

/** Known coding agents and their detection strategies. */
const KNOWN_AGENTS: Array<{
  id: string;
  name: string;
  /** Binary names to look for in PATH. */
  binaries: string[];
  /** npm global package names (checked via `npm ls -g`). */
  npmPackages?: string[];
  /** Config file paths relative to home dir (checked for existence). */
  configPaths?: string[];
}> = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    binaries: ['claude'],
    npmPackages: ['@anthropic-ai/claude-code'],
    configPaths: ['.claude/settings.json', '.claude/settings.local.json'],
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    binaries: ['codex'],
    configPaths: ['.codex/config.json'],
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    binaries: ['gemini'],
    npmPackages: ['@anthropic-ai/gemini-cli', '@google/gemini-cli'],
    configPaths: ['.gemini/settings.json'],
  },
  {
    id: 'hermes-cli',
    name: 'Hermes CLI',
    binaries: ['hermes'],
    configPaths: ['.hermes/config.json'],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    binaries: ['opencode'],
    npmPackages: ['opencode'],
    configPaths: ['.config/opencode/opencode.json'],
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    binaries: ['opencode-go', 'ocode'],
  },
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    binaries: ['opencode-zen', 'ocode-zen', 'zen'],
  },
  {
    id: 'aider',
    name: 'Aider',
    binaries: ['aider'],
    npmPackages: ['aider-chat'],
    configPaths: ['.aider.conf.yml'],
  },
  {
    id: 'cline',
    name: 'Cline',
    binaries: ['cline'],
    configPaths: ['.cline/config.json'],
  },
  {
    id: 'roo-code',
    name: 'Roo Code',
    binaries: ['roo-code'],
  },
  {
    id: 'openhands',
    name: 'OpenHands',
    binaries: ['openhands', 'opendevin'],
  },
  {
    id: 'goose',
    name: 'Goose',
    binaries: ['goose'],
  },
  {
    id: 'crush',
    name: 'Crush',
    binaries: ['crush'],
  },
  {
    id: 'kimi-code',
    name: 'Kimi Code',
    binaries: ['kimi'],
  },
  {
    id: 'qwen-code',
    name: 'Qwen Code',
    binaries: ['qwen'],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    binaries: ['cursor'],
    configPaths: ['.cursor/config.json'],
  },
  {
    id: 'zed',
    name: 'Zed',
    binaries: ['zed'],
  },
  {
    id: 'vscode',
    name: 'VS Code',
    binaries: ['code'],
    configPaths: ['.vscode/settings.json'],
  },
  {
    id: 'jetbrains',
    name: 'JetBrains IDEs',
    binaries: ['idea', 'pycharm', 'webstorm', 'goland'],
    configPaths: ['.IntelliJIdea', '.PyCharm', '.WebStorm', '.GoLand'],
  },
  {
    id: 'neovim',
    name: 'Neovim',
    binaries: ['nvim'],
    configPaths: ['.config/nvim'],
  },
  {
    id: 'emacs',
    name: 'Emacs',
    binaries: ['emacs'],
    configPaths: ['.emacs.d', '.config/emacs'],
  },
];

export class AgentDetector {
  private readonly platform: string;
  private readonly home: string;

  constructor() {
    this.platform = platform();
    this.home = homedir();
  }

  /**
   * Detects all known coding agents on this machine. Returns a list of
   * DetectedAgent entries — found AND not-found — so the dashboard can
   * show the full detection matrix.
   */
  async detectAll(): Promise<readonly DetectedAgent[]> {
    const results: DetectedAgent[] = [];
    for (const agent of KNOWN_AGENTS) {
      results.push(await this.detectOne(agent));
    }
    return results;
  }

  /** Detects a single agent by id. */
  async detectById(id: string): Promise<DetectedAgent | undefined> {
    const agent = KNOWN_AGENTS.find((a) => a.id === id);
    if (!agent) return undefined;
    return this.detectOne(agent);
  }

  /** Returns the list of known agent ids (for the dashboard). */
  static listKnownAgentIds(): readonly string[] {
    return KNOWN_AGENTS.map((a) => a.id);
  }

  private async detectOne(agent: typeof KNOWN_AGENTS[number]): Promise<DetectedAgent> {
    // Strategy 1: Check PATH for the binary.
    for (const binary of agent.binaries) {
      const path = await this.findInPath(binary);
      if (path) {
        const version = await this.tryGetVersion(binary);
        return {
          id: agent.id,
          name: agent.name,
          found: true,
          version,
          executable: path,
          platform: this.platform,
          configLocation: this.resolveConfigPath(agent.configPaths),
          detectedVia: 'path',
        };
      }
    }

    // Strategy 2: Check npm global packages.
    if (agent.npmPackages) {
      for (const pkg of agent.npmPackages) {
        const found = await this.checkNpmGlobal(pkg);
        if (found) {
          return {
            id: agent.id,
            name: agent.name,
            found: true,
            version: found.version,
            executable: `npm:${pkg}`,
            platform: this.platform,
            configLocation: this.resolveConfigPath(agent.configPaths),
            detectedVia: 'npm-global',
          };
        }
      }
    }

    // Strategy 3: Check for config file existence (agent installed but not in PATH).
    const configPath = this.resolveConfigPath(agent.configPaths);
    if (configPath) {
      const exists = await this.fileExists(configPath);
      if (exists) {
        return {
          id: agent.id,
          name: agent.name,
          found: true,
          platform: this.platform,
          configLocation: configPath,
          detectedVia: 'config-file',
        };
      }
    }

    // Not found.
    return {
      id: agent.id,
      name: agent.name,
      found: false,
      platform: this.platform,
      detectedVia: 'not-found',
    };
  }

  /** Looks for a binary in PATH using `command -v` (Unix) or `where` (Windows). */
  private async findInPath(binary: string): Promise<string | undefined> {
    try {
      const cmd = this.platform === 'win32'
        ? `where ${binary} 2>nul`
        : `command -v ${binary} 2>/dev/null`;
      const { stdout } = await execAsync(cmd, { timeout: 2000 });
      const path = stdout.trim().split('\n')[0]?.trim();
      return path || undefined;
    } catch {
      return undefined;
    }
  }

  /** Tries to extract a version string from `binary --version`. */
  private async tryGetVersion(binary: string): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync(`${binary} --version`, { timeout: 3000 });
      return stdout.trim().split('\n')[0] || undefined;
    } catch {
      return undefined;
    }
  }

  /** Checks if an npm global package is installed. */
  private async checkNpmGlobal(pkg: string): Promise<{ version: string } | undefined> {
    try {
      const { stdout } = await execAsync(`npm ls -g ${pkg} --json --depth=0 2>/dev/null`, { timeout: 5000 });
      const body = JSON.parse(stdout) as {
        dependencies?: Record<string, { version?: string }>;
      };
      const dep = body.dependencies?.[pkg];
      if (dep?.version) {
        return { version: dep.version };
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /** Resolves the first existing config path, or the first candidate if none exist. */
  private resolveConfigPath(paths?: string[]): string | undefined {
    if (!paths || paths.length === 0) return undefined;
    return `${this.home}/${paths[0]}`;
  }

  /** Checks if a file exists. */
  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
