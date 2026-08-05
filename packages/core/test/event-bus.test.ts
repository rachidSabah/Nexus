import { describe, it, expect } from 'vitest';

import { InMemoryEventBus } from '../src/application/event-bus.js';
import { buildEvent } from '../src/domain/events.js';
import type { RequestReceivedEvent, RouteResolvedEvent } from '../src/domain/events.js';

describe('InMemoryEventBus', () => {
  it('delivers events to typed subscribers', async () => {
    const bus = new InMemoryEventBus();
    const received: string[] = [];
    bus.subscribe<RequestReceivedEvent>('request.received', (e) => {
      received.push(e.payload.requestId);
    });

    await bus.publish(
      buildEvent<RequestReceivedEvent>('request.received', {
        requestId: 'req-1',
        model: 'gpt-4',
        streaming: false,
        userId: 'u1',
        timestamp: Date.now(),
      }),
    );

    await new Promise((r) => queueMicrotask(r));
    expect(received).toEqual(['req-1']);
  });

  it('delivers to multiple subscribers independently', async () => {
    const bus = new InMemoryEventBus();
    let count = 0;
    bus.subscribe('route.resolved', () => count++);
    bus.subscribe('route.resolved', () => count++);

    await bus.publish(
      buildEvent<RouteResolvedEvent>('route.resolved', {
        requestId: 'r1',
        endpointId: 'e1',
        providerId: 'p1',
        strategy: 'weighted',
        alternativesCount: 2,
      }),
    );
    await new Promise((r) => queueMicrotask(r));
    expect(count).toBe(2);
  });

  it('subscriber errors do not break the bus', async () => {
    const bus = new InMemoryEventBus();
    bus.subscribe('route.resolved', () => {
      throw new Error('boom');
    });
    let otherCalled = false;
    bus.subscribe('route.resolved', () => {
      otherCalled = true;
    });

    await bus.publish(
      buildEvent<RouteResolvedEvent>('route.resolved', {
        requestId: 'r1',
        endpointId: 'e1',
        providerId: 'p1',
        strategy: 'weighted',
        alternativesCount: 0,
      }),
    );
    await new Promise((r) => queueMicrotask(r));
    expect(otherCalled).toBe(true);
  });

  it('unsubscribe stops delivery', async () => {
    const bus = new InMemoryEventBus();
    let count = 0;
    const unsub = bus.subscribe('route.resolved', () => count++);

    await bus.publish(
      buildEvent<RouteResolvedEvent>('route.resolved', {
        requestId: 'r1',
        endpointId: 'e1',
        providerId: 'p1',
        strategy: 'weighted',
        alternativesCount: 0,
      }),
    );
    await new Promise((r) => queueMicrotask(r));
    expect(count).toBe(1);

    unsub();
    await bus.publish(
      buildEvent<RouteResolvedEvent>('route.resolved', {
        requestId: 'r2',
        endpointId: 'e1',
        providerId: 'p1',
        strategy: 'weighted',
        alternativesCount: 0,
      }),
    );
    await new Promise((r) => queueMicrotask(r));
    expect(count).toBe(1);
  });
});
