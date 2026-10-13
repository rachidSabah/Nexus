import { describe, it, expect } from 'vitest';
import {
  AgentRegistry,
  A2ACoordinator,
  signA2AMessage,
  verifyA2AMessage,
  HttpA2ATransport,
  type A2AMessage,
} from '../src/index.js';

describe('A2A Coordination Primitives & Signed Messages', () => {
  it('supports Pub/Sub topic subscription and publishing', async () => {
    const registry = new AgentRegistry();
    const coordinator = new A2ACoordinator(registry);

    let receivedPayload: unknown = null;
    let receivedFrom = '';

    coordinator.subscribe('security.alerts', (payload, from) => {
      receivedPayload = payload;
      receivedFrom = from;
    });

    await coordinator.publish('sec-agent', 'security.alerts', { level: 'high', file: 'auth.ts' });

    expect(receivedFrom).toBe('sec-agent');
    expect(receivedPayload).toEqual({ level: 'high', file: 'auth.ts' });
  });

  it('broadcasts messages to all registered agents', async () => {
    const registry = new AgentRegistry();
    registry.register({
      id: 'agent-1',
      name: 'Agent 1',
      role: 'executor',
      capabilities: ['coding'],
      endpoint: 'http://localhost:8001',
    });
    registry.register({
      id: 'agent-2',
      name: 'Agent 2',
      role: 'critic',
      capabilities: ['review'],
      endpoint: 'http://localhost:8002',
    });

    const coordinator = new A2ACoordinator(registry);
    const messagesReceived: string[] = [];

    coordinator.onMessage('agent-1', async (msg) => {
      messagesReceived.push(`agent-1:${msg.payload as string}`);
    });
    coordinator.onMessage('agent-2', async (msg) => {
      messagesReceived.push(`agent-2:${msg.payload as string}`);
    });

    await coordinator.broadcast('coordinator', 'system-sync');

    expect(messagesReceived).toContain('agent-1:system-sync');
    expect(messagesReceived).toContain('agent-2:system-sync');
  });

  it('signs and verifies A2A messages with cryptographic signature', () => {
    const secret = 'super-secret-key-12345';
    const msg: A2AMessage = {
      id: 'msg-001',
      from: 'planner',
      to: 'executor',
      type: 'request',
      payload: { action: 'build_feature' },
      createdAt: '2026-10-13T12:00:00Z',
    };

    const signed = signA2AMessage(msg, secret);
    expect(signed.signature).toBeDefined();
    expect(signed.signature?.length).toBe(64); // SHA-256 hex length

    expect(verifyA2AMessage(signed, secret)).toBe(true);

    // Tampered message fails verification
    const tampered: A2AMessage = { ...signed, payload: { action: 'malicious_code' } };
    expect(verifyA2AMessage(tampered, secret)).toBe(false);

    // Wrong secret fails verification
    expect(verifyA2AMessage(signed, 'wrong-secret')).toBe(false);
  });
});
