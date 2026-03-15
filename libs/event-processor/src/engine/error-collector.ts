export interface CollectorResults {
  metrics: Record<string, number>;
  batchItemFailures: string[];
  droppedErrors: Array<{ messageId: string; eventType: string; error: Error }>;
}

export class ErrorCollector {
  private readonly metrics: Record<string, number> = {
    EventProcessed: 0,
    EventFailed: 0,
    EventDeduplicated: 0,
    EventDropped: 0,
    PoisonPillDetected: 0,
    EventSkipped: 0,
    BatchSize: 0,
  };
  private readonly failures: string[] = [];
  private readonly dropped: Array<{ messageId: string; eventType: string; error: Error }> = [];

  recordSuccess(messageId: string, eventType: string): void {
    this.metrics.EventProcessed++;
    this.metrics.BatchSize++;
  }

  recordDeduplicated(messageId: string, eventType: string): void {
    this.metrics.EventDeduplicated++;
    this.metrics.BatchSize++;
  }

  recordError(messageId: string, eventType: string, error: Error, retryable: boolean): void {
    this.metrics.BatchSize++;
    if (retryable) {
      this.metrics.EventFailed++;
      this.failures.push(messageId);
    } else {
      this.metrics.EventDropped++;
      this.dropped.push({ messageId, eventType, error });
    }
  }

  recordPoisonPill(messageId: string): void {
    this.metrics.PoisonPillDetected++;
    this.metrics.BatchSize++;
  }

  recordSkipped(messageId: string): void {
    this.metrics.EventSkipped++;
    this.metrics.BatchSize++;
  }

  getResults(): CollectorResults {
    return {
      metrics: { ...this.metrics },
      batchItemFailures: [...this.failures],
      droppedErrors: [...this.dropped],
    };
  }
}
