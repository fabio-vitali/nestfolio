import { BaseCollector } from './base-collector';

export interface CollectorResults {
  metrics: Record<string, number>;
  batchItemFailures: string[];
  droppedErrors: Array<{ messageId: string; eventType: string; error: Error; causedBy?: unknown }>;
}

export class ErrorCollector extends BaseCollector {
  private readonly failures: string[] = [];
  private readonly dropped: Array<{ messageId: string; eventType: string; error: Error; causedBy?: unknown }> = [];

  constructor() {
    super({
      EventProcessed: 0,
      EventFailed: 0,
      EventDeduplicated: 0,
      EventDropped: 0,
      PoisonPillDetected: 0,
      EventSkipped: 0,
      BatchSize: 0,
    });
  }

  override recordSuccess(messageId: string, eventType?: string): void {
    super.recordSuccess(messageId);
    this.incrementMetric('EventProcessed');
    this.incrementMetric('BatchSize');
  }

  recordDeduplicated(messageId: string, eventType: string): void {
    this.incrementMetric('EventDeduplicated');
    this.incrementMetric('BatchSize');
  }

  override recordError(messageId: string, error: Error, retryable: boolean, causedBy?: unknown): void;
  override recordError(messageId: string, eventType: string, error: Error, retryable: boolean): void;
  override recordError(...args: unknown[]): void {
    let messageId: string, eventType: string, error: Error, retryable: boolean, causedBy: unknown;
    if (args[1] instanceof Error) {
      [messageId, error, retryable, causedBy] = args as [string, Error, boolean, unknown];
      eventType = 'UNKNOWN';
    } else {
      [messageId, eventType, error, retryable] = args as [string, string, Error, boolean];
      causedBy = undefined;
    }

    super.recordError(messageId, error, retryable, causedBy);
    this.incrementMetric('BatchSize');
    if (retryable) {
      this.incrementMetric('EventFailed');
      this.failures.push(messageId);
    } else {
      this.incrementMetric('EventDropped');
      this.dropped.push({ messageId, eventType, error, causedBy });
    }
  }

  recordPoisonPill(messageId: string): void {
    this.incrementMetric('PoisonPillDetected');
    this.incrementMetric('BatchSize');
  }

  recordSkipped(messageId: string): void {
    this.incrementMetric('EventSkipped');
    this.incrementMetric('BatchSize');
  }

  getResults(): CollectorResults {
    return {
      metrics: this.getMetrics(),
      batchItemFailures: [...this.failures],
      droppedErrors: [...this.dropped],
    };
  }
}
