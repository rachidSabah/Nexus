import { describe, it, expect, beforeEach } from 'vitest';
import {
  SignalCollector,
  AnomalyDetector,
  DiagnosisEngine,
  RemediationPolicyEngine,
  RemediationVerifier,
  RemediationEngine,
  IncidentManager,
  SelfHealingOrchestrator,
  InMemoryIncidentRepository,
  InMemoryEventBus,
  ModelRegistry,
  KeyRegistry,
  RoutingEngine,
  asEndpointId,
} from '../src/index.js';

describe('Phase 34 Runtime Intelligence & Bounded Autonomous Self-Healing', () => {
  let bus: InMemoryEventBus;
  let collector: SignalCollector;
  let detector: AnomalyDetector;
  let diagnosisEngine: DiagnosisEngine;
  let policyEngine: RemediationPolicyEngine;
  let verifier: RemediationVerifier;
  let incidentRepo: InMemoryIncidentRepository;
  let incidentManager: IncidentManager;
  let modelRegistry: ModelRegistry;
  let keyRegistry: KeyRegistry;
  let routingEngine: RoutingEngine;
  let remediationEngine: RemediationEngine;
  let orchestrator: SelfHealingOrchestrator;

  beforeEach(() => {
    bus = new InMemoryEventBus();
    collector = new SignalCollector({ windowMs: 60_000 });
    collector.wireToEventBus(bus);
    detector = new AnomalyDetector(collector, {
      rateLimitSpikeCount: 3,
      authFailureSpikeCount: 2,
      modelNotFoundCount: 2,
      providerFailureCount: 3,
      windowMs: 60_000,
    });
    diagnosisEngine = new DiagnosisEngine();
    policyEngine = new RemediationPolicyEngine();
    verifier = new RemediationVerifier();
    incidentRepo = new InMemoryIncidentRepository();
    incidentManager = new IncidentManager(incidentRepo, bus);
    modelRegistry = new ModelRegistry();
    keyRegistry = new KeyRegistry();
    routingEngine = new RoutingEngine();

    remediationEngine = new RemediationEngine({
      routing: routingEngine,
      keyRegistry,
      modelRegistry,
      policyEngine,
      verifier,
    });

    orchestrator = new SelfHealingOrchestrator(
      collector,
      detector,
      diagnosisEngine,
      policyEngine,
      remediationEngine,
      incidentManager,
      bus,
    );
  });

  describe('1. Signal Collection & Statistical Anomaly Detection', () => {
    it('detects 429 rate limit spike anomaly deterministically', () => {
      // Simulate 3 rate limits within sliding window
      collector.recordSignal('providers', 'rate_limit_429', 1, { providerId: 'openai-prod' });
      collector.recordSignal('providers', 'rate_limit_429', 1, { providerId: 'openai-prod' });
      collector.recordSignal('providers', 'rate_limit_429', 1, { providerId: 'openai-prod' });

      const anomalies = detector.detectAnomalies();
      expect(anomalies.length).toBe(1);
      expect(anomalies[0]!.anomalyType).toBe('RATE_LIMIT_SPIKE');
      expect(anomalies[0]!.subsystem).toBe('providers');
      expect(anomalies[0]!.targetId).toBe('openai-prod');
      expect(anomalies[0]!.observedValue).toBe(3);
    });

    it('detects 401/403 authentication failure spikes', () => {
      collector.recordSignal('apiKeys', 'auth_failure', 1, { providerId: 'anthropic-prod' });
      collector.recordSignal('apiKeys', 'auth_failure', 1, { providerId: 'anthropic-prod' });

      const anomalies = detector.detectAnomalies();
      expect(anomalies.length).toBe(1);
      expect(anomalies[0]!.anomalyType).toBe('AUTH_FAILURE_SPIKE');
      expect(anomalies[0]!.subsystem).toBe('apiKeys');
      expect(anomalies[0]!.severity).toBe('HIGH');
    });

    it('detects 404 model degradation anomaly', () => {
      collector.recordSignal('models', 'model_not_found', 1, { providerId: 'groq', endpointId: 'llama-3.3-70b' });
      collector.recordSignal('models', 'model_not_found', 1, { providerId: 'groq', endpointId: 'llama-3.3-70b' });

      const anomalies = detector.detectAnomalies();
      expect(anomalies.length).toBe(1);
      expect(anomalies[0]!.anomalyType).toBe('MODEL_DEGRADED');
      expect(anomalies[0]!.targetId).toBe('llama-3.3-70b');
    });
  });

  describe('2. Deterministic Diagnosis Engine', () => {
    it('produces diagnosis with probable cause, confidence, and recommended safe remediation', () => {
      const anomaly = detector.createManualAnomaly(
        'RATE_LIMIT_SPIKE',
        'providers',
        'HIGH',
        'Provider 429 spike observed',
        'openai-prod',
      );

      const diagnosis = diagnosisEngine.diagnose(anomaly);
      expect(diagnosis.probableCause).toContain('openai-prod');
      expect(diagnosis.confidence).toBeGreaterThan(0.9);
      expect(diagnosis.recommendedRemediation).toBe('DEPRIORITIZE_PROVIDER');
      expect(diagnosis.autoRemediationPermitted).toBe(true);
      expect(diagnosis.policyTier).toBe('AUTO_SAFE');
    });

    it('classifies persistence degradation as strictly NEVER_AUTOMATE', () => {
      const anomaly = detector.createManualAnomaly(
        'PERSISTENCE_DEGRADED',
        'persistence',
        'CRITICAL',
        'SQLite database lock failure',
      );

      const diagnosis = diagnosisEngine.diagnose(anomaly);
      expect(diagnosis.policyTier).toBe('NEVER_AUTOMATE');
      expect(diagnosis.autoRemediationPermitted).toBe(false);
      expect(diagnosis.probableCause).toContain('WAL');
    });
  });

  describe('3. Remediation Policy Engine & Security Invariants', () => {
    it('allows AUTO_SAFE action within attempt limits and rate limits', () => {
      const action = {
        actionType: 'DEPRIORITIZE_PROVIDER' as const,
        targetSubsystem: 'providers' as const,
        targetId: 'openai-prod',
        initiatedBy: 'AUTONOMOUS' as const,
        timestamp: Date.now(),
      };

      const result = policyEngine.evaluatePolicy(action, 0);
      expect(result.permitted).toBe(true);
      expect(result.policyTier).toBe('AUTO_SAFE');
    });

    it('blocks NEVER_AUTOMATE operations unconditionally', () => {
      const action = {
        actionType: 'DROP_PERSISTENCE_STORE' as const,
        targetSubsystem: 'persistence' as const,
        initiatedBy: 'AUTONOMOUS' as const,
        timestamp: Date.now(),
      };

      const result = policyEngine.evaluatePolicy(action, 0);
      expect(result.permitted).toBe(false);
      expect(result.policyTier).toBe('NEVER_AUTOMATE');
      expect(result.reason).toContain('NEVER_AUTOMATE');
    });

    it('blocks APPROVAL_REQUIRED operations without operator elevation', () => {
      const action = {
        actionType: 'INSTALL_AGENT_EXECUTABLE' as const,
        targetSubsystem: 'localAgents' as const,
        targetId: 'claude-code',
        initiatedBy: 'AUTONOMOUS' as const,
        timestamp: Date.now(),
      };

      const result = policyEngine.evaluatePolicy(action, 0);
      expect(result.permitted).toBe(false);
      expect(result.policyTier).toBe('APPROVAL_REQUIRED');
      expect(result.reason).toContain('operator approval');
    });

    it('enforces maximum 3 attempts bound and prevents infinite loops', () => {
      const action = {
        actionType: 'DEPRIORITIZE_PROVIDER' as const,
        targetSubsystem: 'providers' as const,
        targetId: 'openai-prod',
        initiatedBy: 'AUTONOMOUS' as const,
        timestamp: Date.now(),
      };

      const result = policyEngine.evaluatePolicy(action, 3);
      expect(result.permitted).toBe(false);
      expect(result.reason).toContain('exhausted');
    });
  });

  describe('4. Bounded Remediation Execution & Verification', () => {
    it('executes safe provider deprioritization and verifies outcome', async () => {
      routingEngine.registerEndpoint({
        id: asEndpointId('ep-openai'),
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        health: 'healthy',
        priority: 10,
      });

      const action = {
        actionType: 'DEPRIORITIZE_PROVIDER' as const,
        targetSubsystem: 'providers' as const,
        targetId: 'openai',
        initiatedBy: 'AUTONOMOUS' as const,
        timestamp: Date.now(),
      };

      const outcome = await remediationEngine.executeRemediation(action, 0);
      expect(outcome.status).toBe('COMPLETED');
      expect(outcome.verification?.verified).toBe(true);
      expect(remediationEngine.isProviderDeprioritized('openai')).toBe(true);

      const endpoint = routingEngine.listEndpoints().find((e) => e.id === 'ep-openai');
      expect(endpoint?.priority).toBeGreaterThan(50);
    });

    it('restores provider priority after recovery verification', async () => {
      const action = {
        actionType: 'RESTORE_PROVIDER_PRIORITY' as const,
        targetSubsystem: 'providers' as const,
        targetId: 'openai',
        initiatedBy: 'AUTONOMOUS' as const,
        timestamp: Date.now(),
      };

      const outcome = await remediationEngine.executeRemediation(action, 0);
      expect(outcome.status).toBe('COMPLETED');
      expect(remediationEngine.isProviderDeprioritized('openai')).toBe(false);
    });
  });

  describe('5. Incident Management Lifecycle & Secret Sanitization', () => {
    it('creates, acknowledges, remediates, and resolves incidents while strictly redacting secrets', async () => {
      const anomaly = detector.createManualAnomaly(
        'RATE_LIMIT_SPIKE',
        'providers',
        'HIGH',
        'Rate limit hit with auth header Bearer sk-secret-key-123456789012',
        'openai',
      );
      const diagnosis = diagnosisEngine.diagnose(anomaly);

      const incident = await incidentManager.createIncident(anomaly, diagnosis);
      expect(incident.status).toBe('OPEN');
      expect(incident.evidence[0]).toContain('[REDACTED');
      expect(incident.evidence[0]).not.toContain('sk-secret-key-123456789012');

      const ack = await incidentManager.acknowledgeIncident(incident.id, 'Investigating with key sk-secret-key-9999');
      expect(ack.status).toBe('ACKNOWLEDGED');
      expect(ack.operatorNotes).toContain('[REDACTED');

      const resolved = await incidentManager.resolveIncident(incident.id, 'Verified healthy state');
      expect(resolved.status).toBe('RESOLVED');
      expect(resolved.verificationResult?.verified).toBe(true);
    });
  });

  describe('6. Complete Autonomous Self-Healing Loop', () => {
    it('executes full autonomous cycle: DETECT → DIAGNOSE → REMEDIATE → VERIFY → RESOLVE', async () => {
      // 1. Inject signals
      collector.recordSignal('providers', 'rate_limit_429', 1, { providerId: 'deepseek-prod' });
      collector.recordSignal('providers', 'rate_limit_429', 1, { providerId: 'deepseek-prod' });
      collector.recordSignal('providers', 'rate_limit_429', 1, { providerId: 'deepseek-prod' });

      // 2. Run autonomous cycle
      const cycle = await orchestrator.runCycle();
      expect(cycle.anomaliesDetected).toBe(1);
      expect(cycle.incidentsCreated).toBe(1);
      expect(cycle.remediationsAttempted).toBe(1);
      expect(cycle.remediationsSucceeded).toBe(1);

      // 3. Verify overview
      const overview = await orchestrator.getOverview();
      expect(overview.totalRemediationsCount).toBe(1);
      expect(overview.successfulRemediationsCount).toBe(1);
      expect(overview.resolvedIncidentsCount).toBe(1);
      expect(overview.activeIncidentsCount).toBe(0);
    });
  });
});
