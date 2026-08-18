/**
 * Marketplace Types for Agent Nexus Gateway
 */

export type ExtensionType = 
  | 'provider'
  | 'mcp-server'
  | 'workflow'
  | 'agent'
  | 'tool'
  | 'prompt'
  | 'template'
  | 'theme'
  | 'plugin';

export type ExtensionStatus = 
  | 'available'
  | 'installed'
  | 'updating'
  | 'disabled'
  | 'deprecated';

export interface ExtensionMetadata {
  id: string;
  name: string;
  description: string;
  version: string;
  type: ExtensionType;
  category: string;
  author: {
    name: string;
    verified: boolean;
    url?: string;
  };
  repository?: {
    url: string;
    type: 'github' | 'gitlab' | 'bitbucket';
  };
  homepage?: string;
  license: string;
  keywords: string[];
  screenshots?: string[];
  readme?: string;
}

export interface ExtensionVersion {
  version: string;
  releaseDate: string;
  changelog?: string;
  downloadUrl: string;
  checksum: string;
  signature?: string;
  minGatewayVersion: string;
  maxGatewayVersion?: string;
}

export interface ExtensionDependencies {
  gateway: string;
  extensions: string[];
  providers: string[];
}

export interface ExtensionPermissions {
  network: boolean;
  filesystem: boolean;
  environment: boolean;
  secrets: boolean;
  providers: string[];
  models: string[];
}

export interface ExtensionConfig {
  settings: Record<string, any>;
  envVars: string[];
  secrets: string[];
}

export interface ExtensionPackage {
  metadata: ExtensionMetadata;
  versions: ExtensionVersion[];
  dependencies: ExtensionDependencies;
  permissions: ExtensionPermissions;
  config: ExtensionConfig;
  downloads: number;
  rating: {
    average: number;
    count: number;
  };
  status: ExtensionStatus;
  publishedAt: string;
  updatedAt: string;
}

export interface InstalledExtension {
  package: ExtensionPackage;
  installedVersion: string;
  installedAt: string;
  enabled: boolean;
  config: Record<string, any>;
}

export interface MarketplaceSearchFilters {
  type?: ExtensionType;
  category?: string;
  author?: string;
  verified?: boolean;
  status?: ExtensionStatus;
  keywords?: string[];
}

export interface MarketplaceSearchResult {
  total: number;
  page: number;
  pageSize: number;
  results: ExtensionPackage[];
}

export interface PublisherProfile {
  id: string;
  name: string;
  verified: boolean;
  bio?: string;
  website?: string;
  extensions: string[];
  joinedAt: string;
}

export interface MarketplaceStats {
  totalExtensions: number;
  totalDownloads: number;
  totalPublishers: number;
  verifiedPublishers: number;
  categories: Record<string, number>;
}

export interface InstallOptions {
  version?: string;
  enableAfterInstall?: boolean;
  skipSignatureVerification?: boolean;
}

export interface UpdateOptions {
  autoUpdate?: boolean;
  backupCurrent?: boolean;
}

export interface RollbackOptions {
  targetVersion: string;
  backupCurrent?: boolean;
}

export interface SignatureVerificationResult {
  valid: boolean;
  publisher: string;
  timestamp: string;
  error?: string;
}

export interface CompatibilityCheckResult {
  compatible: boolean;
  gatewayVersion: string;
  requiredExtensions: string[];
  missingExtensions: string[];
  conflicts: string[];
  warnings: string[];
}

export interface MarketplaceEvent {
  type: 'extension_installed'
    | 'extension_updated'
    | 'extension_removed'
    | 'extension_enabled'
    | 'extension_disabled'
    | 'publisher_verified'
    | 'rating_submitted';
  extensionId: string;
  timestamp: string;
  metadata?: Record<string, any>;
}
