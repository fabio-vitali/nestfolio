import { changeDataCapture } from '../../src/pipelines/change-data-capture';
import { fakeDdbStreamRecord } from '../../src/testing/fake-records';

const mockPublish = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/util/event-bridge-publisher', () => ({
  EventBridgePublisher: jest.fn().mockImplementation(() => ({
    publish: mockPublish,
  })),
}));

jest.mock('../../src/engine/error-event-publisher', () => ({
  ErrorEventPublisher: jest.fn().mockImplementation(() => ({
    publishErrors: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('changeDataCapture', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BUS_NAME = 'test-bus';
  });

  afterEach(() => {
    delete process.env.BUS_NAME;
  });

  it('publishes events matching eventTypeMap', async () => {
    const handler = changeDataCapture({
      serviceName: 'test',
      eventTypeMap: { 'Order:INSERT': 'ORDER_CREATED' },
    });
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Order#1', __typename: 'Order', tenantId: 't1' }),
      ],
    });
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const entries = mockPublish.mock.calls[0][0];
    expect(entries).toHaveLength(1);
    const detail = JSON.parse(entries[0].Detail);
    expect(detail.type).toBe('ORDER_CREATED');
    expect(detail.context.tenantId).toBe('t1');
  });

  it('skips records not in eventTypeMap', async () => {
    const handler = changeDataCapture({
      serviceName: 'test',
      eventTypeMap: { 'Order:INSERT': 'ORDER_CREATED' },
    });
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Guard#1', __typename: 'Guard', tenantId: 't1' }),
      ],
    });
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('resolves event type from function', async () => {
    const handler = changeDataCapture({
      serviceName: 'test',
      eventTypeMap: {
        'Result:INSERT': (r) => (r.passed ? 'ENRICHED' : 'BLOCKED'),
      },
    });
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Result#1', __typename: 'Result', tenantId: 't1', passed: true }),
      ],
    });
    const detail = JSON.parse(mockPublish.mock.calls[0][0][0].Detail);
    expect(detail.type).toBe('ENRICHED');
  });

  it('applies transform when provided', async () => {
    const handler = changeDataCapture({
      serviceName: 'test',
      eventTypeMap: { 'Order:INSERT': 'ORDER_CREATED' },
      transform: (r) => ({ orderId: r.sk, total: r.amount }),
    });
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Order#1', __typename: 'Order', tenantId: 't1', amount: 500 }),
      ],
    });
    const detail = JSON.parse(mockPublish.mock.calls[0][0][0].Detail);
    expect(detail.subject).toEqual({ orderId: 'Order#1', total: 500 });
  });

  it('deduplicates with groupBy pick:last', async () => {
    const handler = changeDataCapture({
      serviceName: 'test',
      eventTypeMap: { 'Order:INSERT': 'ORDER_CREATED' },
      groupBy: { key: (r) => `${r.tenantId}#${r.sk}`, pick: 'last' },
    });
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Order#1', __typename: 'Order', tenantId: 't1', v: 1 }),
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Order#1', __typename: 'Order', tenantId: 't1', v: 2 }),
      ],
    });
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const entries = mockPublish.mock.calls[0][0];
    expect(entries).toHaveLength(1);
    const detail = JSON.parse(entries[0].Detail);
    expect(detail.subject.v).toBe(2);
  });
});
