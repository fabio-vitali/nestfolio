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
    process.env.SERVICE_NAME = 'test-svc';
  });

  afterEach(() => {
    delete process.env.BUS_NAME;
    delete process.env.SERVICE_NAME;
    delete process.env.EVENT_TYPE_MAP;
  });

  describe('static string mapping', () => {
    it('publishes events for matching string mapping', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'Order:INSERT': 'ORDER_CREATED',
      });
      const handler = changeDataCapture();
      await handler({
        Records: [
          fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Order#1', __typename: 'Order', tenantId: 't1' }),
        ],
      });
      expect(mockPublish).toHaveBeenCalledTimes(1);
      const detail = JSON.parse(mockPublish.mock.calls[0][0][0].Detail);
      expect(detail.type).toBe('ORDER_CREATED');
      expect(detail.context.tenantId).toBe('t1');
    });

    it('throws for records not in the map', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'Order:INSERT': 'ORDER_CREATED',
      });
      const handler = changeDataCapture();
      await expect(handler({
        Records: [
          fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Guard#1', __typename: 'Guard', tenantId: 't1' }),
        ],
      })).rejects.toThrow('retryable error');
    });
  });

  describe('field dispatch mapping', () => {
    it('resolves event type from record field via map', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'Result:INSERT': {
          field: 'status',
          map: { PASSED: 'CHECK_PASSED', FAILED: 'CHECK_FAILED' },
        },
      });
      const handler = changeDataCapture();
      await handler({
        Records: [
          fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Result#1', __typename: 'Result', tenantId: 't1', status: 'PASSED' }),
        ],
      });
      const detail = JSON.parse(mockPublish.mock.calls[0][0][0].Detail);
      expect(detail.type).toBe('CHECK_PASSED');
    });

    it('falls back to default when field value not in map', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'Result:INSERT': {
          field: 'status',
          map: { PASSED: 'CHECK_PASSED' },
          default: 'CHECK_UNKNOWN',
        },
      });
      const handler = changeDataCapture();
      await handler({
        Records: [
          fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Result#1', __typename: 'Result', tenantId: 't1', status: 'PENDING' }),
        ],
      });
      const detail = JSON.parse(mockPublish.mock.calls[0][0][0].Detail);
      expect(detail.type).toBe('CHECK_UNKNOWN');
    });

    it('returns null when field value not in map and no default', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'Result:INSERT': {
          field: 'status',
          map: { PASSED: 'CHECK_PASSED' },
        },
      });
      const handler = changeDataCapture();
      await handler({
        Records: [
          fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Result#1', __typename: 'Result', tenantId: 't1', status: 'UNKNOWN' }),
        ],
      });
      expect(mockPublish).not.toHaveBeenCalled();
    });
  });

  describe('passthrough mapping', () => {
    it('uses record field value as the event type', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'NormalizedEvent:INSERT': { field: 'sk', passthrough: true },
      });
      const handler = changeDataCapture();
      await handler({
        Records: [
          fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'ORDER_FILLED', __typename: 'NormalizedEvent', tenantId: 't1' }),
        ],
      });
      const detail = JSON.parse(mockPublish.mock.calls[0][0][0].Detail);
      expect(detail.type).toBe('ORDER_FILLED');
    });

    it('strips composite-key suffix after # from passthrough field', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'NormalizedEvent:INSERT': { field: 'sk', passthrough: true },
      });
      const handler = changeDataCapture();
      await handler({
        Records: [
          fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'BROKER_CIRCUIT_OPEN#2026-04-16T12:00:00.000Z', __typename: 'NormalizedEvent', tenantId: 't1' }),
        ],
      });
      const detail = JSON.parse(mockPublish.mock.calls[0][0][0].Detail);
      expect(detail.type).toBe('BROKER_CIRCUIT_OPEN');
    });

    it('throws when passthrough field is falsy', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'NormalizedEvent:INSERT': { field: 'eventType', passthrough: true },
      });
      const handler = changeDataCapture();
      await expect(handler({
        Records: [
          fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'NE#1', __typename: 'NormalizedEvent', tenantId: 't1', eventType: '' }),
        ],
      })).rejects.toThrow('retryable error');
    });
  });

  describe('onFieldChange diff-emit (ModifyEmission)', () => {
    it('emits carrier + matched semantic events when watched fields change', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'InvestorProfile:MODIFY': {
          always: 'INVESTOR_PROFILE_UPDATED',
          onFieldChange: { operatingMode: 'OPERATING_MODE_CHANGED', goal: 'GOAL_UPDATED' },
        },
      });
      const handler = changeDataCapture();
      await handler({
        Records: [
          fakeDdbStreamRecord('MODIFY',
            { pk: 'InvestorProfile#t1#u1', sk: 'InvestorProfile', __typename: 'InvestorProfile', tenantId: 't1', userId: 'u1', region: 'us-east-1', operatingMode: 'AGGRESSIVE', goal: { objective: 'RETIREMENT' } },
            { oldImage: { pk: 'InvestorProfile#t1#u1', sk: 'InvestorProfile', __typename: 'InvestorProfile', tenantId: 't1', userId: 'u1', region: 'us-east-1', operatingMode: 'CONSERVATIVE', goal: { objective: 'RETIREMENT' } } },
          ),
        ],
      });

      expect(mockPublish).toHaveBeenCalledTimes(1);
      const entries: Array<{ Detail: string; DetailType: string }> = mockPublish.mock.calls[0][0];
      const types = entries.map(e => e.DetailType);
      expect(types).toEqual(expect.arrayContaining(['INVESTOR_PROFILE_UPDATED', 'OPERATING_MODE_CHANGED']));
      expect(types).not.toContain('GOAL_UPDATED');

      const semantic = entries.find(e => e.DetailType === 'OPERATING_MODE_CHANGED')!;
      const detail = JSON.parse(semantic.Detail);
      expect(detail.subject.operatingMode).toBe('AGGRESSIVE');
      expect(detail.previousSubject.operatingMode).toBe('CONSERVATIVE');

      // Carrier must NOT carry previousSubject
      const carrier = entries.find(e => e.DetailType === 'INVESTOR_PROFILE_UPDATED')!;
      const carrierDetail = JSON.parse(carrier.Detail);
      expect(carrierDetail.previousSubject).toBeUndefined();
    });

    it('emits only the carrier when no watched field changed', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'InvestorProfile:MODIFY': {
          always: 'INVESTOR_PROFILE_UPDATED',
          onFieldChange: { operatingMode: 'OPERATING_MODE_CHANGED' },
        },
      });
      const handler = changeDataCapture();
      await handler({
        Records: [
          fakeDdbStreamRecord('MODIFY',
            { pk: 'p', sk: 's', __typename: 'InvestorProfile', tenantId: 't', userId: 'u', region: 'r', operatingMode: 'BALANCED', email: 'new@x' },
            { oldImage: { pk: 'p', sk: 's', __typename: 'InvestorProfile', tenantId: 't', userId: 'u', region: 'r', operatingMode: 'BALANCED', email: 'old@x' } },
          ),
        ],
      });

      const entries: Array<{ DetailType: string }> = mockPublish.mock.calls[0][0];
      const types = entries.map(e => e.DetailType);
      expect(types).toEqual(['INVESTOR_PROFILE_UPDATED']);
    });

    it('treats nested-object inequality as a change (deep equal)', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'InvestorProfile:MODIFY': {
          always: 'INVESTOR_PROFILE_UPDATED',
          onFieldChange: { goal: 'GOAL_UPDATED' },
        },
      });
      const handler = changeDataCapture();
      await handler({
        Records: [
          fakeDdbStreamRecord('MODIFY',
            { pk: 'p', sk: 's', __typename: 'InvestorProfile', tenantId: 't', userId: 'u', region: 'r', goal: { objective: 'RETIREMENT', timeHorizonMonths: 240 } },
            { oldImage: { pk: 'p', sk: 's', __typename: 'InvestorProfile', tenantId: 't', userId: 'u', region: 'r', goal: { objective: 'RETIREMENT', timeHorizonMonths: 120 } } },
          ),
        ],
      });

      const entries: Array<{ DetailType: string }> = mockPublish.mock.calls[0][0];
      const types = entries.map(e => e.DetailType);
      expect(types).toEqual(expect.arrayContaining(['INVESTOR_PROFILE_UPDATED', 'GOAL_UPDATED']));
    });

    it('falls back to carrier-only when OldImage is missing (defensive)', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'InvestorProfile:MODIFY': {
          always: 'INVESTOR_PROFILE_UPDATED',
          onFieldChange: { operatingMode: 'OPERATING_MODE_CHANGED' },
        },
      });
      const handler = changeDataCapture();
      await handler({
        Records: [
          fakeDdbStreamRecord('MODIFY',
            { pk: 'p', sk: 's', __typename: 'InvestorProfile', tenantId: 't', userId: 'u', region: 'r', operatingMode: 'AGGRESSIVE' },
          ),
        ],
      });

      const entries: Array<{ DetailType: string }> = mockPublish.mock.calls[0][0];
      const types = entries.map(e => e.DetailType);
      expect(types).toEqual(['INVESTOR_PROFILE_UPDATED']);
    });
  });

  describe('advanced features', () => {
    it('applies transform when provided', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'Order:INSERT': 'ORDER_CREATED',
      });
      const handler = changeDataCapture({
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
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'Order:INSERT': 'ORDER_CREATED',
      });
      const handler = changeDataCapture({
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
});
