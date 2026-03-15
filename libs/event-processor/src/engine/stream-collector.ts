import { BaseCollector } from './base-collector';

export class StreamCollector extends BaseCollector {
  constructor() {
    super({
      StreamRecordProcessed: 0,
      StreamRecordFailed: 0,
      StreamBatchSize: 0,
      StreamBatchDuration: 0,
    });
  }

  override recordSuccess(id: string): void {
    super.recordSuccess(id);
    this.incrementMetric('StreamRecordProcessed');
    this.incrementMetric('StreamBatchSize');
  }

  override recordError(id: string, error: Error, retryable: boolean, causedBy: unknown): void {
    super.recordError(id, error, retryable, causedBy);
    this.incrementMetric('StreamRecordFailed');
    this.incrementMetric('StreamBatchSize');
  }

  hasRetryableErrors(): boolean {
    return this.getErrors().retryable.length > 0;
  }

  getNonRetryableForPublishing(): Array<{ error: Error; causedBy: unknown; groupKey?: string }> {
    return this.getErrors().nonRetryable.map((e) => ({
      error: e.error,
      causedBy: e.causedBy,
    }));
  }

  setBatchDuration(ms: number): void {
    this.incrementMetric('StreamBatchDuration', ms);
  }
}
