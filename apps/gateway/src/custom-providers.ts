import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { CredentialVaultPort, ProviderCapabilities, ProviderEndpoint, RoutingEnginePort } from '@anx/core';

import { defaultCapabilitiesFor, defaultPricingFor } from './endpoints.js';

export interface CustomProviderDefinition {
  readonly providerId: string;
  readonly displayName?: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly models?: readonly string[];
  readonly capabilities?: Partial<ProviderCapabilities>;
  readonly pricing?: {
    readonly inputPer1K?: number;
    readonly outputPer1K?: number;
    readonly currency?: 'USD' | 'EUR';
  };
  readonly tags?: readonly string[];
}

/**
 * Returns candidate directories where custom provider JSON manifests can reside:
 * 1. Directory specified in NEXUS_CUSTOM_PROVIDERS_DIR env var
 * 2. ./custom-providers (relative to cwd)
 * 3. ~/.agent-nexus/custom-providers
 */
export function getCustomProviderDirectories(): string[] {
  const dirs: string[] = [];
  const envDir = process.env['NEXUS_CUSTOM_PROVIDERS_DIR'];
  if (envDir && existsSync(envDir)) {
    dirs.push(envDir);
  }
  const localDir = join(process.cwd(), 'custom-providers');
  if (existsSync(localDir)) {
    dirs.push(localDir);
  }
  const userDir = join(homedir(), '.agent-nexus', 'custom-providers');
  if (existsSync(userDir)) {
    dirs.push(userDir);
  }
  return dirs;
}

/**
 * Loads custom provider JSON configurations from custom-providers/ directories
 * and registers them dynamically into the routing engine and credential vault.
 */
export async function loadCustomProviders(
  vault?: CredentialVaultPort,
  routing?: RoutingEnginePort,
  directories = getCustomProviderDirectories(),
): Promise<number> {
  if (!routing) return 0;
  let count = 0;

  for (const dir of directories) {
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }

    for (const file of files) {
      try {
        const fullPath = join(dir, file);
        const content = await readFile(fullPath, 'utf8');
        const parsed = JSON.parse(content) as unknown;
        const entries: CustomProviderDefinition[] = Array.isArray(parsed)
          ? (parsed as CustomProviderDefinition[])
          : [parsed as CustomProviderDefinition];

        for (const def of entries) {
          if (!def.providerId || !def.baseUrl) continue;

          if (def.apiKey && vault) {
            await vault.set(def.providerId, def.apiKey);
          }

          const epId = `custom-${def.providerId}`;
          const existing = routing.listEndpoints().find((e) => e.id === epId);
          if (existing) {
            routing.unregisterEndpoint(epId);
          }

          const endpoint: ProviderEndpoint = {
            id: epId,
            providerId: def.providerId,
            displayName: def.displayName ?? def.providerId,
            baseUrl: def.baseUrl.replace(/\/+$/, ''),
            capabilities: {
              ...defaultCapabilitiesFor(def.providerId),
              ...(def.capabilities ?? {}),
            },
            pricing: {
              ...defaultPricingFor(def.providerId),
              ...(def.pricing
                ? {
                    inputPer1K: def.pricing.inputPer1K ?? 0,
                    outputPer1K: def.pricing.outputPer1K ?? 0,
                    currency: def.pricing.currency === 'EUR' ? 'EUR' : 'USD',
                  }
                : {}),
            },
            priority: 1,
            weight: 1,
            region: 'custom',
            tags: ['custom', ...(def.tags ?? [])],
            timeoutMs: 60_000,
            maxRetries: 2,
            concurrencyLimit: 10,
            health: 'healthy',
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          routing.registerEndpoint(endpoint);
          count++;
        }
      } catch (err) {
        console.warn(`[custom-providers] Failed to parse ${file}: ${(err as Error).message}`);
      }
    }
  }

  return count;
}

