import { describe, it, expect, beforeEach } from 'vitest';
import { ExtensionMarketplace } from '../src/index';
import type { ExtensionPackage, PublisherProfile } from '../src/types';

const mockExtension: ExtensionPackage = {
  metadata: {
    id: 'test-provider',
    name: 'Test Provider',
    description: 'A test provider extension',
    version: '1.0.0',
    type: 'provider',
    category: 'AI Providers',
    author: {
      name: 'Test Author',
      verified: true,
      url: 'https://example.com',
    },
    repository: {
      url: 'https://github.com/test/test-provider',
      type: 'github',
    },
    homepage: 'https://example.com',
    license: 'Apache-2.0',
    keywords: ['ai', 'provider', 'test'],
  },
  versions: [
    {
      version: '1.0.0',
      releaseDate: '2024-01-01',
      downloadUrl: 'https://example.com/download/1.0.0',
      checksum: 'abc123',
      signature: 'signature123',
      minGatewayVersion: '0.6.0',
    },
    {
      version: '1.1.0',
      releaseDate: '2024-02-01',
      downloadUrl: 'https://example.com/download/1.1.0',
      checksum: 'def456',
      signature: 'signature456',
      minGatewayVersion: '0.6.0',
    },
  ],
  dependencies: {
    gateway: '0.6.0',
    extensions: [],
    providers: [],
  },
  permissions: {
    network: true,
    filesystem: false,
    environment: false,
    secrets: false,
    providers: ['openai'],
    models: ['gpt-4'],
  },
  config: {
    settings: {},
    envVars: ['API_KEY'],
    secrets: ['api_key'],
  },
  downloads: 1000,
  rating: {
    average: 4.5,
    count: 100,
  },
  status: 'available',
  publishedAt: '2024-01-01',
  updatedAt: '2024-02-01',
};

describe('ExtensionMarketplace', () => {
  let marketplace: ExtensionMarketplace;

  beforeEach(() => {
    marketplace = new ExtensionMarketplace('0.7.0');
    marketplace.addAvailableExtension(mockExtension);
  });

  it('should initialize with default configuration', () => {
    expect(marketplace).toBeDefined();
  });

  it('should search extensions by type', async () => {
    const result = await marketplace.search({ type: 'provider' });
    expect(result.total).toBe(1);
    expect(result.results[0].metadata.type).toBe('provider');
  });

  it('should search extensions by category', async () => {
    const result = await marketplace.search({ category: 'AI Providers' });
    expect(result.total).toBe(1);
    expect(result.results[0].metadata.category).toBe('AI Providers');
  });

  it('should search extensions by keywords', async () => {
    const result = await marketplace.search({ keywords: ['ai'] });
    expect(result.total).toBe(1);
  });

  it('should filter by verified authors', async () => {
    const result = await marketplace.search({ verified: true });
    expect(result.total).toBe(1);

    const unverifiedResult = await marketplace.search({ verified: false });
    expect(unverifiedResult.total).toBe(0);
  });

  it('should get extension details', async () => {
    const extension = await marketplace.getExtension('test-provider');
    expect(extension).not.toBeNull();
    expect(extension?.metadata.name).toBe('Test Provider');
  });

  it('should return null for non-existent extension', async () => {
    const extension = await marketplace.getExtension('non-existent');
    expect(extension).toBeNull();
  });

  it('should check compatibility successfully', () => {
    const compatibility = marketplace.checkCompatibility('test-provider');
    expect(compatibility.compatible).toBe(true);
    expect(compatibility.missingExtensions).toHaveLength(0);
    expect(compatibility.conflicts).toHaveLength(0);
  });

  it('should detect missing dependencies', async () => {
    const depExtension: ExtensionPackage = {
      ...mockExtension,
      metadata: { ...mockExtension.metadata, id: 'dep-test' },
      dependencies: {
        gateway: '0.6.0',
        extensions: ['required-ext'],
        providers: [],
      },
    };

    marketplace.addAvailableExtension(depExtension);
    const compatibility = marketplace.checkCompatibility('dep-test');
    
    expect(compatibility.compatible).toBe(false);
    expect(compatibility.missingExtensions).toContain('required-ext');
  });

  it('should install an extension', async () => {
    const installed = await marketplace.install('test-provider', {
      skipSignatureVerification: true,
    });
    
    expect(installed).toBe(true);
    const installedExt = marketplace.getInstalledExtension('test-provider');
    expect(installedExt).toBeDefined();
    expect(installedExt?.installedVersion).toBe('1.1.0');
  });

  it('should fail installation if compatibility check fails', async () => {
    const incompatibleExt: ExtensionPackage = {
      ...mockExtension,
      metadata: { ...mockExtension.metadata, id: 'incompatible' },
      dependencies: {
        gateway: '99.0.0', // Requires future version
        extensions: [],
        providers: [],
      },
    };

    marketplace.addAvailableExtension(incompatibleExt);

    await expect(marketplace.install('incompatible')).rejects.toThrow('Compatibility check failed');
  });

  it('should update an installed extension', async () => {
    await marketplace.install('test-provider', {
      skipSignatureVerification: true,
      version: '1.0.0',
    });

    const updated = await marketplace.update('test-provider');
    expect(updated).toBe(true);

    const installedExt = marketplace.getInstalledExtension('test-provider');
    expect(installedExt?.installedVersion).toBe('1.1.0');
  });

  it('should enable and disable extensions', async () => {
    await marketplace.install('test-provider', {
      skipSignatureVerification: true,
      enableAfterInstall: false,
    });

    let installedExt = marketplace.getInstalledExtension('test-provider');
    expect(installedExt?.enabled).toBe(false);

    marketplace.enable('test-provider');
    installedExt = marketplace.getInstalledExtension('test-provider');
    expect(installedExt?.enabled).toBe(true);

    marketplace.disable('test-provider');
    installedExt = marketplace.getInstalledExtension('test-provider');
    expect(installedExt?.enabled).toBe(false);
  });

  it('should remove an installed extension', async () => {
    await marketplace.install('test-provider', {
      skipSignatureVerification: true,
    });

    const removed = await marketplace.remove('test-provider');
    expect(removed).toBe(true);

    const installedExt = marketplace.getInstalledExtension('test-provider');
    expect(installedExt).toBeUndefined();
  });

  it('should rollback to a previous version', async () => {
    await marketplace.install('test-provider', {
      skipSignatureVerification: true,
    });

    await marketplace.rollback('test-provider', {
      targetVersion: '1.0.0',
    });

    const installedExt = marketplace.getInstalledExtension('test-provider');
    expect(installedExt?.installedVersion).toBe('1.0.0');
  });

  it('should get marketplace statistics', () => {
    const stats = marketplace.getStats();
    expect(stats.totalExtensions).toBe(1);
    expect(stats.totalDownloads).toBe(1000);
    expect(stats.categories['AI Providers']).toBe(1);
  });

  it('should register a publisher', () => {
    const publisher: PublisherProfile = {
      id: 'test-publisher',
      name: 'Test Publisher',
      verified: true,
      bio: 'A test publisher',
      website: 'https://example.com',
      extensions: ['test-provider'],
      joinedAt: '2024-01-01',
    };

    marketplace.registerPublisher(publisher);
    const stats = marketplace.getStats();
    expect(stats.totalPublishers).toBe(1);
    expect(stats.verifiedPublishers).toBe(1);
  });

  it('should emit events on installation', async () => {
    const eventHandler = vi.fn();
    marketplace.on('extensionInstalled', eventHandler);

    await marketplace.install('test-provider', {
      skipSignatureVerification: true,
    });

    expect(eventHandler).toHaveBeenCalledWith('test-provider', '1.1.0');
  });

  it('should emit events on update', async () => {
    const eventHandler = vi.fn();
    marketplace.on('extensionUpdated', eventHandler);

    await marketplace.install('test-provider', {
      skipSignatureVerification: true,
      version: '1.0.0',
    });

    await marketplace.update('test-provider');

    expect(eventHandler).toHaveBeenCalledWith('test-provider', '1.0.0', '1.1.0');
  });

  it('should emit events on removal', async () => {
    const eventHandler = vi.fn();
    marketplace.on('extensionRemoved', eventHandler);

    await marketplace.install('test-provider', {
      skipSignatureVerification: true,
    });

    await marketplace.remove('test-provider');

    expect(eventHandler).toHaveBeenCalledWith('test-provider');
  });
});
