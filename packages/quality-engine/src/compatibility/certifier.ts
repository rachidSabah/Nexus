/**
 * Compatibility Certification Suite
 *
 * Verifies compatibility with the AI coding tools registered in
 * `@anx/integrations` by actually probing the gateway's live HTTP API:
 *   - `/health` for basic reachability
 *   - `/v1/models` for OpenAI-compatible API surface
 *   - A streaming probe (`POST /v1/chat/completions` with `stream:true`) to
 *     verify SSE is properly emitted end-to-end
 *
 * Editors are checked via the integration adapters' `status()` method, which
 * inspects the local filesystem for installed editor + extension paths.
 */

import { BUILTIN_INTEGRATIONS, type IntegrationContext } from '@anx/integrations';

import type { CompatibilityResult } from '../types.js';

export interface ToolConfig {
  name: string;
  version: string;
  testEndpoint?: string;
  requiredFeatures: string[];
}

export interface EditorConfig {
  name: string;
  requiredExtensions: string[];
}

export interface CertifierOptions {
  /** Gateway base URL, e.g. `http://localhost:8787`. */
  gatewayUrl: string;
  /** Optional API key to send on probes (Bearer auth). */
  apiKey?: string;
  /** Optional integration context — defaults to one built from gatewayUrl. */
  integrationContext?: IntegrationContext;
  /** Probe timeout in ms (default: 5000). */
  probeTimeoutMs?: number;
}

export class CompatibilityCertifier {
  private readonly tools: ToolConfig[] = [
    { name: 'Claude Code', version: 'latest', requiredFeatures: ['api', 'streaming'] },
    { name: 'OpenCode', version: 'latest', requiredFeatures: ['api', 'providers'] },
    { name: 'OpenCode Go', version: 'latest', requiredFeatures: ['api', 'cli'] },
    { name: 'OpenCode Zen', version: 'latest', requiredFeatures: ['api', 'gui'] },
    { name: 'Codex CLI', version: 'latest', requiredFeatures: ['api', 'streaming'] },
    { name: 'Hermes CLI', version: 'latest', requiredFeatures: ['api', 'routing'] },
    { name: 'Cursor', version: 'latest', requiredFeatures: ['api', 'completion'] },
    { name: 'Continue', version: 'latest', requiredFeatures: ['api', 'context'] },
    { name: 'Cline', version: 'latest', requiredFeatures: ['api', 'tools'] },
    { name: 'Roo Code', version: 'latest', requiredFeatures: ['api', 'agents'] },
    { name: 'OpenHands', version: 'latest', requiredFeatures: ['api', 'sandbox'] },
    { name: 'Aider', version: 'latest', requiredFeatures: ['api', 'git'] },
  ];

  private readonly editors: EditorConfig[] = [
    { name: 'VS Code', requiredExtensions: ['agent-nexus.vscode'] },
    { name: 'JetBrains', requiredExtensions: ['agent-nexus.intellij'] },
    { name: 'Neovim', requiredExtensions: ['agent-nexus.nvim'] },
    { name: 'Emacs', requiredExtensions: ['agent-nexus.elisp'] },
  ];

  private readonly gatewayUrl: string;
  private readonly apiKey?: string;
  private readonly ctx: IntegrationContext;
  private readonly probeTimeoutMs: number;

  constructor(opts: CertifierOptions) {
    this.gatewayUrl = opts.gatewayUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.ctx = opts.integrationContext ?? {
      gatewayUrl: this.gatewayUrl,
      apiKey: opts.apiKey,
      defaultModel: 'gpt-4',
      homeDir: process.env['HOME'] ?? process.env['USERPROFILE'] ?? '.',
    };
    this.probeTimeoutMs = opts.probeTimeoutMs ?? 5000;
  }

  async certify(): Promise<CompatibilityResult> {
    const toolResults = await this.testTools();
    const editorResults = await this.testEditors();
    return { tools: toolResults, editors: editorResults };
  }

  private async testTools(): Promise<CompatibilityResult['tools']> {
    // Cache the per-gateway probes — they're the same for every tool.
    const apiOk = await this.checkAPICompatibility([]);
    const streamingOk = await this.checkStreamingSupport();

    const results: CompatibilityResult['tools'] = [];
    for (const tool of this.tools) {
      const issues: string[] = [];
      let partial = false;

      if (!apiOk) {
        issues.push(`Gateway API at ${this.gatewayUrl} did not respond to /v1/models`);
        partial = true;
      }
      if (tool.requiredFeatures.includes('streaming') && !streamingOk) {
        issues.push('Streaming support incomplete — probe did not see a `data:` SSE frame');
        partial = true;
      }

      // Also check the integration's local status (is the tool installed on this machine?).
      const integration = BUILTIN_INTEGRATIONS.find((i: { displayName: string; description: string }) =>
        i.displayName === tool.name || i.description.includes(tool.name),
      );
      let installedNote: string | undefined;
      if (integration) {
        const status = await integration.status(this.ctx).catch(() => null);
        if (status && !status.installed) {
          installedNote = `not detected locally (config path: ${status.configPath ?? 'n/a'})`;
        }
      }

      const status = apiOk && (!tool.requiredFeatures.includes('streaming') || streamingOk)
        ? partial || installedNote
          ? 'PARTIAL'
          : 'COMPATIBLE'
        : 'INCOMPATIBLE';
      if (installedNote) issues.push(installedNote);

      results.push({
        name: tool.name,
        version: tool.version,
        status,
        issues,
      });
    }
    return results;
  }

  /**
   * Probes the gateway's `/v1/models` endpoint. Returns true if it responds
   * with a non-empty `data` array within the probe timeout.
   */
  private async checkAPICompatibility(_features: string[]): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.probeTimeoutMs);
      try {
        const r = await fetch(`${this.gatewayUrl}/v1/models`, {
          headers: this.authHeaders(),
          signal: controller.signal,
        });
        if (!r.ok) return false;
        const body = (await r.json()) as { data?: Array<{ id: string }> };
        return Array.isArray(body.data) && body.data.length > 0;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }

  /**
   * Probes the gateway's streaming endpoint by sending a tiny chat request
   * with `stream:true`. Returns true if at least one `data:` SSE frame is
   * received before the request completes or the timeout fires.
   *
   * The probe uses a deliberately tiny `max_tokens` to keep cost negligible;
   * if no providers are configured, the gateway will likely return an error,
   * which we treat as "streaming not verifiable" rather than a hard failure.
   */
  private async checkStreamingSupport(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.probeTimeoutMs * 2);
      try {
        const r = await fetch(`${this.gatewayUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4',
            messages: [{ role: 'user', content: 'ping' }],
            stream: true,
            max_tokens: 1,
          }),
          signal: controller.signal,
        });
        if (!r.ok || !r.body) return false;
        const reader = r.body.getReader();
        const { value } = await reader.read();
        void reader.cancel();
        if (!value) return false;
        const text = new TextDecoder().decode(value);
        return text.includes('data:');
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }

  private async testEditors(): Promise<CompatibilityResult['editors']> {
    const results: CompatibilityResult['editors'] = [];
    for (const editor of this.editors) {
      const status = await this.verifyEditor(editor);
      results.push({
        name: editor.name,
        status: status.compatible ? 'COMPATIBLE' : status.partial ? 'PARTIAL' : 'INCOMPATIBLE',
        extensions: editor.requiredExtensions,
      });
    }
    return results;
  }

  /**
   * Verifies an editor by checking whether at least one integration adapter
   * targeting that editor reports `installed: true` via its `status()` call.
   * Falls back to "compatible" (partial) when the editor itself is detected
   * but the agent-nexus extension is not — instead of the previous hardcoded
   * `compatible: true` that lied about the result.
   */
  private async verifyEditor(editor: EditorConfig): Promise<{ compatible: boolean; partial: boolean }> {
    const matching = BUILTIN_INTEGRATIONS.filter((i: { category: string }) =>
      i.category === 'editor' || i.category === 'ide',
    );
    let editorDetected = false;
    let extensionInstalled = false;
    for (const adapter of matching) {
      // Match by adapter display name containing the editor name (or vice-versa).
      if (!adapter.displayName.toLowerCase().includes(editor.name.toLowerCase()) &&
          !editor.name.toLowerCase().includes(adapter.displayName.toLowerCase())) {
        continue;
      }
      const status = await adapter.status(this.ctx).catch(() => null);
      if (!status) continue;
      if (status.installed) {
        editorDetected = true;
        // If the integration writes a real config file (not just a snippet),
        // treat it as "extension installed".
        if (status.configured) {
          extensionInstalled = true;
        }
      }
    }
    if (extensionInstalled) return { compatible: true, partial: false };
    if (editorDetected) return { compatible: false, partial: true };
    // Editor not detected locally — neither compatible nor incompatible.
    return { compatible: false, partial: false };
  }

  private authHeaders(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  generateReport(compatibility: CompatibilityResult): string {
    const compatibleTools = compatibility.tools.filter((t) => t.status === 'COMPATIBLE').length;
    const totalTools = compatibility.tools.length;
    const compatibleEditors = compatibility.editors.filter((e) => e.status === 'COMPATIBLE').length;
    const totalEditors = compatibility.editors.length;
    return `# Compatibility Certification Report

## Summary
- Gateway: ${this.gatewayUrl}
- Tools: ${compatibleTools}/${totalTools} Compatible
- Editors: ${compatibleEditors}/${totalEditors} Compatible

## Tool Compatibility
${compatibility.tools.map((t) => `- ${t.name}: ${t.status}${t.issues.length ? ` — ${t.issues.join('; ')}` : ''}`).join('\n')}

## Editor Compatibility
${compatibility.editors.map((e) => `- ${e.name}: ${e.status}`).join('\n')}`;
  }
}
