import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { CredentialVaultPort, RoutingEnginePort } from '@anx/core';

import { defaultCapabilitiesFor, defaultPricingFor } from './endpoints.js';

export interface DiscoveredCredential {
  source: 'claude-code' | 'codex-cli' | 'github-copilot' | 'antigravity' | 'cursor';
  providerId: string;
  token: string;
  accountLabel?: string;
  filePath: string;
}

/**
 * Discovers local OAuth and API credentials stored by CLI coding tools on the user's system.
 * Zero-config: users who are already logged into Claude Code, Codex, or Copilot
 * can immediately use Nexus without typing or re-entering secrets.
 */
export async function discoverLocalCredentials(): Promise<DiscoveredCredential[]> {
  const results: DiscoveredCredential[] = [];
  const home = homedir();

  // 1. Claude Code (~/.claude/.credentials.json or ~/.claude.json)
  const claudePaths = [
    join(home, '.claude', '.credentials.json'),
    join(home, '.claude.json'),
    join(home, '.claude', 'credentials.json'),
  ];
  for (const p of claudePaths) {
    if (existsSync(p)) {
      try {
        const raw = await readFile(p, 'utf8');
        const data = JSON.parse(raw) as Record<string, any>;
        const token =
          data['primaryApiKey'] ??
          data['apiKey'] ??
          data['claudeAi']?.['accessToken'] ??
          data['claudeAi']?.['sessionKey'] ??
          data['oauthAccount']?.['token'] ??
          data['token'];
        if (typeof token === 'string' && token.trim().length > 10) {
          results.push({
            source: 'claude-code',
            providerId: 'anthropic',
            token: token.trim(),
            accountLabel: data['claudeAi']?.['email'] ?? data['email'] ?? 'Claude Local Session',
            filePath: p,
          });
          break;
        }
      } catch {
        // invalid JSON or unreadable — continue
      }
    }
  }

  // 2. OpenAI Codex CLI (~/.codex/auth.json or credentials.json)
  const codexPaths = [
    join(home, '.codex', 'auth.json'),
    join(home, '.codex', 'credentials.json'),
    join(home, '.codex.json'),
  ];
  for (const p of codexPaths) {
    if (existsSync(p)) {
      try {
        const raw = await readFile(p, 'utf8');
        const data = JSON.parse(raw) as Record<string, any>;
        const token =
          data['apiKey'] ??
          data['token'] ??
          data['openai_api_key'] ??
          data['session']?.['token'];
        if (typeof token === 'string' && token.trim().length > 10) {
          results.push({
            source: 'codex-cli',
            providerId: 'openai',
            token: token.trim(),
            accountLabel: data['user'] ?? data['email'] ?? 'Codex Local Session',
            filePath: p,
          });
          break;
        }
      } catch {
        // invalid JSON — continue
      }
    }
  }

  // 3. GitHub Copilot (~/.config/github-copilot/hosts.json or AppData)
  const copilotPaths = [
    join(home, '.config', 'github-copilot', 'hosts.json'),
    join(home, '.config', 'github-copilot', 'apps.json'),
  ];
  if (process.platform === 'win32') {
    const localApp = process.env['LOCALAPPDATA'];
    const appData = process.env['APPDATA'];
    if (localApp) copilotPaths.unshift(join(localApp, 'github-copilot', 'hosts.json'));
    if (appData) copilotPaths.unshift(join(appData, 'github-copilot', 'hosts.json'));
  }
  for (const p of copilotPaths) {
    if (existsSync(p)) {
      try {
        const raw = await readFile(p, 'utf8');
        const data = JSON.parse(raw) as Record<string, any>;
        const gh = data['github.com'] ?? data['github'] ?? Object.values(data)[0];
        const token = gh?.['oauth_token'] ?? gh?.['token'];
        if (typeof token === 'string' && token.trim().length > 10) {
          results.push({
            source: 'github-copilot',
            providerId: 'github',
            token: token.trim(),
            accountLabel: gh?.['user'] ?? 'GitHub Copilot Local Token',
            filePath: p,
          });
          break;
        }
      } catch {
        // continue
      }
    }
  }

  // 4. Antigravity CLI credentials (~/.gemini/antigravity-cli or ~/.agy)
  const agyPaths = [
    join(home, '.gemini', 'antigravity-cli', 'auth.json'),
    join(home, '.agy', 'credentials.json'),
    join(home, '.agy', 'auth.json'),
  ];
  for (const p of agyPaths) {
    if (existsSync(p)) {
      try {
        const raw = await readFile(p, 'utf8');
        const data = JSON.parse(raw) as Record<string, any>;
        const token = data['token'] ?? data['apiKey'] ?? data['accessToken'];
        if (typeof token === 'string' && token.trim().length > 10) {
          results.push({
            source: 'antigravity',
            providerId: 'google',
            token: token.trim(),
            accountLabel: 'Antigravity Local Session',
            filePath: p,
          });
          break;
        }
      } catch {
        // continue
      }
    }
  }

  return results;
}

/**
 * Imports discovered local credentials into the CredentialVault and auto-registers
 * corresponding provider endpoints if not already registered.
 */
export async function autoImportLocalCredentials(
  vault: CredentialVaultPort,
  routing: RoutingEnginePort,
): Promise<number> {
  let imported = 0;
  try {
    const discovered = await discoverLocalCredentials();
    for (const c of discovered) {
      const existing = await vault.get(c.providerId);
      if (!existing || existing === 'nexus') {
        await vault.set(c.providerId, c.token);
        const epId = `auto-${c.providerId}`;
        const existingEp = routing.listEndpoints().find((e) => e.id === epId);
        if (!existingEp) {
          const baseUrl =
            c.providerId === 'anthropic'
              ? 'https://api.anthropic.com'
              : c.providerId === 'openai'
              ? 'https://api.openai.com/v1'
              : c.providerId === 'github'
              ? 'https://models.github.ai/inference'
              : 'https://generativelanguage.googleapis.com/v1beta';

          routing.registerEndpoint({
            id: epId,
            providerId: c.providerId,
            displayName: `${c.source} (${c.accountLabel ?? 'local'})`,
            baseUrl,
            capabilities: defaultCapabilitiesFor(c.providerId),
            pricing: defaultPricingFor(c.providerId),
            priority: 1,
            weight: 1,
            region: 'auto',
            tags: ['auto', 'local-oauth', c.source],
            timeoutMs: 30_000,
            maxRetries: 2,
            concurrencyLimit: 10,
            health: 'healthy',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
        imported++;
      }
    }
  } catch {
    // Non-fatal if credential discovery encounters permission errors
  }
  return imported;
}

