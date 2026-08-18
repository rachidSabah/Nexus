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
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    description: "Google's official Gemini CLI for code and workflows",
    category: 'cli',
    homepage: 'https://github.com/google-gemini/gemini-cli',
    binaryNames: ['gemini', 'gemini-cli'],
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://github.com/google-gemini/gemini-cli',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'qwen-code',
    displayName: 'Qwen Code',
    description: 'Alibaba Qwen coding agent CLI and tools',
    category: 'cli',
    homepage: 'https://github.com/QwenLM/Qwen',
    binaryNames: ['qwen', 'qwen-code'],
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://github.com/QwenLM/Qwen',
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
    npmPackage: 'opencode',
    installRecipe: {
      type: 'npm',
      packageName: 'opencode',
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
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://github.com/opencode-ai/opencode',
    },
    supportedProtocols: ['OpenAI-compatible'],
  },
  {
    id: 'opencode-zen',
    displayName: 'OpenCode Zen',
    description: 'Minimalist AI coding agent (opencode-zen)',
    category: 'cli',
    homepage: 'https://github.com/opencode-zen/opencode-zen',
    binaryNames: ['opencode-zen', 'ocode-zen', 'zen'],
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://github.com/opencode-zen/opencode-zen',
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
    installRecipe: {
      type: 'manual',
      guideUrl: 'https://github.com/hermes-agent/hermes',
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
    id: 'openhands',
    displayName: 'OpenHands',
    description: 'Open source platform for software development agents',
    category: 'agent',
    homepage: 'https://github.com/All-Hands-AI/OpenHands',
    binaryNames: ['openhands', 'opendevin'],
    installRecipe: {
      type: 'pip',
      packageName: 'open-hands',
      guideUrl: 'https://github.com/All-Hands-AI/OpenHands',
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
];

export function getAgentCatalogEntry(id: string): AgentCatalogEntry | undefined {
  return TRUSTED_AGENT_CATALOG.find((entry) => entry.id === id);
}
