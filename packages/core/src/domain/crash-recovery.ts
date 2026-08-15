/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Crash Recovery Domain Models — Phase 32 Durable Runtime & Recovery
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { MissionStatus } from './mission.js';

export type RecoveryAction = 'RESUME' | 'RETRY' | 'CANCEL' | 'REPAIR' | 'DISCARD';

export interface InterruptedMissionDiagnostic {
  missionId: string;
  objective: string;
  status: MissionStatus;
  lastCheckpointAt?: number;
  completedTasksCount: number;
  interruptedTasksCount: number;
  totalTasksCount: number;
  reconciliationStatus: 'RECOVERABLE' | 'AUTO_RESUMED' | 'ABANDONED' | 'FAILED' | 'REQUIRES_OPERATOR';
  reason?: string;
  suggestedAction: RecoveryAction;
}

export interface AbandonedExecutionDiagnostic {
  executionId: string;
  agentId: string;
  missionId?: string;
  taskId?: string;
  pid?: number;
  processAlive: boolean;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABANDONED' | 'CANCELLED';
  startedAt: number;
  workspace?: string;
  reconciliation: 'TERMINATED' | 'ORPHAN_CLEANED' | 'MARKED_ABANDONED';
}

export interface CrashRecoveryReport {
  timestamp: number;
  startupDurationMs: number;
  status: 'CLEAN_START' | 'RECOVERED' | 'DEGRADED_RECOVERY' | 'RECOVERY_REQUIRED';
  durableStorageAvailable: boolean;
  schemaVersion: number;
  interruptedMissions: InterruptedMissionDiagnostic[];
  abandonedExecutions: AbandonedExecutionDiagnostic[];
  rehydratedModelsCount: number;
  rehydratedProvidersCount: number;
  summary: {
    totalInterruptedMissions: number;
    autoResumedMissions: number;
    abandonedMissions: number;
    totalAbandonedExecutions: number;
    quarantinedCorruptCheckpoints: number;
  };
}
