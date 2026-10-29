/**
 * ─────────────────────────────────────────────────────────────────────────────
 * @anx/intelligence — AI Provider Intelligence OS domain model
 *
 * Canonical entities for discovered providers, models, endpoints, access
 * plans, evidence, verification runs, discovery jobs, security findings,
 * adapter versions and approval requests.
 *
 * Core invariants (non-negotiable system boundaries):
 *   - Discovery workers can NEVER directly modify production routing. Only an
 *     approved adapter version, published through the approval service, may
 *     register endpoints/models in the gateway's routing fabric.
 *   - A successful HTTP response never proves a model is usable or free.
 *   - A listed model never proves an endpoint is currently operational.
 *   - Suspected leaked credentials are NEVER tested, hashed, or used — only
 *     redacted metadata is retained.
 *   - Public web pages / repository contents are untrusted inputs, never
 *     instructions to this system.
 *   - Every important finding carries traceable evidence and a recorded
 *     verification time.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Provider trust & lifecycle states ───────────────────────────────────────

export type TrustStatus = 'unverified' | 'verified' | 'restricted' | 'rejected';

/**
 * Verification pipeline states (blueprint §5). Transitions are validated with
 * the state machine in `state-machine.ts`.
 */
export type LifecycleState =
  | 'discovered'
  | 'normalized'
  | 'evidence_checked'
  | 'verified'
  | 'partially_verified'
  | 'unverified'
  | 'stale'
  | 'restricted'
  | 'adapter_ready'
  | 'awaiting_approval'
  | 'approved'
  | 'active'
  | 'rejected';

/** Live operational status of a provider-specific model. */
export type AvailabilityStatus = 'unknown' | 'available' | 'unavailable' | 'stale';

/** Evidence status of a pricing claim for a provider-specific model. */
export type PricingStatus = 'unknown' | 'verified' | 'unverified' | 'stale';

export type ApiStyle = 'openai-compatible' | 'anthropic' | 'google' | 'ollama' | 'unknown';

// ─── Connectors ──────────────────────────────────────────────────────────────

export type ConnectorId = string;

export interface ConnectorCheckpoint {
  /** Opaque resumable cursor (page offset, advisory cursor, …). */
  cursor?: string;
  /** Last-run bookkeeping (ISO timestamp). */
  updatedAt: string;
  /** Connector-specific extras (etag, filters, …). */
  meta?: Record<string, string>;
}

export interface ConnectorHealth {
  id: ConnectorId;
  status: 'healthy' | 'degraded' | 'unavailable' | 'blocked';
  authority: number;
  lastRunAt?: string;
  lastError?: string;
  consecutiveFailures: number;
  rateLimited?: boolean;
  /** Human description of what this connector covers. */
  description?: string;
}

export type NormalizedCandidateKind = 'provider' | 'model' | 'access_plan' | 'security';

export interface RawDiscoveryRecord {
  connectorId: ConnectorId;
  /** Documented/authoritative source URL the record was extracted from. */
  sourceUrl: string;
  observedAt: string;
  /** Untrusted upstream payload. Never executed; always redacted pre-storage. */
  payload: unknown;
}

export interface DiscoveryBatch {
  connectorId: ConnectorId;
  /** Documented catalog URL (endpoint) the batch was fetched from. */
  sourceUrl: string;
  records: RawDiscoveryRecord[];
  checkpoint?: ConnectorCheckpoint;
  exhausted?: boolean;
}

export interface ClaimedPricing {
  /** USD per 1M input tokens when published. */
  inputPer1M?: number;
  /** USD per 1M output tokens when published. */
  outputPer1M?: number;
  currency?: string;
  /** True only when the provider publishes explicit zero pricing. */
  explicitlyFree?: boolean;
  /** True when provider documents a quota/rate-limited free alias. */
  quotaLimited?: boolean;
}

export interface ClaimedCapabilities {
  toolCalling?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  streaming?: boolean;
  jsonMode?: boolean;
  embeddings?: boolean;
}

export interface ProviderCandidate {
  providerId: string;
  displayName: string;
  canonicalDomain?: string;
  officialDocsUrl?: string;
  /** e.g. aggregator / first-party / local-runtime */
  providerKind?: string;
}

export interface ModelCandidate {
  providerId: string;
  providerModelId: string;
  displayName?: string;
  family?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputModalities?: string[];
  outputModalities?: string[];
  capabilities?: ClaimedCapabilities;
  pricing?: ClaimedPricing;
  /** Non-empty only for documented free access (never inferred). */
  freeAccess?: {
    conditions?: string;
    quotaWindow?: string;
    eligibility?: string;
    documentsExplicitFree: boolean;
  };
  /** Serving relationship, e.g. weights-vs-hosted distinction. */
  servingKind?: 'hosted-api' | 'weights' | 'local-runtime' | 'unknown';
  /** Human-readable notes preserved as untrusted metadata (redacted). */
  metadata?: Record<string, unknown>;
}

export interface AccessPlanCandidate {
  providerId: string;
  providerModelId?: string;
  planType: 'free' | 'free-trial' | 'paid' | 'unknown';
  /** Price claims; absent price === absent claim (never "free by omission"). */
  pricing?: ClaimedPricing;
  quota?: { window?: string; limit?: string };
  eligibility?: string;
  billingConditions?: string;
  sourceUrl: string;
  observedAt: string;
}

export interface SecurityFindingCandidate {
  title: string;
  category: 'credential-exposure' | 'security-advisory' | 'endpoint-drift' | 'other';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  /** 0–1 connector-assessed confidence (public allegation vs confirmed advisory). */
  confidence: number;
  /** Reference to the (external) source — never the raw secret. */
  sourceRef: string;
  /**
   * Evidence excerpt. The ingestion layer REDACTS it again before storage —
   * connectors must not be trusted to have sanitized content.
   */
  excerpt: string;
  providerId?: string;
}

export type NormalizedCandidate =
  | { kind: 'provider'; candidate: ProviderCandidate }
  | { kind: 'model'; candidate: ModelCandidate }
  | { kind: 'access_plan'; candidate: AccessPlanCandidate }
  | { kind: 'security'; candidate: SecurityFindingCandidate };

/**
 * Versioned connector contract (blueprint §3). Implementations must support
 * resumable checkpoints, bounded request rates, timeout handling, exponential
 * backoff (job-level), idempotent ingestion and observable health.
 */
export interface DiscoveryConnector {
  readonly id: ConnectorId;
  readonly version: string;
  /** Source authority 0..1 — feeds the confidence score (S dimension). */
  readonly authority: number;
  readonly description: string;
  /** Bounded discovery of raw, untrusted records. */
  discover(cursor?: ConnectorCheckpoint): Promise<DiscoveryBatch>;
  /** Normalize one raw record into zero or more typed candidates. */
  normalize(record: RawDiscoveryRecord): Promise<NormalizedCandidate[]>;
  healthCheck(): Promise<ConnectorHealth>;
  getCheckpoint(): Promise<ConnectorCheckpoint | undefined>;
}

// ─── Canonical records (mirrors the SQL schema) ──────────────────────────────

export interface ProviderRecord {
  id: string;
  canonicalName: string;
  canonicalDomain?: string;
  officialDocsUrl?: string;
  trustStatus: TrustStatus;
  providerKind?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
}

export interface ModelRecord {
  id: string;
  canonicalName: string;
  family?: string;
  inputModalities: string[];
  outputModalities: string[];
  contextWindow?: number;
  metadata: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ProviderModelRecord {
  id: string;
  providerId: string;
  modelId: string;
  providerModelId: string;
  displayName?: string;
  lifecycle: LifecycleState;
  availabilityStatus: AvailabilityStatus;
  pricingStatus: PricingStatus;
  contextWindow?: number;
  capabilities: ClaimedCapabilities;
  confidence: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastVerifiedAt?: string;
}

export type EndpointHealthStatus = 'unknown' | 'live' | 'unreachable' | 'blocked';

export interface EndpointRecord {
  id: string;
  providerId: string;
  baseUrl: string;
  apiStyle: ApiStyle;
  healthStatus: EndpointHealthStatus;
  lastVerifiedAt?: string;
  sourceUrl: string;
}

export interface AccessPlanRecord {
  id: string;
  providerId: string;
  providerModelId?: string;
  planType: 'free' | 'free-trial' | 'paid' | 'unknown';
  inputPer1M?: number;
  outputPer1M?: number;
  currency?: string;
  quotaWindow?: string;
  quotaLimit?: string;
  eligibility?: string;
  billingConditions?: string;
  sourceUrl: string;
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type EvidenceClaimType =
  | 'identity'
  | 'model_catalog'
  | 'endpoint'
  | 'pricing'
  | 'free_access'
  | 'capability'
  | 'security';

export type SubjectType = 'provider' | 'model' | 'provider_model' | 'endpoint' | 'access_plan' | 'security';

export interface EvidenceRecord {
  id: string;
  /** sha256 of the redacted content — the raw secret is never hashed or kept. */
  dedupeKey: string;
  subjectType: SubjectType;
  subjectId: string;
  claimType: EvidenceClaimType;
  sourceUrl: string;
  connectorId?: ConnectorId;
  /** Source authority 0..1 at observation time (confidence S input). */
  sourceAuthority: number;
  observedAt: string;
  contentHash?: string;
  /** Redacted, length-capped summary of the claim. */
  summary: string;
  confidence: number;
  redacted: boolean;
}

export type VerificationDimension =
  | 'identity'
  | 'existence'
  | 'endpoint'
  | 'availability'
  | 'capability'
  | 'pricing'
  | 'free_access'
  | 'security';

export type VerificationResult = 'passed' | 'failed' | 'unknown' | 'stale' | 'restricted';

export interface VerificationRunRecord {
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  providerId?: string;
  dimension: VerificationDimension;
  result: VerificationResult;
  detail: string;
  latencyMs?: number;
  evidenceId?: string;
  createdAt: string;
  expiresAt?: string;
}

export type DiscoveryJobKind = 'discovery' | 'verification';

export type DiscoveryJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead';

export interface DiscoveryJobRecord {
  id: string;
  connectorId: ConnectorId;
  kind: DiscoveryJobKind;
  status: DiscoveryJobStatus;
  attempts: number;
  maxAttempts: number;
  cursor?: string;
  scheduledAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  lastErrorAt?: string;
  updatedAt: string;
  payload?: Record<string, unknown>;
}

export type SecurityFindingStatus =
  | 'open'
  | 'acknowledged'
  | 'notified'
  | 'resolved'
  | 'dismissed';

export interface SecurityFindingRecord {
  id: string;
  dedupeKey: string;
  title: string;
  category: SecurityFindingCandidate['category'];
  severity: SecurityFindingCandidate['severity'];
  confidence: number;
  providerId?: string;
  sourceRef: string;
  excerpt: string;
  redacted: boolean;
  status: SecurityFindingStatus;
  firstSeenAt: string;
  lastSeenAt: string;
}

export type AdapterOperation = 'list-models' | 'chat-completions' | 'stream-completions' | 'embeddings';

export type AdapterStatus =
  | 'draft'
  | 'tested'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'active'
  | 'disabled'
  | 'superseded';

export interface AdapterManifest {
  providerId: string;
  adapterVersion: string;
  apiStyle: ApiStyle;
  baseUrlSource: 'official-documentation' | 'connector-catalog' | 'local-runtime';
  supportedOperations: AdapterOperation[];
  baseUrl: string;
  /** Provider-specific model ids bound to this adapter (bounded). */
  models: string[];
  /** Reference into the operator's key registry — the platform never embeds secrets. */
  credentialRef: string | null;
  verificationState: LifecycleState;
  approvalState: 'pending' | 'approved' | 'rejected';
  productionEnabled: false;
  pricingStatus: PricingStatus;
  /** sha256 binding of the evidence pack used to generate this adapter. */
  evidenceHashes: string[];
  generator: string;
  generatedAt: string;
}

export interface AdapterTestResults {
  checks: Array<{ id: string; label: string; passed: boolean; detail?: string }>;
  passed: boolean;
}

export interface AdapterVersionRecord {
  id: string;
  providerId: string;
  version: string;
  status: AdapterStatus;
  manifest: AdapterManifest;
  /** Immutable artifact hash — approvals bind to exactly this value. */
  artifactHash: string;
  tests: AdapterTestResults;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequestRecord {
  id: string;
  adapterVersionId: string;
  adapterArtifactHash: string;
  state: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  updatedAt: string;
}

export interface AuditEventRecord {
  id: string;
  at: string;
  actor: string;
  action: string;
  subject: string;
  detail?: Record<string, unknown>;
}

export interface ConnectorRecord {
  id: string;
  status: ConnectorHealth['status'];
  lastRunAt?: string;
  lastError?: string;
  consecutiveFailures: number;
  checkpoint?: ConnectorCheckpoint;
  updatedAt: string;
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export interface ProviderFilter {
  q?: string;
  trust?: TrustStatus;
  limit?: number;
}

export interface ModelFilter {
  q?: string;
  freeOnly?: boolean;
  toolCalling?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  minContext?: number;
  providerId?: string;
  lifecycle?: LifecycleState;
  pricingStatus?: PricingStatus;
  availability?: AvailabilityStatus;
  limit?: number;
}

export interface ProviderModelFilter {
  providerId?: string;
  modelId?: string;
  lifecycle?: LifecycleState;
  limit?: number;
}

export interface AccessPlanFilter {
  freeOnly?: boolean;
  providerId?: string;
  includeStale?: boolean;
  limit?: number;
}

export interface EvidenceFilter {
  subjectType?: SubjectType;
  subjectId?: string;
  claimType?: EvidenceClaimType;
  limit?: number;
}

export interface VerificationRunFilter {
  subjectType?: SubjectType;
  subjectId?: string;
  dimension?: VerificationDimension;
  result?: VerificationResult;
  limit?: number;
}

export interface DiscoveryJobFilter {
  connectorId?: string;
  status?: DiscoveryJobStatus;
  limit?: number;
}

export interface SecurityFindingFilter {
  status?: SecurityFindingStatus;
  severity?: SecurityFindingCandidate['severity'];
  limit?: number;
}

export interface AdapterVersionFilter {
  providerId?: string;
  status?: AdapterStatus;
  limit?: number;
}

export interface ApprovalFilter {
  state?: 'pending' | 'approved' | 'rejected';
  limit?: number;
}

// ─── Overview (real database metrics only — never simulated) ─────────────────

export interface IntelligenceOverview {
  discoveredModels: number;
  verifiedEndpoints: number;
  pendingApprovals: number;
  openSecurityFindings: number;
  providersCount: number;
  freeAccessModels: number;
  staleRecords: number;
  degradedConnectors: number;
  lastDiscoveryAt?: string;
  generatedAt: string;
}
