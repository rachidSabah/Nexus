/**
 * Governance Domain Types
 */

export type PolicyScope = 'organization' | 'project' | 'team' | 'user' | 'environment' | 'global';
export type PolicyType = 'provider' | 'model' | 'usage' | 'cost' | 'data-residency' | 'compliance' | 'security';
export type PolicyAction = 'allow' | 'deny' | 'require-approval' | 'audit-only';
export type ComplianceStandard = 'SOC2' | 'HIPAA' | 'GDPR' | 'PCI-DSS' | 'ISO27001' | 'custom';

export interface Policy {
  id: string;
  name: string;
  description?: string;
  scope: PolicyScope;
  type: PolicyType;
  rules: PolicyRule[];
  action: PolicyAction;
  priority: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  tags: string[];
}

export interface PolicyRule {
  id: string;
  condition: Condition;
  constraints: Constraint[];
}

export interface Condition {
  type: 'attribute' | 'event' | 'time' | 'combination';
  attribute?: AttributeCondition;
  event?: EventCondition;
  time?: TimeCondition;
  combination?: CombinationCondition;
}

export interface AttributeCondition {
  path: string;
  operator: 'eq' | 'neq' | 'in' | 'not-in' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'regex';
  value: unknown;
}

export interface EventCondition {
  eventType: string;
  source?: string;
  pattern?: Record<string, unknown>;
}

export interface TimeCondition {
  startTime: string;
  endTime: string;
  timezone: string;
  daysOfWeek?: number[];
}

export interface CombinationCondition {
  operator: 'and' | 'or' | 'not';
  conditions: Condition[];
}

export interface Constraint {
  type: 'quota' | 'rate-limit' | 'allow-list' | 'deny-list' | 'requirement';
  quota?: QuotaConstraint;
  rateLimit?: RateLimitConstraint;
  allowList?: AllowListConstraint;
  denyList?: DenyListConstraint;
  requirement?: RequirementConstraint;
}

export interface QuotaConstraint {
  metric: 'requests' | 'tokens' | 'cost' | 'storage';
  limit: number;
  period: 'minute' | 'hour' | 'day' | 'month' | 'year';
}

export interface RateLimitConstraint {
  requestsPerSecond: number;
  burstSize: number;
}

export interface AllowListConstraint {
  attribute: string;
  values: string[];
}

export interface DenyListConstraint {
  attribute: string;
  values: string[];
}

export interface RequirementConstraint {
  attribute: string;
  required: boolean;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}

export interface GovernanceConfig {
  organizationId: string;
  policies: Policy[];
  approvalWorkflows: ApprovalWorkflow[];
  complianceRules: ComplianceRule[];
  dataResidencyRules: DataResidencyRule[];
  auditEnabled: boolean;
  enforcementMode: 'strict' | 'permissive' | 'audit-only';
}

export interface ApprovalWorkflow {
  id: string;
  name: string;
  description?: string;
  trigger: ApprovalTrigger;
  approvers: Approver[];
  steps: ApprovalStep[];
  timeoutHours: number;
  autoDenyOnTimeout: boolean;
}

export interface ApprovalTrigger {
  policyIds: string[];
  actionTypes: string[];
  thresholds: ThresholdConfig[];
}

export interface ThresholdConfig {
  metric: string;
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  value: number;
}

export interface Approver {
  userId?: string;
  roleId?: string;
  teamId?: string;
  type: 'user' | 'role' | 'team';
  order: number;
}

export interface ApprovalStep {
  stepNumber: number;
  approvers: Approver[];
  approvalType: 'any' | 'all' | 'majority';
  minimumApprovals?: number;
}

export interface ComplianceRule {
  id: string;
  standard: ComplianceStandard;
  name: string;
  description: string;
  requirements: ComplianceRequirement[];
  evidenceRequired: boolean;
  reviewFrequencyDays: number;
  lastReviewDate?: Date;
  nextReviewDate?: Date;
  status: 'compliant' | 'non-compliant' | 'pending-review';
}

export interface ComplianceRequirement {
  id: string;
  control: string;
  description: string;
  policyIds: string[];
  verificationMethod: 'automated' | 'manual' | 'hybrid';
}

export interface DataResidencyRule {
  id: string;
  region: string;
  countries: string[];
  dataTypes: string[];
  storageRequirement: 'local-only' | 'replicated' | 'no-restriction';
  processingRequirement: 'local-only' | 'allowed-regions' | 'no-restriction';
  allowedRegions?: string[];
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  action: PolicyAction;
  appliedPolicies: string[];
  deniedBy?: string;
  requiresApproval?: boolean;
  approvalWorkflowId?: string;
  warnings: string[];
  auditLog: AuditLogEntry;
}

export interface AuditLogEntry {
  timestamp: Date;
  action: string;
  resource: string;
  actor: string;
  result: 'allowed' | 'denied' | 'pending-approval';
  policyIds: string[];
  details: Record<string, unknown>;
}
