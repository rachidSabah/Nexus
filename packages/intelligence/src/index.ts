/**
 * @anx/intelligence — AI Provider Intelligence OS for Agent Nexus.
 *
 * Discover → Normalize & redact → Evidence-check → Safely verify →
 * Constrain-generate adapters → Human approval (hash-bound) → Approved publish
 * into the gateway routing fabric.
 */

export * from './types.js';
export * from './redaction.js';
export * from './confidence.js';
export { LIFECYCLE_TRANSITIONS, canTransition, assertTransition, deriveLabel, IllegalTransitionError } from './state-machine.js';
export * from './repository.js';
export {
  SqliteIntelligenceRepository,
  IntelligenceSchemaManager,
} from './sqlite-repository.js';
export {
  DEFAULT_EGRESS_POLICY,
  LOOPBACK_EGRESS_POLICY,
  SafeEgress,
  EgressBlockError,
  classifyIp,
  classifyIPv4,
  classifyIPv6,
  isPublicIp,
  isLoopbackHost,
  type EgressPolicy,
  type EgressResult,
  type IpClassification,
} from './egress.js';
export { RateLimiter, BaseConnector, safeParseJson as safeParseJsonBody, sha256, stableStringify, evidenceDedupeKey, newId, sleep, makeEgress } from './connectors/base.js';
export type { ConnectorContext } from './connectors/base.js';
export { OpenRouterConnector, aggregatorProvider, normalizePricing, normalizeCapabilities, familyOf, splitModelId } from './connectors/openrouter.js';
export { HuggingFaceConnector, splitHubId, inferModalities, familyFromTags } from './connectors/huggingface.js';
export { GitHubAdvisoriesConnector, normalizeSeverity } from './connectors/github.js';
export { LocalServersConnector, LOCAL_RUNTIMES } from './connectors/local.js';
export { IngestionPipeline, canonicalizeModelName, type IngestionMeta, type IngestionOutcome } from './ingestion.js';
export {
  VerificationEngine,
  extractModelIds,
  AVAILABILITY_FRESHNESS_MS,
  PRICING_FRESHNESS_MS,
} from './verification.js';
export {
  AdapterFactory,
  AdapterPreparationError,
  manifestFingerprint,
  checkPublishBinding,
  runSandboxChecks,
  sanitizeVersion,
  slugify,
  type PreparedAdapter,
  type PublishDecision,
} from './adapter-factory.js';
export { ApprovalService, ApprovalGuardError, type ApprovalDecision } from './approval.js';
export {
  IntelligenceEngine,
  type IntelligenceEngineOptions,
  type PublishPayload,
} from './engine.js';
export {
  createDefaultConnectors,
  createIntelligenceRepository,
  defaultIntelligenceDbPath,
} from './foundation.js';
export type { DiscoveryConnector } from './types.js';
