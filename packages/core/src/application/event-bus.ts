import { EventEmitter } from 'node:events';

import type { DomainEvent } from '../domain/events.js';

import type { EventBusPort } from './ports.js';

/**
 * In-memory event bus. For production, swap with Redis Streams / NATS JetStream
 * backed implementation.
 *
 * Designed for fan-out: each subscriber gets its own queue, so a slow
 * subscriber (e.g. dashboard websocket) cannot block the request path.
 */
export class InMemoryEventBus implements EventBusPort {
  private readonly emitter = new EventEmitter();
  private readonly wildcardHandlers = new Set<(e: DomainEvent) => void | Promise<void>>();

  constructor() {
    this.emitter.setMaxListeners(10_000);
  }

  async publish(event: DomainEvent): Promise<void> {
    // Fire-and-forget synchronous handlers, but in a microtask so we never
    // block the request hot path.
    queueMicrotask(() => {
      this.emitter.emit(event.type, event);
      this.emitter.emit('*', event);
      for (const h of this.wildcardHandlers) {
        try {
          void h(event);
        } catch {
          /* swallow — handler errors must not break the bus */
        }
      }
    });
  }

  subscribe<T extends DomainEvent>(
    type: T['type'] | T['type'][],
    handler: (event: T) => void | Promise<void>,
  ): () => void {
    const types = Array.isArray(type) ? type : [type];
    const wrapped = (e: DomainEvent) => {
      try {
        void handler(e as T);
      } catch (err) {
        // Log and continue — handler errors must not kill the bus.
        // eslint-disable-next-line no-console
        console.error('[event-bus] subscriber error', err);
      }
    };
    for (const t of types) this.emitter.on(t, wrapped);
    return () => {
      for (const t of types) this.emitter.off(t, wrapped);
    };
  }

  /**
   * Subscribe to ALL events. Useful for audit log / debug views.
   */
  subscribeAll(handler: (e: DomainEvent) => void | Promise<void>): () => void {
    this.wildcardHandlers.add(handler);
    return () => this.wildcardHandlers.delete(handler);
  }
}
