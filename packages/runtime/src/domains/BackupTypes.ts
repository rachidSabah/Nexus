/**
 * Backup Domain Types
 */

export type BackupType = 'full' | 'incremental' | 'differential';
export type BackupStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'cancelled';
export type BackupScope = 'configuration' | 'marketplace' | 'workflows' | 'providers' | 'secrets' | 'policies' | 'full-system';
export type RestoreStrategy = 'overwrite' | 'merge' | 'side-by-side';

export interface BackupEntry {
  id: string;
  name: string;
  description?: string;
  type: BackupType;
  scope: BackupScope[];
  status: BackupStatus;
  size: number;
  compressedSize: number;
  encryptionEnabled: boolean;
  createdAt: Date;
  completedAt?: Date;
  expiresAt?: Date;
  retentionDays: number;
  location: BackupLocation;
  metadata: BackupMetadata;
  checksums: Checksums;
  version: string;
}

export interface BackupLocation {
  provider: 'local' | 's3' | 'gcs' | 'azure-blob' | 'sftp';
  bucket?: string;
  path: string;
  region?: string;
  endpoint?: string;
}

export interface BackupMetadata {
  gatewayVersion: string;
  nodeCount: number;
  providersCount: number;
  modelsCount: number;
  workflowsCount: number;
  pluginsCount: number;
  policiesCount: number;
  organizationsCount: number;
  usersCount: number;
  configurationHash: string;
  includedComponents: string[];
  excludedComponents: string[];
  notes?: string;
  tags: string[];
  triggeredBy: 'manual' | 'scheduled' | 'pre-update' | 'api';
  scheduleId?: string;
}

export interface Checksums {
  sha256: string;
  md5?: string;
  individualFiles?: Map<string, string>;
}

export interface BackupConfig {
  enabled: boolean;
  type: BackupType;
  scope: BackupScope[];
  schedule: ScheduleConfig;
  retention: RetentionConfig;
  storage: StorageConfig;
  encryption: EncryptionConfig;
  compression: CompressionConfig;
  notifications: NotificationConfig;
  preBackupHooks: HookConfig[];
  postBackupHooks: HookConfig[];
}

export interface ScheduleConfig {
  enabled: boolean;
  cronExpression: string;
  timezone: string;
  maxBackups: number;
  backupWindow?: TimeWindow;
}

export interface TimeWindow {
  startHour: number;
  endHour: number;
}

export interface RetentionConfig {
  dailyBackups: number;
  weeklyBackups: number;
  monthlyBackups: number;
  yearlyBackups: number;
  minRetentionDays: number;
  maxRetentionDays: number;
  deleteOnExpiry: boolean;
  archiveOldBackups: boolean;
  archiveAfterDays: number;
}

export interface StorageConfig {
  primary: BackupLocation;
  replicas?: BackupLocation[];
  replicationEnabled: boolean;
  replicationFactor: number;
}

export interface EncryptionConfig {
  enabled: boolean;
  algorithm: 'aes-256-gcm' | 'chacha20-poly1305';
  keyManagement: 'local' | 'kms' | 'vault';
  keyRef?: string;
  encryptMetadata: boolean;
}

export interface CompressionConfig {
  enabled: boolean;
  algorithm: 'gzip' | 'zstd' | 'lz4' | 'brotli';
  level: number;
}

export interface NotificationConfig {
  onSuccess: boolean;
  onFailure: boolean;
  onExpiry: boolean;
  channels: string[];
  recipients: string[];
}

export interface HookConfig {
  name: string;
  type: 'script' | 'webhook' | 'function';
  scriptPath?: string;
  webhookUrl?: string;
  functionRef?: string;
  timeoutSeconds: number;
  continueOnError: boolean;
}

export interface RestoreConfig {
  backupId: string;
  strategy: RestoreStrategy;
  scope?: BackupScope[];
  targetEnvironment?: string;
  validateBeforeRestore: boolean;
  createPreRestoreBackup: boolean;
  dryRun: boolean;
  overwriteExisting: boolean;
  mergeConflicts: 'prefer-backup' | 'prefer-current' | 'keep-both';
  excludeComponents?: string[];
  includeOnlyComponents?: string[];
}

export interface RestoreResult {
  success: boolean;
  restoredComponents: string[];
  failedComponents: string[];
  skippedComponents: string[];
  conflicts: ConflictResolution[];
  errors: string[];
  warnings: string[];
  durationMs: number;
  startedAt: Date;
  completedAt: Date;
}

export interface ConflictResolution {
  component: string;
  conflictType: 'version' | 'data' | 'schema';
  resolution: string;
  resolvedBy: 'auto' | 'manual';
}

export interface VersionHistory {
  id: string;
  version: string;
  backupId?: string;
  changes: ChangeEntry[];
  createdAt: Date;
  createdBy: string;
  canRollback: boolean;
}

export interface ChangeEntry {
  component: string;
  action: 'created' | 'updated' | 'deleted' | 'migrated';
  details: Record<string, unknown>;
  previousValue?: unknown;
  newValue?: unknown;
}

export interface BackupRecoveryStats {
  totalBackups: number;
  successfulBackups: number;
  failedBackups: number;
  totalRestores: number;
  successfulRestores: number;
  failedRestores: number;
  averageBackupTimeMs: number;
  averageRestoreTimeMs: number;
  totalStorageUsedBytes: number;
  oldestBackupDate: Date;
  newestBackupDate: Date;
  upcomingScheduledBackups: ScheduledBackup[];
}

export interface ScheduledBackup {
  scheduleId: string;
  nextRunAt: Date;
  type: BackupType;
  scope: BackupScope[];
}
