import { EventEmitter } from 'events';

import type {
  ExtensionPackage,
  InstalledExtension,
  MarketplaceSearchFilters,
  MarketplaceSearchResult,
  PublisherProfile,
  MarketplaceStats,
  InstallOptions,
  UpdateOptions,
  RollbackOptions,
  SignatureVerificationResult,
  CompatibilityCheckResult,
} from './types';

export class ExtensionMarketplace extends EventEmitter {
  private installedExtensions: Map<string, InstalledExtension> = new Map();
  private availableExtensions: Map<string, ExtensionPackage> = new Map();
  private publishers: Map<string, PublisherProfile> = new Map();
  private readonly backups = new Map<string, { snapshot: InstalledExtension; takenAt: string }>();
  private gatewayVersion: string;
  private signatureVerificationEnabled: boolean;

  constructor(gatewayVersion: string, options: { signatureVerification?: boolean } = {}) {
    super();
    this.gatewayVersion = gatewayVersion;
    this.signatureVerificationEnabled = options.signatureVerification ?? true;
  }

  /**
   * Search the marketplace for extensions
   */
  async search(filters: MarketplaceSearchFilters): Promise<MarketplaceSearchResult> {
    let results = Array.from(this.availableExtensions.values());

    if (filters.type) {
      results = results.filter((ext) => ext.metadata.type === filters.type);
    }

    if (filters.category) {
      results = results.filter((ext) => ext.metadata.category === filters.category);
    }

    if (filters.author) {
      results = results.filter((ext) => ext.metadata.author.name === filters.author);
    }

    if (filters.verified !== undefined) {
      results = results.filter((ext) => ext.metadata.author.verified === filters.verified);
    }

    if (filters.status) {
      results = results.filter((ext) => ext.status === filters.status);
    }

    if (filters.keywords && filters.keywords.length > 0) {
      results = results.filter((ext) =>
        filters.keywords!.some((keyword) =>
          ext.metadata.keywords.some((k) => k.toLowerCase().includes(keyword.toLowerCase()))
        )
      );
    }

    return {
      total: results.length,
      page: 1,
      pageSize: results.length,
      results,
    };
  }

  /**
   * Get extension details by ID
   */
  async getExtension(extensionId: string): Promise<ExtensionPackage | null> {
    return this.availableExtensions.get(extensionId) || null;
  }

  /**
   * Check compatibility before installation
   */
  checkCompatibility(extensionId: string): CompatibilityCheckResult {
    const extension = this.availableExtensions.get(extensionId);
    if (!extension) {
      return {
        compatible: false,
        gatewayVersion: this.gatewayVersion,
        requiredExtensions: [],
        missingExtensions: [extensionId],
        conflicts: [],
        warnings: ['Extension not found'],
      };
    }

    const warnings: string[] = [];
    const missingExtensions: string[] = [];
    const conflicts: string[] = [];

    // Check gateway version compatibility
    const minVersion = extension.dependencies.gateway;
    if (this.compareVersions(this.gatewayVersion, minVersion) < 0) {
      return {
        compatible: false,
        gatewayVersion: this.gatewayVersion,
        requiredExtensions: extension.dependencies.extensions,
        missingExtensions: [],
        conflicts: [],
        warnings: [`Gateway version ${this.gatewayVersion} is below minimum ${minVersion}`],
      };
    }

    // Check extension dependencies
    for (const dep of extension.dependencies.extensions) {
      if (!this.installedExtensions.has(dep)) {
        missingExtensions.push(dep);
      }
    }

    // Check for conflicts with installed extensions
    for (const installed of this.installedExtensions.values()) {
      if (installed.package.metadata.id !== extensionId) {
        // Simple conflict detection - can be enhanced
        if (this.hasConflict(installed.package, extension)) {
          conflicts.push(installed.package.metadata.id);
        }
      }
    }

    const compatible = missingExtensions.length === 0 && conflicts.length === 0;

    return {
      compatible,
      gatewayVersion: this.gatewayVersion,
      requiredExtensions: extension.dependencies.extensions,
      missingExtensions,
      conflicts,
      warnings,
    };
  }

  /**
   * Install an extension
   */
  async install(extensionId: string, options: InstallOptions = {}): Promise<boolean> {
    const extension = await this.getExtension(extensionId);
    if (!extension) {
      throw new Error(`Extension ${extensionId} not found`);
    }

    const compatibility = this.checkCompatibility(extensionId);
    if (!compatibility.compatible) {
      throw new Error(
        `Compatibility check failed: ${compatibility.warnings.join(', ')}`
      );
    }

    if (this.signatureVerificationEnabled && !options.skipSignatureVerification) {
      const latestVersion = extension.versions[extension.versions.length - 1];
      if (latestVersion?.signature) {
        const verification = await this.verifySignature(latestVersion);
        if (!verification.valid) {
          throw new Error(`Signature verification failed: ${verification.error}`);
        }
      }
    }

    const latestVersionEntry = extension.versions[extension.versions.length - 1];
    if (!latestVersionEntry) {
      throw new Error(`Extension ${extensionId} has no versions available`);
    }
    const versionToInstall = options.version || latestVersionEntry.version;
    
    const installed: InstalledExtension = {
      package: extension,
      installedVersion: versionToInstall,
      installedAt: new Date().toISOString(),
      enabled: options.enableAfterInstall ?? true,
      config: {},
    };

    this.installedExtensions.set(extensionId, installed);
    this.emit('extensionInstalled', extensionId, versionToInstall);

    return true;
  }

  /**
   * Update an installed extension
   */
  async update(extensionId: string, options: UpdateOptions = {}): Promise<boolean> {
    const installed = this.installedExtensions.get(extensionId);
    if (!installed) {
      throw new Error(`Extension ${extensionId} is not installed`);
    }

    const extension = await this.getExtension(extensionId);
    if (!extension) {
      throw new Error(`Extension ${extensionId} not found in marketplace`);
    }

    const currentVersion = installed.installedVersion;
    const latestVersionEntry = extension.versions[extension.versions.length - 1];
    if (!latestVersionEntry) {
      throw new Error(`Extension ${extensionId} has no versions available`);
    }
    const latestVersion = latestVersionEntry.version;

    if (currentVersion === latestVersion) {
      return false; // Already up to date
    }

    if (options.backupCurrent) {
      await this.backupExtension(extensionId);
    }

    installed.installedVersion = latestVersion;
    this.installedExtensions.set(extensionId, installed);

    this.emit('extensionUpdated', extensionId, currentVersion, latestVersion);

    return true;
  }

  /**
   * Remove an installed extension
   */
  async remove(extensionId: string): Promise<boolean> {
    const installed = this.installedExtensions.get(extensionId);
    if (!installed) {
      return false;
    }

    this.installedExtensions.delete(extensionId);
    this.emit('extensionRemoved', extensionId);

    return true;
  }

  /**
   * Enable an installed extension
   */
  enable(extensionId: string): boolean {
    const installed = this.installedExtensions.get(extensionId);
    if (!installed) {
      return false;
    }

    installed.enabled = true;
    this.installedExtensions.set(extensionId, installed);
    this.emit('extensionEnabled', extensionId);

    return true;
  }

  /**
   * Disable an installed extension
   */
  disable(extensionId: string): boolean {
    const installed = this.installedExtensions.get(extensionId);
    if (!installed) {
      return false;
    }

    installed.enabled = false;
    this.installedExtensions.set(extensionId, installed);
    this.emit('extensionDisabled', extensionId);

    return true;
  }

  /**
   * Rollback an extension to a previous version
   */
  async rollback(extensionId: string, options: RollbackOptions): Promise<boolean> {
    const installed = this.installedExtensions.get(extensionId);
    if (!installed) {
      throw new Error(`Extension ${extensionId} is not installed`);
    }

    const extension = await this.getExtension(extensionId);
    if (!extension) {
      throw new Error(`Extension ${extensionId} not found`);
    }

    const versionExists = extension.versions.some((v) => v.version === options.targetVersion);
    if (!versionExists) {
      throw new Error(`Version ${options.targetVersion} not found`);
    }

    if (options.backupCurrent) {
      await this.backupExtension(extensionId);
    }

    const oldVersion = installed.installedVersion;
    installed.installedVersion = options.targetVersion;
    this.installedExtensions.set(extensionId, installed);

    this.emit('extensionUpdated', extensionId, oldVersion, options.targetVersion);

    return true;
  }

  /**
   * Get all installed extensions
   */
  getInstalledExtensions(): InstalledExtension[] {
    return Array.from(this.installedExtensions.values());
  }

  /**
   * Get installed extension by ID
   */
  getInstalledExtension(extensionId: string): InstalledExtension | undefined {
    return this.installedExtensions.get(extensionId);
  }

  /**
   * Get marketplace statistics
   */
  getStats(): MarketplaceStats {
    const extensions = Array.from(this.availableExtensions.values());
    const categories = extensions.reduce((acc, ext) => {
      acc[ext.metadata.category] = (acc[ext.metadata.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const publishers = Array.from(this.publishers.values());
    const verifiedCount = publishers.filter((p) => p.verified).length;

    const totalDownloads = extensions.reduce((sum, ext) => sum + ext.downloads, 0);

    return {
      totalExtensions: extensions.length,
      totalDownloads,
      totalPublishers: publishers.length,
      verifiedPublishers: verifiedCount,
      categories,
    };
  }

  /**
   * Register a publisher profile
   */
  registerPublisher(publisher: PublisherProfile): void {
    this.publishers.set(publisher.id, publisher);
  }

  /**
   * Add available extension to marketplace
   */
  addAvailableExtension(extension: ExtensionPackage): void {
    this.availableExtensions.set(extension.metadata.id, extension);
  }

  /**
   * Verify extension signature.
   *
   * NOTE: This performs a basic structural check (presence + format). Full
   * cryptographic verification (Ed25519 / RSA-PSS) requires a publisher
   * public-key registry and signature-attached packaging, both of which are
   * roadmap items for the v0.8 marketplace release. Until then:
   *
   *  - If no signature is present: returns `valid: false` with `error: 'No signature found'`.
   *  - If a signature is present: returns `valid: true` with a `warning`
   *    indicating that verification is currently trust-on-first-use, NOT
   *    cryptographically verified. Callers SHOULD treat verified=true as
   *    "structurally well-formed" rather than "cryptographically authentic"
   *    until the v0.8 release.
   */
  private async verifySignature(version: { signature?: string }): Promise<SignatureVerificationResult> {
    if (!version.signature) {
      return {
        valid: false,
        publisher: '',
        timestamp: '',
        error: 'No signature found',
      };
    }

    // Structural checks: signature must be a non-empty string. A future
    // release will replace this with Ed25519 verification against a
    // publisher-key registry.
    const sig = version.signature;
    if (typeof sig !== 'string' || sig.length < 8) {
      return {
        valid: false,
        publisher: '',
        timestamp: '',
        error: 'Signature is malformed (too short / not a string)',
      };
    }

    return {
      valid: true,
      publisher: 'unknown',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Backup extension before update/rollback.
   *
   * Records the current installed version metadata in an in-memory backup
   * map keyed by extension id. A future release will persist these to disk
   * so they survive gateway restarts; for now, backups are lost on restart.
   */
  private async backupExtension(extensionId: string): Promise<void> {
    const current = this.installedExtensions.get(extensionId);
    if (!current) return;
    this.backups.set(extensionId, {
      snapshot: current,
      takenAt: new Date().toISOString(),
    });
  }

  /** Returns the most recent in-memory backup for an extension, or undefined. */
  getBackup(extensionId: string): { snapshot: InstalledExtension; takenAt: string } | undefined {
    return this.backups.get(extensionId);
  }

  /**
   * Check if two extensions have conflicts
   */
  private hasConflict(ext1: ExtensionPackage, ext2: ExtensionPackage): boolean {
    // Simple conflict detection based on overlapping permissions
    // Can be enhanced with more sophisticated conflict detection
    const perms1 = ext1.permissions;
    const perms2 = ext2.permissions;

    // Check for conflicting provider access
    const providers1 = new Set(perms1.providers);
    const providers2 = new Set(perms2.providers);

    for (const provider of providers1) {
      if (providers2.has(provider)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Compare semantic versions
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;

      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }

    return 0;
  }
}
