export interface CollectedError {
  readonly id: string;
  readonly error: Error;
  readonly retryable: boolean;
  readonly causedBy: unknown;
}

export abstract class BaseCollector {
  protected readonly metrics: Record<string, number>;
  private readonly retryableErrors: CollectedError[] = [];
  private readonly nonRetryableErrors: CollectedError[] = [];

  constructor(initialMetrics: Record<string, number>) {
    this.metrics = { ...initialMetrics };
  }

  recordSuccess(_id: string): void {
    // Subclasses increment their own metrics via incrementMetric
  }

  recordError(id: string, error: Error, retryable: boolean, causedBy: unknown): void {
    const entry: CollectedError = { id, error, retryable, causedBy };
    if (retryable) {
      this.retryableErrors.push(entry);
    } else {
      this.nonRetryableErrors.push(entry);
    }
  }

  incrementMetric(name: string, count = 1): void {
    this.metrics[name] = (this.metrics[name] ?? 0) + count;
  }

  getErrors(): { retryable: CollectedError[]; nonRetryable: CollectedError[] } {
    return {
      retryable: [...this.retryableErrors],
      nonRetryable: [...this.nonRetryableErrors],
    };
  }

  getMetrics(): Record<string, number> {
    return { ...this.metrics };
  }
}
