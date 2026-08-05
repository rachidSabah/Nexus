# Native Integrations

Agent Nexus Gateway ships with **19 native integrations** that auto-configure AI tools to route through the gateway. Each integration is implemented as an `IntegrationAdapter` in `@anx/integrations` and surfaced via the `anx integrations` CLI.

## Quick start

```bash
# See all 19 integrations and their status
anx integrations list

# Configure Claude Code to use the gateway
anx integrations install claude-code

# Configure OpenCode + OpenCode Go + OpenCode Zen together
anx integrations install opencode opencode-go opencode-zen

# Configure EVERY installed tool in one shot
anx integrations install --all

# Verify a tool can reach the gateway
anx integrations verify claude-code

# Remove gateway config from a tool
anx integrations uninstall claude-code

# Show details about an integration
anx integrations info opencode-zen
```

## Supported integrations

### CLI tools (9)

| ID | Name | Config file written |
|---|---|---|
| `claude-code` | Claude Code | `~/.claude/settings.json` |
| `codex-cli` | Codex CLI | `~/.codex/config.json` |
| `gemini-cli` | Gemini CLI | `~/.gemini/settings.json` + `~/.gemini/.env` |
| `hermes-cli` | Hermes CLI | `~/.hermes/config.json` |
| `opencode` | OpenCode | `~/.config/opencode/opencode.json` |
| `opencode-go` | OpenCode Go | `~/.config/opencode-go/config.toml` |
| `opencode-zen` | OpenCode Zen | `~/.config/opencode-zen/config.yaml` + `.env` |
| `aider` | Aider | `~/.aider.conf.yml` |
| `openhands` | OpenHands | `~/.openhands/config.toml` + `.env` |

### Editors (7)

| ID | Name | Config file written |
|---|---|---|
| `cursor` | Cursor | `~/.cursor/config.json` |
| `continue` | Continue | `~/.continue/config.json` |
| `cline` | Cline | `~/.cline/config.json` + VS Code snippet |
| `roo-code` | Roo Code | `~/.roo-code/config.json` |
| `zed` | Zed | `~/.config/zed/settings.json` (Linux) or `~/Library/Application Support/Zed/settings.json` (macOS) |
| `neovim` | Neovim | `~/.config/nvim/lua/anx-gateway.lua` |
| `emacs` | Emacs | `~/.config/emacs/anx-gateway.el` |

### IDEs (2)

| ID | Name | Config file written |
|---|---|---|
| `vscode` | VS Code | `~/.vscode/settings.json` (Linux) or `~/Library/Application Support/Code/User/settings.json` (macOS) |
| `jetbrains` | JetBrains IDEs | `~/.anx/integrations/jetbrains-snippet.xml` (paste into IDE settings) |

## The IntegrationAdapter contract

Every integration implements this interface:

```ts
interface IntegrationAdapter {
  readonly id: string;              // e.g. "opencode-zen"
  readonly displayName: string;     // e.g. "OpenCode Zen"
  readonly description: string;
  readonly category: 'cli' | 'editor' | 'ide' | 'agent';
  readonly homepage?: string;

  detect(ctx): Promise<boolean>;      // is the tool installed?
  install(ctx): Promise<Result>;      // write config files
  uninstall(ctx): Promise<Result>;    // remove config files
  verify(ctx): Promise<Result>;       // ping the gateway
  status(ctx): Promise<Status>;       // for `anx integrations list`
}
```

The `ctx` carries `gatewayUrl`, `apiKey`, `defaultModel`, `dryRun`, `force`, and `homeDir`.

## Merge strategies

When `install()` encounters an existing config file, it uses the file's `merge` strategy:

- **`overwrite`** — replace the file entirely (default for non-JSON formats like TOML/YAML)
- **`json-merge`** — shallow-merge top-level keys (preserves user settings not in our config)
- **`skip`** — leave the file alone (used for user-local overrides like Claude Code's `settings.local.json`)

Pass `--force` to force `overwrite` behavior on all files.

## Dry-run mode

```bash
anx integrations install --all --dry-run
```

Prints every action that would be taken without writing anything. Useful for inspecting what the installer does before committing.

## Adding a new integration

1. Create `packages/integrations/src/adapters/<your-tool>.ts`:

```ts
import type { IntegrationContext } from '../contract.js';
import { BaseIntegration, jsonString } from '../base.js';

export class YourToolIntegration extends BaseIntegration {
  readonly id = 'your-tool';
  readonly displayName = 'Your Tool';
  readonly description = 'One-line description';
  readonly category = 'cli' as const;
  readonly homepage = 'https://your-tool.example.com';

  protected detectBinaries(): string[] {
    return ['your-tool'];
  }

  protected configFiles() {
    return [
      {
        path: '.your-tool/config.json',
        merge: 'json-merge' as const,
        content: (ctx: IntegrationContext) =>
          jsonString({
            apiBaseUrl: `${ctx.gatewayUrl}/v1`,
            apiKey: ctx.apiKey ?? 'no-key-required',
            model: ctx.defaultModel,
          }),
      },
    ];
  }
}
```

2. Register it in `packages/integrations/src/registry.ts`:

```ts
import { YourToolIntegration } from './adapters/your-tool.js';

export const BUILTIN_INTEGRATIONS: IntegrationAdapter[] = [
  // ...
  new YourToolIntegration(),
];
```

3. Update the test in `packages/integrations/test/integrations.test.ts` to include the new id in the `expected` array.

4. Update the `BUILTIN_INTEGRATIONS_COUNT` constant in `packages/integrations/src/index.ts`.

5. Update the table in this document.

6. Update the help text in `packages/cli/src/index.ts`.

## Config file locations

Every config file is written **under the user's home directory**. We never touch system-wide locations like `/etc/`. The `homeDir` in `IntegrationContext` can be overridden (used by tests).

On macOS, `~` is whatever `os.homedir()` returns, which is typically `/Users/<you>`. On Linux it's `/home/<you>`. On Windows it's `C:\Users\<you>` (forward slashes work fine via `node:path.join`).

## Verifying an install

```bash
$ anx integrations verify claude-code
✓ Claude Code: gateway reachable (ok, v0.1.0); Claude Code is installed
```

The `verify()` method calls `${gatewayUrl}/health` and reports the gateway status. It also runs `detect()` to confirm the tool itself is installed.

## Troubleshooting

### "Tool not installed"

The `install` command writes config files whether or not the tool is installed. The `status` column in `anx integrations list` shows `installed: no` if the binary / app isn't found on PATH. Install the tool from its official source first, then re-run `anx integrations install <id>`.

### Config file already exists

Without `--force`, the installer uses the merge strategy declared by each config file (see above). To overwrite unconditionally:

```bash
anx integrations install claude-code --force
```

### Tool can't reach the gateway

1. Check the gateway is running: `anx health`
2. Check the URL: `anx integrations info <id>` shows the URL that will be written
3. Override per-install: `anx integrations install <id> --gateway http://my-host:8787`
4. Verify: `anx integrations verify <id>`

### macOS vs Linux paths

Some tools (Zed, VS Code) have different config paths on macOS vs Linux. The integrations handle this automatically via `process.platform` checks.

### Windows

The integrations work on Windows too — `os.homedir()` returns `C:\Users\<you>` and `path.join` produces Windows-style paths. PowerShell is recommended for running `anx`.

## What's NOT shipped

- **GitHub Copilot Chat** in VS Code — Copilot Chat uses GitHub's backend and doesn't support a custom OpenAI base URL. Use Continue, Cline, or Roo Code instead.
- **ChatGPT Desktop app** — closed source, no custom-endpoint support.
- **Windsurf** — Codeium's editor. On the roadmap; PRs welcome.
