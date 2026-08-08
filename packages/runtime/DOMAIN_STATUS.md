# Runtime Domain Implementation Status

This document tracks which of the 8 runtime domains have real service implementations vs. type-only skeletons. The runtime package's `src/domains/` directory declares types for all 8; only some have corresponding service classes in `src/services/`.

## Status summary

| Domain | Types | Service | Status |
|--------|-------|---------|--------|
| **Runtime** (core) | `RuntimeTypes.ts` | `RuntimeManager.ts` | ✅ Implemented |
| **Secrets** | `SecretsTypes.ts` | `SecretsManager.ts` | ✅ Implemented |
| **Agents** | (in `@anx/agents`) | `AgentRuntime` (in index.ts) | ✅ Implemented |
| **Workspace** | `WorkspaceTypes.ts` | — | 🟡 Types only |
| **Deployment** | `DeploymentTypes.ts` | — | 🟡 Types only |
| **Backup** | `BackupTypes.ts` | — | 🟡 Types only |
| **Governance** | `GovernanceTypes.ts` | — | 🟡 Types only |
| **Scheduler** | `SchedulerTypes.ts` | — | 🟡 Types only |
| **Audit** | `AuditTypes.ts` | (basic in `@anx/core`) | 🟡 Types only (basic impl in core) |

## Implemented services

### `RuntimeManager` (`src/services/RuntimeManager.ts`)
- Provider/model/plugin/workflow/MCP/worker registration
- Health-check interval + graceful shutdown
- State tracking + stats

### `SecretsManager` (`src/services/SecretsManager.ts`)
- Wraps `EncryptedCredentialVault` from `@anx/security` (AES-256-GCM at rest)
- Adds: versioning, rotation policies (interval + auto-rotate), expiration, tags + metadata, access audit log, value validation, fingerprinting
- Storage: in-memory by default; persists via `vaultPath` (encrypted)
- Limitation: metadata (tags, rotation history) is NOT persisted across restarts yet — only the encrypted value is. A future release will persist the full `SecretEntry` to a sidecar JSON file.

### `AgentRuntime` (in `src/index.ts`)
- Session management (open/close/list)
- Task execution (delegates to a caller-supplied `TaskExecutor` — typically the gateway's `ChatCompletionUseCase`)
- Streaming sink support
- Retry + timeout
- Emits `agent.started` / `agent.completed` / `agent.failed` events

## Type-only domains (implementation plan)

The following domains have full type definitions but no service class. They're declared so consumers can build against the contracts, and so future work has a stable target. Each is tracked in the roadmap.

### `WorkspaceTypes.ts` (~125 LOC)
Organizations → Teams → Projects → Environments → Workspaces → Namespaces, with ResourceQuotas, UsageMetrics, NetworkPolicies.

**Plan**: `WorkspaceService` will manage the hierarchy, enforce quotas, and gate namespace access. Likely ships in v0.4 alongside multi-agent orchestration UI (multi-tenancy is a prerequisite).

### `DeploymentTypes.ts` (~156 LOC)
DeploymentProfiles with strategies (rolling, blue-green, canary, recreate), ResourceRequirements, ScalingConfig, HealthChecks, RolloutConfig, CanaryStep, DeploymentRecord.

**Plan**: `DeploymentService` will execute rollouts against local/docker/kubernetes/helm/nomad/systemd/windows-service targets. The `@anx/service-mesh` package already implements canary/blue-green traffic splitting — the deployment service will orchestrate the underlying infrastructure changes. Likely v0.5.

### `BackupTypes.ts` (~213 LOC)
BackupEntry, BackupLocation, BackupMetadata, Checksums, BackupConfig (schedule/retention/storage/encryption/compression/notification/hooks), RestoreConfig, RestoreResult, ConflictResolution, VersionHistory, BackupRecoveryStats, ScheduledBackup.

**Plan**: `BackupService` will snapshot the gateway's state (endpoints, agents, workflows, memory) to a configurable location (local, S3, GCS) with retention policies. Likely v0.6 alongside performance work.

### `GovernanceTypes.ts` (~200 LOC)
Policy, PolicyRule (with attribute/event/time/combination conditions), Constraints (quota/rate-limit/allow-list/deny-list/requirement), GovernanceConfig, ApprovalWorkflow, ComplianceRule, ComplianceRequirement, DataResidencyRule, PolicyEvaluationResult.

**Plan**: `PolicyEngine` will evaluate policies at request time (similar to OPA). Likely v0.7 alongside the security/compliance roadmap items (OAuth2, SAML SSO, SCIM, SOC 2).

### `SchedulerTypes.ts` (~176 LOC)
SchedulingInput/Constraints/Preferences, StrategyWeights, RequestContext, SchedulePlan, ProviderSelection, CostEstimate, CapabilityMatch, ExecutionPlan, ExecutionStep, FallbackPlan, FallbackTrigger, RetryPolicy, CircuitBreakerConfig, SchedulingMetrics, SchedulerConfig, SchedulerStats.

**Plan**: `Scheduler` will be the high-level orchestrator that consumes `@anx/task-router`'s plans and `@anx/routing`'s decisions to produce concrete execution plans. The existing `@anx/task-router` package already implements most of this — the Scheduler type formalizes the contract. Likely v0.6.

### `AuditTypes.ts` (~278 LOC)
AuditEvent, ActorInfo, ResourceInfo, AuditMetadata, ChangeDetail, AuditTrail, TrailSummary, AuditReport, ReportFilters/Sections/Summary, ActorActivity, ResourceActivity, AnomalyDetection, ComplianceStatus, ComplianceFinding, AuditConfig, AlertRule, AuditQuery, AggregationConfig, AuditStats.

**Plan**: `AuditService` will be the production-grade audit log (the basic `InMemoryAuditLog` in `@anx/core` is the v0.1 default). Will support: persistent backends (Postgres, Elasticsearch), anomaly detection, compliance report generation, alert rules. Likely v0.7.

## Why not delete the type-only files?

The types serve three purposes:
1. **Contract stability**: consumers (gateway, dashboard, CLI) can code against these interfaces today, and the eventual service implementations will be drop-in.
2. **Documentation**: the type definitions are the most concrete spec of what each domain will do.
3. **Roadmap signal**: they make the v0.4-v0.7 plans tangible rather than aspirational.

If a consumer imports from one of these type-only domains, they'll get a compile error pointing them to this document. The `index.ts` deliberately does NOT re-export them — they must be imported explicitly from the file path, which discourages accidental use before the service exists.
