import { BaseCollector } from '../../src/engine/base-collector';

// Create a concrete subclass for testing
class TestCollector extends BaseCollector {
  constructor() {
    super({
      TestProcessed: 0,
      TestFailed: 0,
      TestBatchSize: 0,
    });
  }
}

describe('BaseCollector', () => {
  let collector: TestCollector;

  beforeEach(() => {
    collector = new TestCollector();
  });

  it('starts with empty errors', () => {
    const errors = collector.getErrors();
    expect(errors.retryable).toEqual([]);
    expect(errors.nonRetryable).toEqual([]);
  });

  it('records success and increments metric', () => {
    collector.recordSuccess('r-1');
    collector.incrementMetric('TestProcessed');
    expect(collector.getMetrics().TestProcessed).toBe(1);
  });

  it('classifies retryable errors', () => {
    collector.recordError('r-1', new Error('timeout'), true, { eventType: 'X' });
    const errors = collector.getErrors();
    expect(errors.retryable).toHaveLength(1);
    expect(errors.retryable[0].causedBy).toEqual({ eventType: 'X' });
    expect(errors.nonRetryable).toHaveLength(0);
  });

  it('classifies non-retryable errors', () => {
    collector.recordError('r-1', new Error('bad data'), false, { eventType: 'Y' });
    const errors = collector.getErrors();
    expect(errors.retryable).toHaveLength(0);
    expect(errors.nonRetryable).toHaveLength(1);
  });

  it('tracks both retryable and non-retryable in same batch', () => {
    collector.recordError('r-1', new Error('timeout'), true, { a: 1 });
    collector.recordError('r-2', new Error('bad'), false, { b: 2 });
    const errors = collector.getErrors();
    expect(errors.retryable).toHaveLength(1);
    expect(errors.nonRetryable).toHaveLength(1);
  });
});
