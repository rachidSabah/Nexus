import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CredentialVaultPort, ProviderEndpoint, RoutingEnginePort } from '@anx/core';
import { describe, expect, it } from 'vitest';

import { loadCustomProviders } from '../src/custom-providers.js';

describe('custom-providers loader', () => {
  it('loads valid custom provider JSON and registers it with routing and vault', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'anx-custom-providers-'));
    try {
      const providerJson = {
        providerId: 'my-vllm',
        displayName: 'My Local vLLM',
        baseUrl: 'http://localhost:8000/v1',
        apiKey: 'secret-test-key',
        capabilities: {
          streaming: true,
          toolCalling: true,
        },
        pricing: {
          inputPer1K: 0,
          outputPer1K: 0,
        },
      };

      writeFileSync(join(tempDir, 'my-vllm.json'), JSON.stringify(providerJson));

      const registeredEndpoints: ProviderEndpoint[] = [];
      const fakeRouting: RoutingEnginePort = {
        listEndpoints: () => registeredEndpoints,
        getEndpoint: (id: string) => registeredEndpoints.find((e) => e.id === id),
        registerEndpoint: (e: ProviderEndpoint) => {
          registeredEndpoints.push(e);
        },
        unregisterEndpoint: (id: string) => {
          const idx = registeredEndpoints.findIndex((e) => e.id === id);
          if (idx >= 0) registeredEndpoints.splice(idx, 1);
        },
      } as unknown as RoutingEnginePort;

      const vaultStore = new Map<string, string>();
      const fakeVault: CredentialVaultPort = {
        set: async (provider: string, key: string) => {
          vaultStore.set(provider, key);
        },
        get: async (provider: string) => vaultStore.get(provider) ?? null,
      } as unknown as CredentialVaultPort;

      const count = await loadCustomProviders(fakeVault, fakeRouting, [tempDir]);
      expect(count).toBe(1);
      expect(vaultStore.get('my-vllm')).toBe('secret-test-key');
      expect(registeredEndpoints).toHaveLength(1);
      expect(registeredEndpoints[0]?.id).toBe('custom-my-vllm');
      expect(registeredEndpoints[0]?.baseUrl).toBe('http://localhost:8000/v1');
      expect(registeredEndpoints[0]?.capabilities.streaming).toBe(true);
      expect(registeredEndpoints[0]?.capabilities.toolCalling).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('skips invalid files without crashing', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'anx-custom-providers-broken-'));
    try {
      writeFileSync(join(tempDir, 'broken.json'), 'not valid json {{{');
      const fakeRouting = {
        listEndpoints: () => [],
        getEndpoint: () => undefined,
        registerEndpoint: () => {},
        unregisterEndpoint: () => {},
      } as unknown as RoutingEnginePort;

      const count = await loadCustomProviders(undefined, fakeRouting, [tempDir]);
      expect(count).toBe(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

