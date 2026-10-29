/**
 * SQLite-backed intelligence repository (Node 22+ `node:sqlite`).
 *
 * Follows the @anx/persistence conventions: raw SQL via `DatabaseSync`,
 * idempotent versioned migrations applied on lazy open, snake_case columns,
 * and ISO-string timestamps. All untrusted text reaching this layer is already
 * redacted by the ingestion pipeline — this class performs no security checks
 * of its own and MUST only be fed scrubbed data.
 *
 * The intelligence schema is versioned independently from @anx/persistence's
 * global schema (schema_migrations is shared, per-package version rows are
 * namespaced with a `intelligence/` prefix).
 */

import type {
  SqliteDB,
} from '@anx/persistence';

import type { IntelligenceRepository } from './repository.js';
import type {
  AccessPlanFilter,
  AccessPlanRecord,
  AdapterVersionFilter,
  AdapterVersionRecord,
  AdapterTestResults,
  AdapterManifest,
  ApprovalFilter,
  ApprovalRequestRecord,
  AuditEventRecord,
  ClaimedCapabilities,
  ConnectorCheckpoint,
  ConnectorRecord,
  DiscoveryJobFilter,
  DiscoveryJobRecord,
  EndpointRecord,
  EvidenceFilter,
  EvidenceRecord,
  ModelFilter,
  ModelRecord,
  ProviderFilter,
  ProviderModelFilter,
  ProviderModelRecord,
  ProviderRecord,
  SecurityFindingFilter,
  SecurityFindingRecord,
  SecurityFindingStatus,
  VerificationRunFilter,
  VerificationRunRecord,
} from './types.js';


const INTELLIGENCE_SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS intelligence_providers (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  canonical_domain TEXT,
  official_docs_url TEXT,
  trust_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (trust_status IN ('unverified','verified','restricted','rejected')),
  provider_kind TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intelligence_models (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  family TEXT,
  input_modalities_json TEXT NOT NULL DEFAULT '[]',
  output_modalities_json TEXT NOT NULL DEFAULT '[]',
  context_window INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intelligence_provider_models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  provider_model_id TEXT NOT NULL,
  display_name TEXT,
  lifecycle TEXT NOT NULL DEFAULT 'discovered'
    CHECK (lifecycle IN ('discovered','normalized','evidence_checked','verified','partially_verified','unverified','stale','restricted','adapter_ready','awaiting_approval','approved','active','rejected')),
  availability_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (availability_status IN ('unknown','available','unavailable','stale')),
  pricing_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (pricing_status IN ('unknown','verified','unverified','stale')),
  context_window INTEGER,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_verified_at TEXT,
  UNIQUE(provider_id, provider_model_id)
);

CREATE TABLE IF NOT EXISTS intelligence_endpoints (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_style TEXT NOT NULL DEFAULT 'unknown'
    CHECK (api_style IN ('openai-compatible','anthropic','google','ollama','unknown')),
  health_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (health_status IN ('unknown','live','unreachable','blocked')),
  last_verified_at TEXT,
  source_url TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS intelligence_access_plans (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  provider_model_id TEXT,
  plan_type TEXT NOT NULL DEFAULT 'unknown'
    CHECK (plan_type IN ('free','free-trial','paid','unknown')),
  input_per_1m REAL,
  output_per_1m REAL,
  currency TEXT,
  quota_window TEXT,
  quota_limit TEXT,
  eligibility TEXT,
  billing_conditions TEXT,
  source_url TEXT NOT NULL DEFAULT '',
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intelligence_connectors (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'healthy',
  last_run_at TEXT,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  checkpoint_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intelligence_evidence (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT UNIQUE NOT NULL,
  subject_type TEXT NOT NULL
    CHECK (subject_type IN ('provider','model','provider_model','endpoint','access_plan','security')),
  subject_id TEXT NOT NULL,
  claim_type TEXT NOT NULL
    CHECK (claim_type IN ('identity','model_catalog','endpoint','pricing','free_access','capability','security')),
  source_url TEXT NOT NULL,
  connector_id TEXT,
  source_authority REAL NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL,
  content_hash TEXT,
  summary TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  redacted INTEGER NOT NULL DEFAULT 0 CHECK (redacted IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_intel_evidence_subject ON intelligence_evidence(subject_type, subject_id, observed_at);

CREATE TABLE IF NOT EXISTS intelligence_verification_runs (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  provider_id TEXT,
  dimension TEXT NOT NULL
    CHECK (dimension IN ('identity','existence','endpoint','availability','capability','pricing','free_access','security')),
  result TEXT NOT NULL
    CHECK (result IN ('passed','failed','unknown','stale','restricted')),
  detail TEXT NOT NULL DEFAULT '',
  latency_ms INTEGER,
  evidence_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_intel_verif_subject ON intelligence_verification_runs(subject_type, subject_id, dimension, created_at);

CREATE TABLE IF NOT EXISTS intelligence_jobs (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'discovery'
    CHECK (kind IN ('discovery','verification')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  cursor TEXT,
  scheduled_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  last_error_at TEXT,
  updated_at TEXT NOT NULL,
  payload_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_intel_jobs_status ON intelligence_jobs(status, scheduled_at);

CREATE TABLE IF NOT EXISTS intelligence_findings (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'low'
    CHECK (severity IN ('critical','high','medium','low','info')),
  confidence REAL NOT NULL DEFAULT 0,
  provider_id TEXT,
  source_ref TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  redacted INTEGER NOT NULL DEFAULT 1 CHECK (redacted IN (0,1)),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','acknowledged','notified','resolved','dismissed')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intel_findings_status ON intelligence_findings(status, first_seen_at);

CREATE TABLE IF NOT EXISTS intelligence_adapter_versions (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','tested','awaiting_approval','approved','rejected','active','disabled','superseded')),
  manifest_json TEXT NOT NULL,
  artifact_hash TEXT UNIQUE NOT NULL,
  tests_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intelligence_approvals (
  id TEXT PRIMARY KEY,
  adapter_version_id TEXT NOT NULL,
  adapter_artifact_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','approved','rejected')),
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intelligence_audit (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  subject TEXT NOT NULL,
  detail_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_intel_audit_at ON intelligence_audit(at);
`;

export class IntelligenceSchemaManager {
  static async applyMigrations(db: SqliteDB): Promise<void> {
    // Own migration ledger — never touch @anx/persistence's INTEGER-keyed
    // schema_migrations with text keys.
    db.exec(`CREATE TABLE IF NOT EXISTS intelligence_schema_migrations (
      version TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );`);
    const existing = db
      .prepare('SELECT version FROM intelligence_schema_migrations WHERE version = ? LIMIT 1')
      .get(`v${INTELLIGENCE_SCHEMA_VERSION}`) as { version?: string } | undefined;
    if (existing?.version) return;
    db.exec(SCHEMA_SQL);
    db.prepare('INSERT INTO intelligence_schema_migrations (version, description, applied_at) VALUES (?, ?, ?)').run(
      `v${INTELLIGENCE_SCHEMA_VERSION}`,
      'AI Provider Intelligence OS canonical schema (providers, models, provider_models, endpoints, access_plans, connectors, evidence, verification_runs, jobs, findings, adapter_versions, approvals, audit)',
      new Date().toISOString(),
    );
  }
}

function rowToProvider(r: Record<string, unknown>): ProviderRecord {
  return {
    id: String(r['id']),
    canonicalName: String(r['canonical_name']),
    canonicalDomain: (r['canonical_domain'] as string) ?? undefined,
    officialDocsUrl: (r['official_docs_url'] as string) ?? undefined,
    trustStatus: r['trust_status'] as ProviderRecord['trustStatus'],
    providerKind: (r['provider_kind'] as string) ?? undefined,
    firstSeenAt: String(r['first_seen_at']),
    lastSeenAt: String(r['last_seen_at']),
    updatedAt: String(r['updated_at']),
  };
}

function rowToModel(r: Record<string, unknown>): ModelRecord {
  return {
    id: String(r['id']),
    canonicalName: String(r['canonical_name']),
    family: (r['family'] as string) ?? undefined,
    inputModalities: safeParseArray(r['input_modalities_json']),
    outputModalities: safeParseArray(r['output_modalities_json']),
    contextWindow: (r['context_window'] as number | null) ?? undefined,
    metadata: safeParseObject(r['metadata_json']),
    firstSeenAt: String(r['first_seen_at']),
    lastSeenAt: String(r['last_seen_at']),
  };
}

function rowToProviderModel(r: Record<string, unknown>): ProviderModelRecord {
  return {
    id: String(r['id']),
    providerId: String(r['provider_id']),
    modelId: String(r['model_id']),
    providerModelId: String(r['provider_model_id']),
    displayName: (r['display_name'] as string) ?? undefined,
    lifecycle: r['lifecycle'] as ProviderModelRecord['lifecycle'],
    availabilityStatus: r['availability_status'] as ProviderModelRecord['availabilityStatus'],
    pricingStatus: r['pricing_status'] as ProviderModelRecord['pricingStatus'],
    contextWindow: (r['context_window'] as number | null) ?? undefined,
    capabilities: safeParseObject(r['capabilities_json']) as ClaimedCapabilities,
    confidence: Number(r['confidence'] ?? 0),
    firstSeenAt: String(r['first_seen_at']),
    lastSeenAt: String(r['last_seen_at']),
    lastVerifiedAt: (r['last_verified_at'] as string) ?? undefined,
  };
}

function rowToEndpoint(r: Record<string, unknown>): EndpointRecord {
  return {
    id: String(r['id']),
    providerId: String(r['provider_id']),
    baseUrl: String(r['base_url']),
    apiStyle: r['api_style'] as EndpointRecord['apiStyle'],
    healthStatus: r['health_status'] as EndpointRecord['healthStatus'],
    lastVerifiedAt: (r['last_verified_at'] as string) ?? undefined,
    sourceUrl: String(r['source_url'] ?? ''),
  };
}

function rowToAccessPlan(r: Record<string, unknown>): AccessPlanRecord {
  return {
    id: String(r['id']),
    providerId: String(r['provider_id']),
    providerModelId: (r['provider_model_id'] as string) ?? undefined,
    planType: r['plan_type'] as AccessPlanRecord['planType'],
    inputPer1M: (r['input_per_1m'] as number | null) ?? undefined,
    outputPer1M: (r['output_per_1m'] as number | null) ?? undefined,
    currency: (r['currency'] as string) ?? undefined,
    quotaWindow: (r['quota_window'] as string) ?? undefined,
    quotaLimit: (r['quota_limit'] as string) ?? undefined,
    eligibility: (r['eligibility'] as string) ?? undefined,
    billingConditions: (r['billing_conditions'] as string) ?? undefined,
    sourceUrl: String(r['source_url'] ?? ''),
    verifiedAt: (r['verified_at'] as string) ?? undefined,
    createdAt: String(r['created_at']),
    updatedAt: String(r['updated_at']),
  };
}

function rowToEvidence(r: Record<string, unknown>): EvidenceRecord {
  return {
    id: String(r['id']),
    dedupeKey: String(r['dedupe_key']),
    subjectType: r['subject_type'] as EvidenceRecord['subjectType'],
    subjectId: String(r['subject_id']),
    claimType: r['claim_type'] as EvidenceRecord['claimType'],
    sourceUrl: String(r['source_url']),
    connectorId: (r['connector_id'] as string) ?? undefined,
    sourceAuthority: Number(r['source_authority'] ?? 0),
    observedAt: String(r['observed_at']),
    contentHash: (r['content_hash'] as string) ?? undefined,
    summary: String(r['summary'] ?? ''),
    confidence: Number(r['confidence'] ?? 0),
    redacted: Number(r['redacted'] ?? 0) === 1,
  };
}

function rowToVerificationRun(r: Record<string, unknown>): VerificationRunRecord {
  return {
    id: String(r['id']),
    subjectType: r['subject_type'] as VerificationRunRecord['subjectType'],
    subjectId: String(r['subject_id']),
    providerId: (r['provider_id'] as string) ?? undefined,
    dimension: r['dimension'] as VerificationRunRecord['dimension'],
    result: r['result'] as VerificationRunRecord['result'],
    detail: String(r['detail'] ?? ''),
    latencyMs: (r['latency_ms'] as number | null) ?? undefined,
    evidenceId: (r['evidence_id'] as string) ?? undefined,
    createdAt: String(r['created_at']),
    expiresAt: (r['expires_at'] as string) ?? undefined,
  };
}

function rowToJob(r: Record<string, unknown>): DiscoveryJobRecord {
  return {
    id: String(r['id']),
    connectorId: String(r['connector_id']),
    kind: r['kind'] as DiscoveryJobRecord['kind'],
    status: r['status'] as DiscoveryJobRecord['status'],
    attempts: Number(r['attempts'] ?? 0),
    maxAttempts: Number(r['max_attempts'] ?? 5),
    cursor: (r['cursor'] as string) ?? undefined,
    scheduledAt: String(r['scheduled_at']),
    startedAt: (r['started_at'] as string) ?? undefined,
    finishedAt: (r['finished_at'] as string) ?? undefined,
    error: (r['error'] as string) ?? undefined,
    lastErrorAt: (r['last_error_at'] as string) ?? undefined,
    updatedAt: String(r['updated_at']),
    payload: safeParseObject(r['payload_json']),
  };
}

function rowToFinding(r: Record<string, unknown>): SecurityFindingRecord {
  return {
    id: String(r['id']),
    dedupeKey: String(r['dedupe_key']),
    title: String(r['title']),
    category: r['category'] as SecurityFindingRecord['category'],
    severity: r['severity'] as SecurityFindingRecord['severity'],
    confidence: Number(r['confidence'] ?? 0),
    providerId: (r['provider_id'] as string) ?? undefined,
    sourceRef: String(r['source_ref'] ?? ''),
    excerpt: String(r['excerpt'] ?? ''),
    redacted: Number(r['redacted'] ?? 1) === 1,
    status: r['status'] as SecurityFindingRecord['status'],
    firstSeenAt: String(r['first_seen_at']),
    lastSeenAt: String(r['last_seen_at']),
  };
}

function rowToAdapter(r: Record<string, unknown>): AdapterVersionRecord {
  return {
    id: String(r['id']),
    providerId: String(r['provider_id']),
    version: String(r['version']),
    status: r['status'] as AdapterVersionRecord['status'],
    manifest: JSON.parse(String(r['manifest_json'])) as AdapterManifest,
    artifactHash: String(r['artifact_hash']),
    tests: JSON.parse(String(r['tests_json'])) as AdapterTestResults,
    createdAt: String(r['created_at']),
    updatedAt: String(r['updated_at']),
  };
}

function rowToApproval(r: Record<string, unknown>): ApprovalRequestRecord {
  return {
    id: String(r['id']),
    adapterVersionId: String(r['adapter_version_id']),
    adapterArtifactHash: String(r['adapter_artifact_hash']),
    state: r['state'] as ApprovalRequestRecord['state'],
    requestedBy: String(r['requested_by']),
    requestedAt: String(r['requested_at']),
    decidedBy: (r['decided_by'] as string) ?? undefined,
    decidedAt: (r['decided_at'] as string) ?? undefined,
    decisionNote: (r['decision_note'] as string) ?? undefined,
    updatedAt: String(r['updated_at']),
  };
}

function safeParseArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeParseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class SqliteIntelligenceRepository implements IntelligenceRepository {
  private dbPromise: Promise<SqliteDB> | undefined;

  constructor(
    private readonly path: string,
    private readonly openDb: (p: string) => Promise<SqliteDB>,
  ) {}

  private async db(): Promise<SqliteDB> {
    if (!this.dbPromise) {
      this.dbPromise = this.openDb(this.path).then(async (db) => {
        await IntelligenceSchemaManager.applyMigrations(db);
        return db;
      });
    }
    return this.dbPromise;
  }

  private async q(sql: string, params: unknown[]): Promise<Array<Record<string, unknown>>> {
    const db = await this.db();
    return db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  }

  private async x(sql: string, params: unknown[]): Promise<void> {
    const db = await this.db();
    db.prepare(sql).run(...params);
  }

  private async q1(sql: string, params: unknown[]): Promise<Record<string, unknown> | undefined> {
    const db = await this.db();
    return db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
  }

  async upsertProvider(p: ProviderRecord): Promise<void> {
    await this.x(
      `INSERT INTO intelligence_providers (id, canonical_name, canonical_domain, official_docs_url, trust_status, provider_kind, first_seen_at, last_seen_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         canonical_name = excluded.canonical_name,
         canonical_domain = COALESCE(excluded.canonical_domain, intelligence_providers.canonical_domain),
         official_docs_url = COALESCE(excluded.official_docs_url, intelligence_providers.official_docs_url),
         provider_kind = COALESCE(excluded.provider_kind, intelligence_providers.provider_kind),
         last_seen_at = MAX(excluded.last_seen_at, intelligence_providers.last_seen_at),
         updated_at = excluded.updated_at`,
      [p.id, p.canonicalName, p.canonicalDomain ?? null, p.officialDocsUrl ?? null, p.trustStatus, p.providerKind ?? null, p.firstSeenAt, p.lastSeenAt, p.updatedAt],
    );
  }

  async getProvider(id: string): Promise<ProviderRecord | undefined> {
    const row = await this.q1('SELECT * FROM intelligence_providers WHERE id = ?', [id]);
    return row ? rowToProvider(row) : undefined;
  }

  async listProviders(filter?: ProviderFilter): Promise<ProviderRecord[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filter?.trust) {
      conds.push('trust_status = ?');
      params.push(filter.trust);
    }
    if (filter?.q) {
      conds.push('(id LIKE ? OR canonical_name LIKE ? OR COALESCE(canonical_domain, "") LIKE ?)');
      const like = `%${filter.q}%`;
      params.push(like, like, like);
    }
    const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
    const rows = await this.q(
      `SELECT * FROM intelligence_providers${where} ORDER BY last_seen_at DESC LIMIT ?`,
      [...params, Math.min(filter?.limit ?? 200, 500)],
    );
    return rows.map(rowToProvider);
  }

  async upsertModel(m: ModelRecord): Promise<void> {
    await this.x(
      `INSERT INTO intelligence_models (id, canonical_name, family, input_modalities_json, output_modalities_json, context_window, metadata_json, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         canonical_name = excluded.canonical_name,
         family = COALESCE(excluded.family, intelligence_models.family),
         input_modalities_json = excluded.input_modalities_json,
         output_modalities_json = excluded.output_modalities_json,
         context_window = COALESCE(excluded.context_window, intelligence_models.context_window),
         metadata_json = excluded.metadata_json,
         last_seen_at = MAX(excluded.last_seen_at, intelligence_models.last_seen_at)`,
      [
        m.id,
        m.canonicalName,
        m.family ?? null,
        JSON.stringify(m.inputModalities ?? []),
        JSON.stringify(m.outputModalities ?? []),
        m.contextWindow ?? null,
        JSON.stringify(m.metadata ?? {}),
        m.firstSeenAt,
        m.lastSeenAt,
      ],
    );
  }

  async getModel(id: string): Promise<ModelRecord | undefined> {
    const row = await this.q1('SELECT * FROM intelligence_models WHERE id = ?', [id]);
    return row ? rowToModel(row) : undefined;
  }

  async listModels(filter?: ModelFilter): Promise<ModelRecord[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filter?.q) {
      conds.push('(id LIKE ? OR canonical_name LIKE ?)');
      const like = `%${filter.q}%`;
      params.push(like, like);
    }
    if (filter?.minContext) {
      conds.push('context_window >= ?');
      params.push(filter.minContext);
    }
    const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
    const rows = await this.q(
      `SELECT * FROM intelligence_models${where} ORDER BY last_seen_at DESC LIMIT ?`,
      [...params, Math.min(filter?.limit ?? 200, 1000)],
    );
    return rows.map(rowToModel);
  }

  async upsertProviderModel(
    p: ProviderModelRecord,
    opts?: { createOnly?: boolean },
  ): Promise<'created' | 'updated'> {
    const existing = await this.q1('SELECT id FROM intelligence_provider_models WHERE id = ?', [p.id]);
    if (existing?.['id'] && opts?.createOnly) return 'updated';
    await this.x(
      `INSERT INTO intelligence_provider_models
        (id, provider_id, model_id, provider_model_id, display_name, lifecycle, availability_status, pricing_status, context_window, capabilities_json, confidence, first_seen_at, last_seen_at, last_verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name = COALESCE(excluded.display_name, intelligence_provider_models.display_name),
         context_window = COALESCE(excluded.context_window, intelligence_provider_models.context_window),
         capabilities_json = excluded.capabilities_json,
         confidence = excluded.confidence,
         last_seen_at = MAX(excluded.last_seen_at, intelligence_provider_models.last_seen_at),
         last_verified_at = COALESCE(excluded.last_verified_at, intelligence_provider_models.last_verified_at)`,
      [
        p.id,
        p.providerId,
        p.modelId,
        p.providerModelId,
        p.displayName ?? null,
        p.lifecycle,
        p.availabilityStatus,
        p.pricingStatus,
        p.contextWindow ?? null,
        JSON.stringify(p.capabilities ?? {}),
        p.confidence,
        p.firstSeenAt,
        p.lastSeenAt,
        p.lastVerifiedAt ?? null,
      ],
    );
    return existing ? 'updated' : 'created';
  }

  async getProviderModel(providerId: string, providerModelId: string): Promise<ProviderModelRecord | undefined> {
    const row = await this.q1('SELECT * FROM intelligence_provider_models WHERE provider_id = ? AND provider_model_id = ?', [
      providerId,
      providerModelId,
    ]);
    return row ? rowToProviderModel(row) : undefined;
  }

  async getProviderModelById(id: string): Promise<ProviderModelRecord | undefined> {
    const row = await this.q1('SELECT * FROM intelligence_provider_models WHERE id = ?', [id]);
    return row ? rowToProviderModel(row) : undefined;
  }

  async listProviderModels(filter?: ProviderModelFilter): Promise<ProviderModelRecord[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filter?.providerId) {
      conds.push('provider_id = ?');
      params.push(filter.providerId);
    }
    if (filter?.modelId) {
      conds.push('model_id = ?');
      params.push(filter.modelId);
    }
    if (filter?.lifecycle) {
      conds.push('lifecycle = ?');
      params.push(filter.lifecycle);
    }
    const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
    const rows = await this.q(
      `SELECT * FROM intelligence_provider_models${where} ORDER BY last_seen_at DESC LIMIT ?`,
      [...params, Math.min(filter?.limit ?? 200, 1000)],
    );
    return rows.map(rowToProviderModel);
  }

  async upsertEndpoint(e: EndpointRecord): Promise<void> {
    await this.x(
      `INSERT INTO intelligence_endpoints (id, provider_id, base_url, api_style, health_status, last_verified_at, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         base_url = excluded.base_url,
         api_style = excluded.api_style,
         health_status = excluded.health_status,
         last_verified_at = excluded.last_verified_at,
         source_url = COALESCE(excluded.source_url, intelligence_endpoints.source_url)`,
      [e.id, e.providerId, e.baseUrl, e.apiStyle, e.healthStatus, e.lastVerifiedAt ?? null, e.sourceUrl],
    );
  }

  async getEndpoint(id: string): Promise<EndpointRecord | undefined> {
    const row = await this.q1('SELECT * FROM intelligence_endpoints WHERE id = ?', [id]);
    return row ? rowToEndpoint(row) : undefined;
  }

  async listEndpoints(providerId?: string): Promise<EndpointRecord[]> {
    const rows = providerId
      ? await this.q('SELECT * FROM intelligence_endpoints WHERE provider_id = ?', [providerId])
      : await this.q('SELECT * FROM intelligence_endpoints', []);
    return rows.map(rowToEndpoint);
  }

  async upsertAccessPlan(a: AccessPlanRecord): Promise<void> {
    await this.x(
      `INSERT INTO intelligence_access_plans
        (id, provider_id, provider_model_id, plan_type, input_per_1m, output_per_1m, currency, quota_window, quota_limit, eligibility, billing_conditions, source_url, verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         plan_type = excluded.plan_type,
         input_per_1m = excluded.input_per_1m,
         output_per_1m = excluded.output_per_1m,
         currency = excluded.currency,
         quota_window = COALESCE(excluded.quota_window, intelligence_access_plans.quota_window),
         quota_limit = COALESCE(excluded.quota_limit, intelligence_access_plans.quota_limit),
         eligibility = COALESCE(excluded.eligibility, intelligence_access_plans.eligibility),
         billing_conditions = COALESCE(excluded.billing_conditions, intelligence_access_plans.billing_conditions),
         verified_at = COALESCE(excluded.verified_at, intelligence_access_plans.verified_at),
         updated_at = excluded.updated_at`,
      [
        a.id,
        a.providerId,
        a.providerModelId ?? null,
        a.planType,
        a.inputPer1M ?? null,
        a.outputPer1M ?? null,
        a.currency ?? null,
        a.quotaWindow ?? null,
        a.quotaLimit ?? null,
        a.eligibility ?? null,
        a.billingConditions ?? null,
        a.sourceUrl,
        a.verifiedAt ?? null,
        a.createdAt,
        a.updatedAt,
      ],
    );
  }

  async listAccessPlans(filter?: AccessPlanFilter): Promise<AccessPlanRecord[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filter?.freeOnly) conds.push("plan_type IN ('free','free-trial')");
    if (!filter?.freeOnly && filter?.providerId) {
      conds.push('provider_id = ?');
      params.push(filter.providerId);
    }
    const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
    const rows = await this.q(
      `SELECT * FROM intelligence_access_plans${where} ORDER BY updated_at DESC LIMIT ?`,
      [...params, Math.min(filter?.limit ?? 200, 1000)],
    );
    return rows.map(rowToAccessPlan);
  }

  async upsertConnector(c: ConnectorRecord): Promise<void> {
    await this.x(
      `INSERT INTO intelligence_connectors (id, status, last_run_at, last_error, consecutive_failures, checkpoint_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         last_run_at = COALESCE(excluded.last_run_at, intelligence_connectors.last_run_at),
         last_error = excluded.last_error,
         consecutive_failures = excluded.consecutive_failures,
         checkpoint_json = COALESCE(excluded.checkpoint_json, intelligence_connectors.checkpoint_json),
         updated_at = excluded.updated_at`,
      [
        c.id,
        c.status,
        c.lastRunAt ?? null,
        c.lastError ?? null,
        c.consecutiveFailures,
        c.checkpoint ? JSON.stringify(c.checkpoint) : null,
        c.updatedAt,
      ],
    );
  }

  async listConnectors(): Promise<ConnectorRecord[]> {
    const rows = await this.q('SELECT * FROM intelligence_connectors ORDER BY id', []);
    return rows.map((r) => ({
      id: String(r['id']),
      status: r['status'] as ConnectorRecord['status'],
      lastRunAt: (r['last_run_at'] as string) ?? undefined,
      lastError: (r['last_error'] as string) ?? undefined,
      consecutiveFailures: Number(r['consecutive_failures'] ?? 0),
      checkpoint: r['checkpoint_json'] ? (JSON.parse(String(r['checkpoint_json'])) as ConnectorCheckpoint) : undefined,
      updatedAt: String(r['updated_at']),
    }));
  }

  async getConnector(id: string): Promise<ConnectorRecord | undefined> {
    const rows = await this.listConnectors();
    return rows.find((c) => c.id === id);
  }

  async appendEvidence(e: EvidenceRecord): Promise<'created' | 'duplicate'> {
    const db = await this.db();
    const res = db
      .prepare(
        `INSERT OR IGNORE INTO intelligence_evidence
          (id, dedupe_key, subject_type, subject_id, claim_type, source_url, connector_id, source_authority, observed_at, content_hash, summary, confidence, redacted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.id,
        e.dedupeKey,
        e.subjectType,
        e.subjectId,
        e.claimType,
        e.sourceUrl,
        e.connectorId ?? null,
        e.sourceAuthority,
        e.observedAt,
        e.contentHash ?? null,
        e.summary,
        e.confidence,
        e.redacted ? 1 : 0,
      );
    const inserted = (res as unknown as { changes?: number })?.changes ?? 0;
    return inserted > 0 ? 'created' : 'duplicate';
  }

  async listEvidence(filter?: EvidenceFilter): Promise<EvidenceRecord[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filter?.subjectType) {
      conds.push('subject_type = ?');
      params.push(filter.subjectType);
    }
    if (filter?.subjectId) {
      conds.push('subject_id = ?');
      params.push(filter.subjectId);
    }
    if (filter?.claimType) {
      conds.push('claim_type = ?');
      params.push(filter.claimType);
    }
    const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
    const rows = await this.q(
      `SELECT * FROM intelligence_evidence${where} ORDER BY observed_at DESC LIMIT ?`,
      [...params, Math.min(filter?.limit ?? 200, 1000)],
    );
    return rows.map(rowToEvidence);
  }

  async countDistinctSources(subjectType: EvidenceFilter['subjectType'], subjectId: string): Promise<number> {
    const row = await this.q1(
      'SELECT COUNT(DISTINCT source_url) AS n FROM intelligence_evidence WHERE subject_type = ? AND subject_id = ?',
      [subjectType, subjectId],
    );
    return Number(row?.['n'] ?? 0);
  }

  async recordVerificationRun(r: VerificationRunRecord): Promise<void> {
    await this.x(
      `INSERT INTO intelligence_verification_runs
        (id, subject_type, subject_id, provider_id, dimension, result, detail, latency_ms, evidence_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.id,
        r.subjectType,
        r.subjectId,
        r.providerId ?? null,
        r.dimension,
        r.result,
        r.detail,
        r.latencyMs ?? null,
        r.evidenceId ?? null,
        r.createdAt,
        r.expiresAt ?? null,
      ],
    );
  }

  async listVerificationRuns(filter?: VerificationRunFilter): Promise<VerificationRunRecord[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filter?.subjectType) {
      conds.push('subject_type = ?');
      params.push(filter.subjectType);
    }
    if (filter?.subjectId) {
      conds.push('subject_id = ?');
      params.push(filter.subjectId);
    }
    if (filter?.dimension) {
      conds.push('dimension = ?');
      params.push(filter.dimension);
    }
    if (filter?.result) {
      conds.push('result = ?');
      params.push(filter.result);
    }
    const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
    const rows = await this.q(
      `SELECT * FROM intelligence_verification_runs${where} ORDER BY created_at DESC LIMIT ?`,
      [...params, Math.min(filter?.limit ?? 200, 2000)],
    );
    return rows.map(rowToVerificationRun);
  }

  async enqueueDiscoveryJob(j: DiscoveryJobRecord): Promise<void> {
    await this.x(
      `INSERT INTO intelligence_jobs
        (id, connector_id, kind, status, attempts, max_attempts, cursor, scheduled_at, started_at, finished_at, error, last_error_at, updated_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      [
        j.id,
        j.connectorId,
        j.kind,
        j.status,
        j.attempts,
        j.maxAttempts,
        j.cursor ?? null,
        j.scheduledAt,
        j.startedAt ?? null,
        j.finishedAt ?? null,
        j.error ?? null,
        j.lastErrorAt ?? null,
        j.updatedAt,
        j.payload ? JSON.stringify(j.payload) : null,
      ],
    );
  }

  async updateDiscoveryJob(j: DiscoveryJobRecord): Promise<void> {
    await this.x(
      `UPDATE intelligence_jobs SET status = ?, attempts = ?, cursor = ?, scheduled_at = ?, started_at = ?, finished_at = ?, error = ?, last_error_at = ?, updated_at = ?, payload_json = ? WHERE id = ?`,
      [
        j.status,
        j.attempts,
        j.cursor ?? null,
        j.scheduledAt,
        j.startedAt ?? null,
        j.finishedAt ?? null,
        j.error ?? null,
        j.lastErrorAt ?? null,
        j.updatedAt,
        j.payload ? JSON.stringify(j.payload) : null,
        j.id,
      ],
    );
  }

  async dueDiscoveryJobs(nowIso: string, limit = 10): Promise<DiscoveryJobRecord[]> {
    const rows = await this.q(
      `SELECT * FROM intelligence_jobs WHERE status IN ('queued','failed') AND attempts < max_attempts AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT ?`,
      [nowIso, limit],
    );
    return rows.map(rowToJob);
  }

  async listDiscoveryJobs(filter?: DiscoveryJobFilter): Promise<DiscoveryJobRecord[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filter?.connectorId) {
      conds.push('connector_id = ?');
      params.push(filter.connectorId);
    }
    if (filter?.status) {
      conds.push('status = ?');
      params.push(filter.status);
    }
    const where = conds.length ? ` WHERE ${conds.join(' AND ')} ` : '';
    const rows = await this.q(
      `SELECT * FROM intelligence_jobs${where}ORDER BY updated_at DESC LIMIT ?`,
      [...params, Math.min(filter?.limit ?? 50, 500)],
    );
    return rows.map(rowToJob);
  }

  async addSecurityFinding(f: SecurityFindingRecord): Promise<'created' | 'updated'> {
    const db = await this.db();
    const res = db
      .prepare(
        `INSERT OR IGNORE INTO intelligence_findings
          (id, dedupe_key, title, category, severity, confidence, provider_id, source_ref, excerpt, redacted, status, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      )
      .run(
        f.id,
        f.dedupeKey,
        f.title,
        f.category,
        f.severity,
        f.confidence,
        f.providerId ?? null,
        f.sourceRef,
        f.excerpt,
        f.redacted ? 1 : 0,
        f.firstSeenAt,
        f.lastSeenAt,
      );
    const inserted = (res as unknown as { changes?: number })?.changes ?? 0;
    if (inserted > 0) return 'created';
    await this.x('UPDATE intelligence_findings SET last_seen_at = ?, confidence = MAX(confidence, ?) WHERE dedupe_key = ?', [
      f.lastSeenAt,
      f.confidence,
      f.dedupeKey,
    ]);
    return 'updated';
  }

  async listSecurityFindings(filter?: SecurityFindingFilter): Promise<SecurityFindingRecord[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filter?.status) {
      conds.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.severity) {
      conds.push('severity = ?');
      params.push(filter.severity);
    }
    const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
    const rows = await this.q(`SELECT * FROM intelligence_findings${where} ORDER BY first_seen_at DESC LIMIT ?`, [
      ...params,
      Math.min(filter?.limit ?? 100, 1000),
    ]);
    return rows.map(rowToFinding);
  }

  async getSecurityFinding(id: string): Promise<SecurityFindingRecord | undefined> {
    const row = await this.q1('SELECT * FROM intelligence_findings WHERE id = ?', [id]);
    return row ? rowToFinding(row) : undefined;
  }

  async updateSecurityFindingStatus(id: string, status: SecurityFindingStatus, at: string): Promise<boolean> {
    await this.x('UPDATE intelligence_findings SET status = ?, last_seen_at = ? WHERE id = ?', [status, at, id]);
    return true;
  }

  async upsertAdapterVersion(a: AdapterVersionRecord): Promise<void> {
    await this.x(
      `INSERT INTO intelligence_adapter_versions (id, provider_id, version, status, manifest_json, artifact_hash, tests_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         manifest_json = excluded.manifest_json,
         artifact_hash = excluded.artifact_hash,
         tests_json = excluded.tests_json,
         updated_at = excluded.updated_at`,
      [
        a.id,
        a.providerId,
        a.version,
        a.status,
        JSON.stringify(a.manifest),
        a.artifactHash,
        JSON.stringify(a.tests),
        a.createdAt,
        a.updatedAt,
      ],
    );
  }

  async getAdapterVersion(id: string): Promise<AdapterVersionRecord | undefined> {
    const row = await this.q1('SELECT * FROM intelligence_adapter_versions WHERE id = ?', [id]);
    return row ? rowToAdapter(row) : undefined;
  }

  async listAdapterVersions(filter?: AdapterVersionFilter): Promise<AdapterVersionRecord[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filter?.providerId) {
      conds.push('provider_id = ?');
      params.push(filter.providerId);
    }
    if (filter?.status) {
      conds.push('status = ?');
      params.push(filter.status);
    }
    const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
    const rows = await this.q(`SELECT * FROM intelligence_adapter_versions${where} ORDER BY created_at DESC LIMIT ?`, [
      ...params,
      Math.min(filter?.limit ?? 100, 1000),
    ]);
    return rows.map(rowToAdapter);
  }

  async upsertApprovalRequest(a: ApprovalRequestRecord): Promise<void> {
    await this.x(
      `INSERT INTO intelligence_approvals
        (id, adapter_version_id, adapter_artifact_hash, state, requested_by, requested_at, decided_by, decided_at, decision_note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         state = excluded.state,
         decided_by = COALESCE(excluded.decided_by, intelligence_approvals.decided_by),
         decided_at = COALESCE(excluded.decided_at, intelligence_approvals.decided_at),
         decision_note = excluded.decision_note,
         updated_at = excluded.updated_at`,
      [
        a.id,
        a.adapterVersionId,
        a.adapterArtifactHash,
        a.state,
        a.requestedBy,
        a.requestedAt,
        a.decidedBy ?? null,
        a.decidedAt ?? null,
        a.decisionNote ?? null,
        a.updatedAt,
      ],
    );
  }

  async getApprovalRequest(id: string): Promise<ApprovalRequestRecord | undefined> {
    const row = await this.q1('SELECT * FROM intelligence_approvals WHERE id = ?', [id]);
    return row ? rowToApproval(row) : undefined;
  }

  async listApprovalRequests(filter?: ApprovalFilter): Promise<ApprovalRequestRecord[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filter?.state) {
      conds.push('state = ?');
      params.push(filter.state);
    }
    const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
    const rows = await this.q(`SELECT * FROM intelligence_approvals${where} ORDER BY requested_at DESC LIMIT ?`, [
      ...params,
      Math.min(filter?.limit ?? 100, 1000),
    ]);
    return rows.map(rowToApproval);
  }

  async appendAudit(e: AuditEventRecord): Promise<void> {
    await this.x(
      `INSERT INTO intelligence_audit (id, at, actor, action, subject, detail_json) VALUES (?, ?, ?, ?, ?, ?)`,
      [e.id, e.at, e.actor, e.action, e.subject, e.detail ? JSON.stringify(e.detail) : null],
    );
  }

  async listAudit(limit = 100): Promise<AuditEventRecord[]> {
    const rows = await this.q('SELECT * FROM intelligence_audit ORDER BY at DESC LIMIT ?', [Math.min(limit, 1000)]);
    return rows.map((r) => ({
      id: String(r['id']),
      at: String(r['at']),
      actor: String(r['actor']),
      action: String(r['action']),
      subject: String(r['subject']),
      detail: r['detail_json'] ? (JSON.parse(String(r['detail_json'])) as Record<string, unknown>) : undefined,
    }));
  }

  async overview() {
    const now = new Date().toISOString();
    const freshnessCutoff = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const [pmCount, verifiedEp, approvals, findings, providers, freePlans, stale, connectorsDegraded, lastRun] =
      await Promise.all([
        (await this.q('SELECT COUNT(*) AS n FROM intelligence_provider_models', []))[0]?.['n'],
        (
          await this.q(
            `SELECT COUNT(*) AS n FROM intelligence_endpoints WHERE health_status = 'live' AND last_verified_at >= ?`,
            [freshnessCutoff],
          )
        )[0]?.['n'],
        (await this.q(`SELECT COUNT(*) AS n FROM intelligence_approvals WHERE state = 'pending'`, []))[0]?.['n'],
        (await this.q(`SELECT COUNT(*) AS n FROM intelligence_findings WHERE status = 'open'`, []))[0]?.['n'],
        (await this.q('SELECT COUNT(*) AS n FROM intelligence_providers', []))[0]?.['n'],
        (await this.q(`SELECT COUNT(*) AS n FROM intelligence_access_plans WHERE plan_type IN ('free','free-trial')`, []))[0]?.['n'],
        (await this.q(`SELECT COUNT(*) AS n FROM intelligence_provider_models WHERE lifecycle = 'stale'`, []))[0]?.['n'],
        (await this.q(`SELECT COUNT(*) AS n FROM intelligence_connectors WHERE status != 'healthy'`, []))[0]?.['n'],
        (await this.q('SELECT MAX(last_run_at) AS t FROM intelligence_connectors', []))[0]?.['t'],
      ]);
    return {
      discoveredModels: Number(pmCount ?? 0),
      verifiedEndpoints: Number(verifiedEp ?? 0),
      pendingApprovals: Number(approvals ?? 0),
      openSecurityFindings: Number(findings ?? 0),
      providersCount: Number(providers ?? 0),
      freeAccessModels: Number(freePlans ?? 0),
      staleRecords: Number(stale ?? 0),
      degradedConnectors: Number(connectorsDegraded ?? 0),
      lastDiscoveryAt: lastRun ? String(lastRun) : undefined,
      generatedAt: now,
    };
  }
}
