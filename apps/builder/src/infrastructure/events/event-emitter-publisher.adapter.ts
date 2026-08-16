import { EventEmitter } from 'node:events';
import { DomainEvent } from '../../domain/events/build-events.js';
import { IEventPublisherPort } from '../../domain/ports/outbound/event-publisher.port.js';

export class EventEmitterPublisherAdapter implements IEventPublisherPort {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  public async publish(event: DomainEvent): Promise<void> {
    // Emit for specific event type
    this.emitter.emit(event.eventType, event);
    // Emit for global wildcard
    this.emitter.emit('*', event);
  }

  public subscribe<T extends DomainEvent>(
    eventType: string,
    handler: (event: T) => Promise<void> | void
  ): () => void {
    const wrappedHandler = (event: T) => {
      try {
        const res = handler(event);
        if (res instanceof Promise) {
          res.catch((err) => {
            console.error(`[EventPublisher Error in handler for ${eventType}]:`, err);
          });
        }
      } catch (err) {
        console.error(`[EventPublisher Sync Error for ${eventType}]:`, err);
      }
    };

    this.emitter.on(eventType, wrappedHandler);

    return () => {
      this.emitter.off(eventType, wrappedHandler);
    };
  }
}
