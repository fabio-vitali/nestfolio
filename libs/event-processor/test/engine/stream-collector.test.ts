import { StreamCollector } from '../../src/engine/stream-collector';

describe('StreamCollector', () => {
  let collector: StreamCollector;

  beforeEach(() => {
    collector = new StreamCollector();
  });

  it('starts with zero metrics', () => {
    expect(collector.getMetrics().StreamRecordProcessed).toBe(0);
    expect(collector.getMetrics().StreamRecordFailed).toBe(0);
    expect(collector.getMetrics().StreamBatchSize).toBe(0);
  });

  it('tracks successful records', () => {
    collector.recordSuccess('r-1');
    expect(collector.getMetrics().StreamRecordProcessed).toBe(1);
    expect(collector.getMetrics().StreamBatchSize).toBe(1);
  });

  it('tracks retryable errors', () => {
    collector.recordError('r-1', new Error('timeout'), true, { pk: 'x' });
    expect(collector.getMetrics().StreamRecordFailed).toBe(1);
    expect(collector.hasRetryableErrors()).toBe(true);
  });

  it('tracks non-retryable errors', () => {
    collector.recordError('r-1', new Error('bad'), false, { pk: 'x' });
    expect(collector.getMetrics().StreamRecordFailed).toBe(1);
    expect(collector.hasRetryableErrors()).toBe(false);
  });

  it('hasRetryableErrors returns false when all errors non-retryable', () => {
    collector.recordError('r-1', new Error('bad'), false, {});
    collector.recordError('r-2', new Error('bad2'), false, {});
    expect(collector.hasRetryableErrors()).toBe(false);
  });

  it('getNonRetryableForPublishing returns errors with causedBy', () => {
    collector.recordError('r-1', new Error('bad data'), false, { eventType: 'ORDER' });
    const errors = collector.getNonRetryableForPublishing();
    expect(errors).toHaveLength(1);
    expect(errors[0].causedBy).toEqual({ eventType: 'ORDER' });
  });

  it('setBatchDuration sets metric', () => {
    collector.setBatchDuration(150);
    expect(collector.getMetrics().StreamBatchDuration).toBe(150);
  });
});
