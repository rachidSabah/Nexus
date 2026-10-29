/**
 * Engine bootstrap tests:
 *   - Registered connectors appear in listConnectors() even before their first
 *     persisted row (fresh stores must not hit "No connectors are registered"
 *     — that deadlocked POST /v1/intelligence/jobs/run on every fresh install).
 *   - runSchedulerPass() enqueues exactly one job per idle connector; a drained
 *     run ingests provider/model records and lifts connector health + store
 *     contents so the health report leaves NOT_CONFIGURED.
 *   - Each cadence pass re-arms an idle connector for the next round without
 *     duplicating active jobs.
 */

import { describe, expect, it } from 'vitest';

import { IntelligenceEngine } from '../src/engine.js';
import { InMemoryIntelligenceRepository } from '../src/repository.js';
import type {
  ConnectorCheckpoint,
  ConnectorHealth,
  DiscoveryBatch,
  DiscoveryConnector,
  NormalizedCandidate,
  RawDiscoveryRecord,
} from '../src/types.js';

const now = () => new Date().toISOString();

/** Deterministic offline connector (networkless) with one provider + one model. */
class StaticConnector implements DiscoveryConnector {
  readonly id = 'static-test';
  readonly version = '1.0.0';
  readonly authority = 0.9;
  readonly description = 'Deterministic test source (no network)';

  async discover(cursor?: ConnectorCheckpoint): Promise<DiscoveryBatch> {
    if (cursor) return { connectorId: this.id, sourceUrl: 'https://static.test/catalog', records: [], exhausted: true };
    const record: RawDiscoveryRecord = {
      connectorId: this.id,
      sourceUrl: 'https://static.test/catalog',
      observedAt: now(),
      payload: { catalog: ['static-1'] },
    };
    return { connectorId: this.id, sourceUrl: record.sourceUrl, records: [record], exhausted: true };
  }

  async normalize(): Promise<NormalizedCandidate[]> {
    return [
      { kind: 'provider', candidate: { providerId: 'static', displayName: 'Static Provider', providerKind: 'aggregator' } },
      { kind: 'model', candidate: { providerId: 'static', providerModelId: 'static-1', displayName: 'Static One', capabilities: { toolCalling: true } } },
    ];
  }

  async healthCheck(): Promise<ConnectorHealth> {
    return { id: this.id, status: 'healthy', authority: this.authority, consecutiveFailures: 0 };
  }

  async getCheckpoint(): Promise<ConnectorCheckpoint | undefined> {
    return undefined;
  }
}

describe('engine bootstrap (fresh stores are runnable)', () => {
  it('surfaces registered connectors before any persisted row exists', async () => {
    const repo = new InMemoryIntelligenceRepository();
    const engine = new IntelligenceEngine({ repo, connectors: [new StaticConnector()] });

    const list = await engine.listConnectors();
    const row = list.find((c) => c.id === 'static-test');
    expect(row).toBeDefined();
    expect(row!.status).toBe('healthy');
    expect(row!.lastRunAt).toBeUndefined();
  });

  it('runSchedulerPass enqueues one job, drains it, and populates store + connector health', async () => {
    const repo = new InMemoryIntelligenceRepository();
    const engine = new IntelligenceEngine({ repo, connectors: [new StaticConnector()] });

    const first = await engine.runSchedulerPass();
    expect(first.enqueued).toBe(1);
    expect(first.drained.executed).toBe(1);
    expect(first.drained.succeeded).toBe(1);

    const models = await engine.listModels();
    expect(models.some((m) => m.providerId === 'static' && m.providerModelId === 'static-1')).toBe(true);

    const row = (await repo.listConnectors()).find((r) => r.id === 'static-test');
    expect(row).toBeDefined();
    expect(row!.status).toBe('healthy');
    expect(row!.lastRunAt).toBeTruthy();

    const health = await engine.healthReport();
    expect(health.status).not.toBe('NOT_CONFIGURED');
  });

  it('reports DEGRADED-with-remediation for registered-but-never-run stores, not NOT_CONFIGURED', async () => {
    const repo = new InMemoryIntelligenceRepository();
    const engine = new IntelligenceEngine({ repo, connectors: [new StaticConnector()] });

    const health = await engine.healthReport();
    expect(health.status).toBe('DEGRADED');
    expect(health.remediation).toContain('POST /v1/intelligence/jobs/run');
  });

  it('re-arms an idle connector for the next cadence without duplicating active jobs', async () => {
    const repo = new InMemoryIntelligenceRepository();
    const engine = new IntelligenceEngine({ repo, connectors: [new StaticConnector()] });

    await engine.runSchedulerPass(); // enqueue + succeed
    const second = await engine.runSchedulerPass(); // idle again → one new job for the next round
    expect(second.enqueued).toBe(1);
    expect(second.drained.executed).toBe(1);
    expect(second.drained.succeeded).toBe(1);
  });
});
