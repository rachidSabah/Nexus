/**
 * Audit Domain Types
 */

export type AuditEventType = 
  | 'authentication'
  | 'authorization'
  | 'configuration-change'
  | 'provider-change'
  | 'model-change'
  | 'policy-change'
  | 'workflow-event'
  | 'marketplace-event'
  | 'deployment-event'
  | 'backup-event'
  | 'restore-event'
  | 'governance-event'
  | 'security-event'
  | 'system-event'
  | 'user-action'
  | 'api-call';

export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type AuditStatus = 'success' | 'failure' | 'partial' | 'pending';

export interface AuditEvent {
  id: string;
  timestamp: Date;
  type: AuditEventType;
  severity: AuditSeverity;
  actor: ActorInfo;
  action: string;
  resource: ResourceInfo;
  status: AuditStatus;
  outcome?: string;
  details: Record<string, unknown>;
  metadata: AuditMetadata;
  correlationId?: string;
  sessionId?: string;
  requestId?: string;
}

export interface ActorInfo {
  id: string;
  type: 'user' | 'system' | 'service' | 'api-key' | 'automated';
  name?: string;
  email?: string;
  role?: string;
  organizationId?: string;
  teamId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ResourceInfo {
  type: string;
  id: string;
  name?: string;
  path?: string;
  previousState?: Record<string, unknown>;
  currentState?: Record<string, unknown>;
}

export interface AuditMetadata {
  gatewayVersion: string;
  nodeId?: string;
  environment?: string;
  region?: string;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  changes?: ChangeDetail[];
  tags: string[];
}

export interface ChangeDetail {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changeType: 'create' | 'update' | 'delete';
}

export interface AuditTrail {
  id: string;
  resourceId: string;
  resourceType: string;
  events: AuditEvent[];
  startTime: Date;
  endTime: Date;
  eventCount: number;
  summary: TrailSummary;
}

export interface TrailSummary {
  totalEvents: number;
  successCount: number;
  failureCount: number;
  uniqueActors: number;
  eventTypes: Map<string, number>;
  severityBreakdown: Map<string, number>;
}

export interface AuditReport {
  id: string;
  title: string;
  description?: string;
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
  generatedBy: string;
  format: 'json' | 'csv' | 'pdf' | 'html';
  filters: ReportFilters;
  sections: ReportSection[];
  summary: ReportSummary;
  downloadUrl?: string;
  expiresAt?: Date;
}

export interface ReportFilters {
  eventTypes?: AuditEventType[];
  severities?: AuditSeverity[];
  actors?: string[];
  resources?: string[];
  status?: AuditStatus[];
  dateRange?: { start: Date; end: Date };
  organizations?: string[];
  teams?: string[];
  environments?: string[];
}

export interface ReportSection {
  title: string;
  type: 'table' | 'chart' | 'summary' | 'timeline';
  data: unknown;
  order: number;
}

export interface ReportSummary {
  totalEvents: number;
  eventsByType: Map<string, number>;
  eventsBySeverity: Map<string, number>;
  eventsByStatus: Map<string, number>;
  topActors: ActorActivity[];
  topResources: ResourceActivity[];
  anomalies: AnomalyDetection[];
  complianceStatus: ComplianceStatus;
}

export interface ActorActivity {
  actorId: string;
  actorName?: string;
  eventCount: number;
  successRate: number;
  mostCommonAction: string;
}

export interface ResourceActivity {
  resourceId: string;
  resourceName?: string;
  eventType: string;
  eventCount: number;
  lastActivity: Date;
}

export interface AnomalyDetection {
  type: 'unusual-activity' | 'failed-auth-spike' | 'privilege-escalation' | 'data-exfiltration';
  severity: AuditSeverity;
  description: string;
  detectedAt: Date;
  evidence: string[];
  recommendedActions: string[];
}

export interface ComplianceStatus {
  standard: string;
  compliant: boolean;
  findings: ComplianceFinding[];
  lastAuditDate: Date;
  nextAuditDate: Date;
}

export interface ComplianceFinding {
  id: string;
  requirement: string;
  status: 'compliant' | 'non-compliant' | 'partial';
  description: string;
  evidence?: string[];
  remediation?: string;
  severity: AuditSeverity;
}

export interface AuditConfig {
  enabled: boolean;
  retentionDays: number;
  storageBackend: 'database' | 'elasticsearch' | 's3' | 'hybrid';
  bufferSize: number;
  flushIntervalSeconds: number;
  includeRequestBody: boolean;
  includeResponseBody: boolean;
  maxBodySizeBytes: number;
  sensitiveFieldMasking: boolean;
  maskedFields: string[];
  realTimeStreaming: boolean;
  streamingDestinations: string[];
  alertingEnabled: boolean;
  alertRules: AlertRule[];
}

export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  condition: AlertCondition;
  severity: AuditSeverity;
  actions: AlertAction[];
  enabled: boolean;
  cooldownMinutes: number;
}

export interface AlertCondition {
  eventType?: AuditEventType;
  severity?: AuditSeverity;
  status?: AuditStatus;
  pattern?: string;
  threshold?: number;
  timeWindowMinutes?: number;
  aggregation?: 'count' | 'rate' | 'unique';
}

export interface AlertAction {
  type: 'email' | 'webhook' | 'slack' | 'pagerduty' | 'siem';
  destination: string;
  template?: string;
  includeDetails: boolean;
}

export interface AuditQuery {
  query: string;
  filters: QueryFilters;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  limit: number;
  offset: number;
  aggregations?: AggregationConfig[];
}

export interface QueryFilters {
  timeRange: TimeRange;
  eventTypes?: string[];
  actors?: string[];
  resources?: string[];
  severities?: string[];
  statuses?: string[];
}

export interface TimeRange {
  from: Date;
  to: Date;
}

export interface AggregationConfig {
  field: string;
  operation: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'distinct';
  groupBy?: string;
}

export interface AuditStats {
  totalEvents: number;
  eventsToday: number;
  eventsThisWeek: number;
  eventsThisMonth: number;
  storageUsedBytes: number;
  averageEventsPerDay: number;
  peakEventsPerHour: number;
  retentionCompliance: number;
  alertTriggeredToday: number;
  anomaliesDetectedToday: number;
}
