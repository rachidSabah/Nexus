/**
 * @anx/core — Phase 31 Unified System Health Model & Diagnostics Domain
 */

export type SystemHealthStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNAVAILABLE'
  | 'ERROR'
  | 'NOT_CONFIGURED'
  | 'UNKNOWN';

export type SubsystemName =
  | 'gateway'
  | 'providers'
  | 'models'
  | 'apiKeys'
  | 'routing'
  | 'failover'
  | 'localAgents'
  | 'missionEngine'
  | 'applicationEngine'
  | 'tokenEngine'
  | 'memory'
  | 'networking'
  | 'security'
  | 'persistence';

export interface SubsystemHealthReport {
  subsystem: SubsystemName;
  status: SystemHealthStatus;
  healthy: boolean;
  message: string;
  metrics: Record<string, unknown>;
  lastCheckedAt: number;
  latencyMs?: number;
  remediation?: string;
}

export interface UnifiedSystemHealthReport {
  status: SystemHealthStatus;
  healthy: boolean;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  subsystems: Record<SubsystemName, SubsystemHealthReport>;
  summary: {
    totalSubsystems: number;
    healthySubsystems: number;
    degradedSubsystems: number;
    unavailableSubsystems: number;
    errorSubsystems: number;
  };
}

export interface DiagnosticIssue {
  subsystem: SubsystemName;
  status: SystemHealthStatus;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  issue: string;
  rootCause: string;
  remediation: string;
  details?: Record<string, unknown>;
}

export interface SystemDiagnosticsReport {
  status: SystemHealthStatus;
  generatedAt: string;
  version: string;
  environment: {
    platform: string;
    nodeVersion: string;
    arch: string;
    memoryRssMb: number;
    heapUsedMb: number;
    uptime: number;
  };
  diagnostics: DiagnosticIssue[];
  checksPassed: number;
  checksFailed: number;
  recommendations: string[];
}
