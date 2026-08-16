import { DomainEvent } from '../../events/build-events.js';

export interface IEventPublisherPort {
  publish(event: DomainEvent): Promise<void>;
  subscribe<T extends DomainEvent>(eventType: string, handler: (event: T) => Promise<void> | void): () => void;
}
