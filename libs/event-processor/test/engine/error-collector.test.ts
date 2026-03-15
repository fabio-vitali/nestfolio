import { ErrorCollector } from '../../src/engine/error-collector';
import { NotRetryableError } from '@nestfolio/lambda-utils';

describe('ErrorCollector', () => {
  let collector: ErrorCollector;

  beforeEach(() => {
    collector = new ErrorCollector();
  });

  it('starts empty', () => {
    expect(collector.getResults().batchItemFailures).toEqual([]);
    expect(collector.getResults().metrics.EventProcessed).toBe(0);
  });

  it('collects successful records', () => {
    collector.recordSuccess('msg-1', 'ORDER_FILLED');
    collector.recordSuccess('msg-2', 'DEPOSIT_DETECTED');
    const r = collector.getResults();
    expect(r.metrics.EventProcessed).toBe(2);
    expect(r.batchItemFailures).toEqual([]);
  });

  it('collects deduplicated records', () => {
    collector.recordDeduplicated('msg-1', 'ORDER_FILLED');
    const r = collector.getResults();
    expect(r.metrics.EventDeduplicated).toBe(1);
    expect(r.metrics.EventProcessed).toBe(0);
    expect(r.batchItemFailures).toEqual([]);
  });

  it('collects retryable errors → batchItemFailures', () => {
    collector.recordError('msg-1', 'ORDER_FILLED', new Error('timeout'), true);
    const r = collector.getResults();
    expect(r.metrics.EventFailed).toBe(1);
    expect(r.batchItemFailures).toEqual(['msg-1']);
  });

  it('collects non-retryable errors → dropped, NOT in failures', () => {
    collector.recordError('msg-1', 'ORDER_FILLED', new NotRetryableError('bad data'), false);
    const r = collector.getResults();
    expect(r.metrics.EventDropped).toBe(1);
    expect(r.batchItemFailures).toEqual([]);
    expect(r.droppedErrors).toHaveLength(1);
  });

  it('collects poison pills → NOT in failures', () => {
    collector.recordPoisonPill('msg-1');
    const r = collector.getResults();
    expect(r.metrics.PoisonPillDetected).toBe(1);
    expect(r.batchItemFailures).toEqual([]);
  });

  it('collects skipped records', () => {
    collector.recordSkipped('msg-1');
    const r = collector.getResults();
    expect(r.metrics.EventSkipped).toBe(1);
  });

  it('tracks BatchSize', () => {
    collector.recordSuccess('msg-1', 'A');
    collector.recordError('msg-2', 'B', new Error('x'), true);
    collector.recordDeduplicated('msg-3', 'C');
    const r = collector.getResults();
    expect(r.metrics.BatchSize).toBe(3);
  });
});
