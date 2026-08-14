export interface ConcurrencyStatus {
  running: number;
  queued: number;
  maxConcurrency: number;
  availableSlots: number;
}

export class ConcurrencyManager {
  private readonly maxConcurrency: number;
  private runningCount = 0;
  private queuedCount = 0;

  constructor(maxConcurrency?: number) {
    const envLimit = process.env.NEXUS_MAX_CONCURRENCY ? parseInt(process.env.NEXUS_MAX_CONCURRENCY, 10) : undefined;
    this.maxConcurrency = maxConcurrency ?? envLimit ?? 10;
  }

  getStatus(): ConcurrencyStatus {
    return {
      running: this.runningCount,
      queued: this.queuedCount,
      maxConcurrency: this.maxConcurrency,
      availableSlots: Math.max(0, this.maxConcurrency - this.runningCount),
    };
  }

  canAcquireSlot(): boolean {
    return this.runningCount < this.maxConcurrency;
  }

  acquireSlot(): boolean {
    if (this.canAcquireSlot()) {
      this.runningCount += 1;
      if (this.queuedCount > 0) this.queuedCount -= 1;
      return true;
    }
    return false;
  }

  releaseSlot(): void {
    if (this.runningCount > 0) {
      this.runningCount -= 1;
    }
  }

  incrementQueue(): void {
    this.queuedCount += 1;
  }
}
