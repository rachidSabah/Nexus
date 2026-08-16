export abstract class DomainError extends Error {
  public abstract readonly statusCode: number;
  public abstract readonly errorCode: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends DomainError {
  public readonly statusCode = 400;
  public readonly errorCode = 'VALIDATION_ERROR';

  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(message);
  }
}

export class InvalidStateTransitionError extends DomainError {
  public readonly statusCode = 409;
  public readonly errorCode = 'INVALID_STATE_TRANSITION';

  constructor(message: string) {
    super(message);
  }
}

export class BuildExecutionError extends DomainError {
  public readonly statusCode = 500;
  public readonly errorCode = 'BUILD_EXECUTION_ERROR';

  constructor(message: string, public readonly stepId?: string) {
    super(message);
  }
}

export class ConcurrencyLimitExceededError extends DomainError {
  public readonly statusCode = 429;
  public readonly errorCode = 'CONCURRENCY_LIMIT_EXCEEDED';

  constructor(message = 'Maximum concurrent build limit reached. Job queued.') {
    super(message);
  }
}
