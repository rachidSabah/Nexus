/**
 * Secrets Domain Types
 */

export type SecretProviderType = 'local' | 'kubernetes' | 'vault' | 'aws-secrets-manager' | 'azure-key-vault' | 'gcp-secret-manager';
export type EncryptionAlgorithm = 'aes-256-gcm' | 'chacha20-poly1305';

export interface SecretEntry {
  id: string;
  name: string;
  description?: string;
  provider: SecretProviderType;
  encryptedValue: EncryptedValue;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  rotationPolicy?: SecretRotationPolicy;
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface EncryptedValue {
  algorithm: EncryptionAlgorithm;
  ciphertext: string;
  iv: string;
  authTag?: string;
  keyId: string;
  encryptedAt: Date;
}

export interface SecretRotationPolicy {
  enabled: boolean;
  intervalDays: number;
  autoRotate: boolean;
  notifyBeforeDays: number;
  notificationChannels: string[];
  lastRotatedAt?: Date;
  nextRotationAt?: Date;
  rotationHistory: RotationEvent[];
}

export interface RotationEvent {
  timestamp: Date;
  fromVersion: number;
  toVersion: number;
  status: 'success' | 'failed' | 'pending';
  reason?: string;
  performedBy?: string;
}

export interface SecretProvider {
  id: string;
  name: string;
  type: SecretProviderType;
  config: ProviderConfig;
  status: 'connected' | 'disconnected' | 'error';
  lastSyncAt?: Date;
  capabilities: ProviderCapabilities;
}

export interface ProviderConfig {
  endpoint?: string;
  region?: string;
  projectId?: string;
  vaultPath?: string;
  kubernetesNamespace?: string;
  authMethod: 'token' | 'certificate' | 'iam' | 'service-account' | 'managed-identity';
  credentialsRef?: string;
}

export interface ProviderCapabilities {
  supportsRotation: boolean;
  supportsVersioning: boolean;
  supportsAudit: boolean;
  maxSecretSize: number;
  rateLimit?: number;
}

export interface SecretsManagerConfig {
  defaultProvider: string;
  encryptionKeyRef: string;
  backupEnabled: boolean;
  backupIntervalHours: number;
  auditLogEnabled: boolean;
  cacheEnabled: boolean;
  cacheTTLSeconds: number;
}

export interface SecretValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

export interface SecretImportExport {
  format: 'json' | 'yaml' | 'env';
  includeMetadata: boolean;
  includeHistory: boolean;
  encryptOnExport: boolean;
  data: string;
}
