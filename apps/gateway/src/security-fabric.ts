/**
 * Nexus Phase 19 — Security Fabric (spec §3–§9).
 *
 * THIN composition layer over already-present primitives. It does NOT introduce
 * a second authentication architecture or a new vault — it reuses:
 *   - `@anx/security` → `RbacService`, `BUILTIN_ROLES`, `JwtService`, `hashApiKey`
 *   - `InMemoryAuditLog` (`@anx/core`, `AuditLogPort`) — the existing `deps.audit`
 *
 * Adds the missing structure the audit flagged:
 *   - `TenantContext` (§6): in-memory, defaults `local`/`local-user`.
 *   - `SecurityContext` (§3): request-scoped principal + tenant + correlation ids.
 *   - `PolicyEngine` (§3/§5): default-DENY facade over `RbacService` with a
 *     structured decision + role classification.
 *   - `AuditLogger` (§8): immutable structured events, configurable prompt-audit
 *     policy, never stores secrets.
 *   - `redactSecrets()` (§9): pattern-based redaction for responses/logs/events.
 *   - `X-Nexus-Request-Id` correlation (§7) helper.
 *
 * Everything is local-first and works with zero configuration.
 */

import type { RbacService } from '@anx/security';
import type { AuditLogPort } from '@anx/core';

// ─────────────────────────────────────────────────────────────────────────────
// §6 — Tenant / Session Context
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId?: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly spanId?: string;
}

const DEFAULT_TENANT = 'local';
const DEFAULT_USER = 'local-user';

let requestCounter = 0;
function nextId(prefix: string): string {
  requestCounter = (requestCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}-${Date.now().toString(36)}-${requestCounter.toString(36)}`;
}

/** Creates a fresh request-scoped context. No database required. */
export function createTenantContext(overrides: Partial<TenantContext> = {}): TenantContext {
  const requestId = overrides.requestId ?? nextId('req');
  return {
    tenantId: overrides.tenantId ?? DEFAULT_TENANT,
    userId: overrides.userId ?? DEFAULT_USER,
    sessionId: overrides.sessionId,
    requestId,
    traceId: overrides.traceId ?? requestId,
    spanId: overrides.spanId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §3 — Security Context (request-scoped principal + tenant + correlation)
// ─────────────────────────────────────────────────────────────────────────────

export type PrincipalKind = 'unauthenticated' | 'authenticated' | 'administrator' | 'operator' | 'developer' | 'reader';

export interface SecurityContext {
  readonly principalId: string | undefined;
  readonly kind: PrincipalKind;
  readonly roles: readonly string[];
  readonly tenant: TenantContext;
}

/** Classifies a principal's highest privilege tier from its roles. */
export function classifyPrincipal(roles: readonly string[]): PrincipalKind {
  if (roles.includes('admin')) return 'administrator';
  if (roles.includes('operator')) return 'operator';
  if (roles.includes('developer')) return 'developer';
  if (roles.includes('reader')) return 'reader';
  if (roles.length > 0) return 'authenticated';
  return 'unauthenticated';
}

// ─────────────────────────────────────────────────────────────────────────────
// §3/§5 — Policy Engine (default-DENY facade over RbacService)
// ─────────────────────────────────────────────────────────────────────────────

export interface PolicyDecision {
  readonly allow: boolean;
  readonly principalId: string | undefined;
  readonly action: string;
  readonly resource: string;
  readonly reason: string;
}

export class PolicyEngine {
  constructor(
    private readonly rbac: RbacService,
    private readonly options: { authEnabled: boolean } = { authEnabled: true },
  ) {}

  /**
   * Default-DENY. If auth is disabled OR no enforceable principals exist
   * (open install), returns ALLOW with an anonymous/developer context so the
   * zero-config developer experience is preserved (mirrors `requirePermission`).
   */
  decide(principalId: string | undefined, action: string, resource: string, enforceablePrincipalCount: number): PolicyDecision {
    if (!this.options.authEnabled || enforceablePrincipalCount === 0) {
      return { allow: true, principalId, action, resource, reason: 'auth-disabled-or-open-install' };
    }
    if (!principalId) {
      return { allow: false, principalId, action, resource, reason: 'authentication-required' };
    }
    const ok = this.rbac.authorize(principalId, action, resource);
    return {
      allow: ok,
      principalId,
      action,
      resource,
      reason: ok ? 'authorized' : 'insufficient-permissions',
    };
  }

  rolesOf(principalId: string | undefined): readonly string[] {
    if (!principalId) return [];
    const p = this.rbac.getPrincipal(principalId);
    return p?.roles ?? [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8 — Structured Audit Logger (immutable, prompt-audit policy, no secrets)
// ─────────────────────────────────────────────────────────────────────────────

export type AuditEventType =
  | 'auth.login'
  | 'auth.failed'
  | 'authz.allow'
  | 'authz.deny'
  | 'provider.changed'
  | 'key.rotated'
  | 'model.routed'
  | 'agent.execution.started'
  | 'agent.execution.finished'
  | 'workflow.execution.started'
  | 'workflow.execution.finished'
  | 'application.build.started'
  | 'application.build.finished'
  | 'approval.decision'
  | 'config.changed'
  | 'security.violation'
  | 'rate.limited'
  | 'failover'
  | 'recovery'
  | 'cancellation';

export interface AuditEvent {
  readonly ts: string; // ISO
  readonly event: AuditEventType;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly agentId?: string;
  readonly model?: string;
  readonly provider?: string;
  readonly action?: string;
  readonly resource?: string;
  readonly principal?: string;
  readonly success: boolean;
  /** Prompt fragment is ONLY included when promptAuditEnabled is true. */
  readonly promptSnippet?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AuditLoggerConfig {
  /** When false (default), raw prompts are NEVER stored. */
  promptAuditEnabled: boolean;
  /** Max characters of a prompt to retain if promptAuditEnabled. */
  promptSnippetMaxLen: number;
}

/**
 * Wraps the existing `InMemoryAuditLog` (`AuditLogPort`) with a structured,
 * schema-driven event format. Secrets are never passed here (callers must
 * redact via `redactSecrets` first).
 */
export class AuditLogger {
  constructor(
    private readonly sink: AuditLogPort,
    private readonly config: AuditLoggerConfig = { promptAuditEnabled: false, promptSnippetMaxLen: 120 },
  ) {}

  async record(event: Omit<AuditEvent, 'ts'>): Promise<void> {
    // Honor prompt-audit policy: strip prompt unless explicitly enabled.
    const safe: AuditEvent = {
      ...event,
      ts: new Date().toISOString(),
      promptSnippet:
        this.config.promptAuditEnabled && event.promptSnippet
          ? event.promptSnippet.slice(0, this.config.promptSnippetMaxLen)
          : undefined,
    };
    await this.sink.append({
      principal: safe.principal ?? 'anonymous',
      action: safe.action ?? safe.event,
      resource: safe.resource ?? safe.event,
      result: safe.success ? 'allow' : 'deny',
      reason: safe.success ? undefined : safe.metadata?.reason as string | undefined,
      metadata: {
        event: safe.event,
        requestId: safe.requestId,
        traceId: safe.traceId,
        tenantId: safe.tenantId,
        userId: safe.userId,
        agentId: safe.agentId,
        model: safe.model,
        provider: safe.provider,
        promptSnippet: safe.promptSnippet,
        ...safe.metadata,
      },
    } as never);
  }

  query(filter: { principal?: string; action?: string; since?: Date; limit?: number }) {
    return this.sink.query(filter);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §9 — Secret redaction (reuse, do NOT build a new vault)
// ─────────────────────────────────────────────────────────────────────────────

// Order matters: specific patterns first.
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{8,}/g, 'sk-************'],
  [/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ************'],
  [/Authorization:\s*[A-Za-z0-9._\-]+/gi, 'Authorization: ************'],
  [/x-anx-[A-Za-z0-9_-]{8,}/gi, 'x-anx-************'],
  [/AKIA[0-9A-Z]{16}/g, 'AKIA************'],
  [/[a-z0-9]{32,}/gi, '************'], // generic long token fallback (length-gated)
];

/** Returns a copy of `input` with detected secret patterns redacted. */
export function redactSecrets<T>(input: T): T {
  if (typeof input === 'string') {
    let out: string = input;
    for (const [re, mask] of SECRET_PATTERNS) out = out.replace(re, mask);
    return out as unknown as T;
  }
  if (input && typeof input === 'object') {
    if (Array.isArray(input)) return input.map((v) => redactSecrets(v)) as unknown as T;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (/key|token|secret|password|authorization|credential/i.test(k) && typeof v === 'string') {
        out[k] = redactSecrets(v);
      } else {
        out[k] = redactSecrets(v);
      }
    }
    return out as unknown as T;
  }
  return input;
}

// ─────────────────────────────────────────────────────────────────────────────
// §7 — Request correlation header
// ─────────────────────────────────────────────────────────────────────────────

export const NEXUS_REQUEST_ID_HEADER = 'X-Nexus-Request-Id';

/** Generates a request id for correlation; safe to expose in responses. */
export function newRequestId(): string {
  return nextId('req');
}
