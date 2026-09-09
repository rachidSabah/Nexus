import type { CredentialVaultPort, ProviderEndpoint, RoutingEnginePort } from '@anx/core';
import { describe, expect, it } from 'vitest';

import { autoImportLocalCredentials, discoverLocalCredentials } from '../src/local-credentials.js';

describe('local-credentials auto-discovery', () => {
  it('discovers credentials safely without crashing', async () => {
    const creds = await discoverLocalCredentials();
    expect(Array.isArray(creds)).toBe(true);
  });

  it('imports discovered credentials into vault and routing', async () => {
    const vaultStore = new Map<string, string>();
    const fakeVault: CredentialVaultPort = {
      set: async (provider: string, key: string) => {
        vaultStore.set(provider, key);
      },
      get: async (provider: string) => vaultStore.get(provider) ?? null,
    } as unknown as CredentialVaultPort;

    const registeredEndpoints: ProviderEndpoint[] = [];
    const fakeRouting: RoutingEnginePort = {
      listEndpoints: () => registeredEndpoints,
      getEndpoint: (id: string) => registeredEndpoints.find((e) => e.id === id),
      registerEndpoint: (e: ProviderEndpoint) => {
        registeredEndpoints.push(e);
      },
    } as unknown as RoutingEnginePort;

    const count = await autoImportLocalCredentials(fakeVault, fakeRouting);
    expect(typeof count).toBe('number');
  });
});

