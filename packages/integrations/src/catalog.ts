/**
 * ───────────────────────────────────────────────────────────────────────────
 * Trusted Agent Catalog (Zero-Touch Universal Agent Control Plane)
 *
 * Defines the trusted specifications, detection hints, and safe installation
 * recipes for supported coding agents.
 *
 * Security Guarantee:
 * The backend NEVER accepts arbitrary shell commands from the client/browser.
 * All installation recipes are strictly resolved from this catalog.
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface AgentCatalogEntry {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: 'cli' | 'editor' | 'ide' | 'agent';
  readonly homepage?: string;
  readonly binaryNames: readonly string[];
  readonly npmPackage?: string;
  readonly installRecipe: {
    readonly type: 'npm' | 'pip' | 'binary' | 'manual';
    readonly packageName?: string;
    readonly guideUrl?: string;
  };
  readonly supportedProtocols: readonly ('Anthropic' | 'OpenAI-compatible')[];
  /**
   * Config-file locations (relative to home dir) used for detection when the
   * agent binary is not on PATH. Optional.
   */
  readonly configPaths?: readonly string[];
}

export const TRUSTED_AGENT_CATALOG: readonly AgentCatalogEntry[] = [
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    description: "Anthropic's official agentic coding CLI",
    category: 'cli',
    homepage: 'https://docs.anthropic.com/en/docs/claude-code',
    binaryNames: ['claude'],
    npmPackage: '@anthropic-ai/claude-code',
    installRecipe: {
      type: 'npm',
      packageName: '@anthropic-ai/claude-code',
      guideUrl: 'https://docs.anthropic.com/en/docs/claude-code',
    },
    supportedProtocols: ['Anthropic', 'OpenAI-compatible'],
  },
  {
    id: 'codex-cli',
    displayName: 'Codex CLI',
    description: "OpenAI's coding agent CLI",
    category: 'cli',
    homepage: 'https://github.com/openai/codex',
    binaryNames: ['codex'],
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://github.com/openai/codex',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'qwen-code',
    displayName: 'Qwen Code',
    description: 'Alibaba Qwen coding agent CLI and tools',
    category: 'cli',
    homepage: 'https://github.com/QwenLM/qwen-code',
    binaryNames: ['qwen', 'qwen-code'],
    npmPackage: 'qwen-code',
    installRecipe: {
      type: 'npm',
      packageName: 'qwen-code',
      guideUrl: 'https://github.com/QwenLM/qwen-code',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    description: 'Terminal-based AI coding agent (TypeScript)',
    category: 'cli',
    homepage: 'https://github.com/sst/opencode',
    binaryNames: ['opencode'],
    npmPackage: 'opencode-ai',
    installRecipe: {
      type: 'npm',
      packageName: 'opencode-ai',
      guideUrl: 'https://github.com/sst/opencode',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'opencode-go',
    displayName: 'OpenCode Go',
    description: 'Go-based AI coding agent (opencode-go)',
    category: 'cli',
    homepage: 'https://github.com/opencode-ai/opencode',
    binaryNames: ['opencode-go', 'ocode'],
    npmPackage: 'opencode-ai',
    installRecipe: {
      type: 'npm',
      packageName: 'opencode-ai',
      guideUrl: 'https://github.com/opencode-ai/opencode',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'hermes-cli',
    displayName: 'Hermes CLI',
    description: 'Multi-agent developer platform and CLI',
    category: 'cli',
    homepage: 'https://github.com/hermes-agent/hermes',
    binaryNames: ['hermes'],
    npmPackage: 'hermes-agent',
    installRecipe: {
      type: 'npm',
      packageName: 'hermes-agent',
      guideUrl: 'https://github.com/hermes-agent/hermes',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'opencode-zen',
    displayName: 'OpenCode Zen',
    description: 'Cloud-optimized AI coding agent (opencode-zen)',
    category: 'cli',
    homepage: 'https://opencode.ai/zen',
    binaryNames: ['opencode-zen', 'zen-code'],
    npmPackage: 'opencode-ai',
    installRecipe: {
      type: 'npm',
      packageName: 'opencode-ai',
      guideUrl: 'https://opencode.ai/zen',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'aider',
    displayName: 'Aider',
    description: 'AI pair programming in your terminal',
    category: 'cli',
    homepage: 'https://aider.chat',
    binaryNames: ['aider'],
    installRecipe: {
      type: 'pip',
      packageName: 'aider-chat',
      guideUrl: 'https://aider.chat/docs/install.html',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'openhands',
    displayName: 'OpenHands',
    description: 'Autonomous AI software developer agent',
    category: 'agent',
    homepage: 'https://github.com/All-Hands-AI/OpenHands',
    binaryNames: ['openhands'],
    installRecipe: {
      type: 'pip',
      packageName: 'openhands-ai',
      guideUrl: 'https://github.com/All-Hands-AI/OpenHands',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'cline',
    displayName: 'Cline',
    description: 'Autonomous coding agent extension',
    category: 'editor',
    homepage: 'https://github.com/cline/cline',
    binaryNames: ['cline'],
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://github.com/cline/cline',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'roo-code',
    displayName: 'Roo Code',
    description: 'AI coding assistant for VS Code and forks',
    category: 'editor',
    homepage: 'https://github.com/RooVetGit/Roo-Code',
    binaryNames: ['roo-code'],
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://github.com/RooVetGit/Roo-Code',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    description: 'AI-first code editor built on VS Code',
    category: 'editor',
    homepage: 'https://www.cursor.com',
    binaryNames: ['cursor'],
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://www.cursor.com',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'zed',
    displayName: 'Zed',
    description: 'High-performance multiplayer code editor',
    category: 'editor',
    homepage: 'https://zed.dev',
    binaryNames: ['zed'],
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://zed.dev',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'vscode',
    displayName: 'VS Code',
    description: 'Visual Studio Code editor',
    category: 'ide',
    homepage: 'https://code.visualstudio.com',
    binaryNames: ['code'],
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://code.visualstudio.com',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'agy',
    displayName: 'AGY Builder Agent',
    description: 'Antigravity AGY multi-agent builder CLI',
    category: 'cli',
    homepage: 'https://github.com/antigravity-ai/agy',
    binaryNames: ['agy'],
    configPaths: ['.agy/config.json'],
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://github.com/antigravity-ai/agy',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'continue',
    displayName: 'Continue',
    description: 'Open-source AI code assistant (VS Code / JetBrains extension)',
    category: 'editor',
    homepage: 'https://continue.dev',
    binaryNames: ['continue'],
    configPaths: ['.continue/config.json'],
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://docs.continue.dev/quickstart/install',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'neovim',
    displayName: 'Neovim',
    description: 'Hyperextensible Vim-based text editor',
    category: 'editor',
    homepage: 'https://neovim.io',
    binaryNames: ['nvim'],
    configPaths: ['.config/nvim'],
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://github.com/neovim/neovim/wiki/Install',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'emacs',
    displayName: 'Emacs',
    description: 'Extensible, customizable text editor',
    category: 'editor',
    homepage: 'https://www.gnu.org/software/emacs/',
    binaryNames: ['emacs'],
    configPaths: ['.emacs.d', '.config/emacs'],
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://www.gnu.org/software/emacs/download.html',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'jetbrains',
    displayName: 'JetBrains IDEs',
    description: 'IntelliJ / PyCharm / WebStorm / GoLand and family',
    category: 'ide',
    homepage: 'https://www.jetbrains.com',
    binaryNames: ['idea', 'pycharm', 'webstorm', 'goland'],
    configPaths: ['.IntelliJIdea', '.PyCharm', '.WebStorm', '.GoLand'],
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://www.jetbrains.com/products/',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'goose',
    displayName: 'Goose',
    description: "Block's open-source AI agent CLI",
    category: 'cli',
    homepage: 'https://github.com/block/goose',
    binaryNames: ['goose'],
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://github.com/block/goose',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'crush',
    displayName: 'Crush',
    description: 'CLI coding agent (Rust)',
    category: 'cli',
    homepage: 'https://github.com/charmbracelet/crush',
    binaryNames: ['crush'],
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://github.com/charmbracelet/crush',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'deepseek-harness',
    displayName: 'DeepSeek Harness',
    description: "DeepSeek's plugin-based agent harness (dsh) — serves a web UI",
    category: 'agent',
    homepage: 'https://github.com/deepseek-ai/deepseek-harness',
    binaryNames: ['dsh'],
    npmPackage: '@deepseek-ai/dsh',
    installRecipe: {
      type: 'npm',
      packageName: '@deepseek-ai/dsh',
      guideUrl: 'https://github.com/deepseek-ai/deepseek-harness',
    },
    supportedProtocols: ['OpenAI-compatible'],
    configPaths: ['.deepseek/harness'],
  },
];

export function getAgentCatalogEntry(id: string): AgentCatalogEntry | undefined {
  return TRUSTED_AGENT_CATALOG.find((entry) => entry.id === id);
}
