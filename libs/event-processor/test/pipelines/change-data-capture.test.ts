import { changeDataCapture } from '../../src/pipelines/change-data-capture';
import { fakeDdbStreamRecord } from '../../src/testing/fake-records';
import { z } from 'zod';

const mockPublish = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/util/event-bridge-publisher', () => ({
  EventBridgePublisher: jest.fn().mockImplementation(() => ({
    publish: mockPublish,
  })),
}));

const mockPublishErrors = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/engine/error-event-publisher', () => ({
  ErrorEventPublisher: jest.fn().mockImplementation(() => ({
    publishErrors: mockPublishErrors,
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

  describe('onFieldChange-only emission (no carrier)', () => {
    it('emits only the matched semantic event when a watched field changes', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'Mandate:MODIFY': {
          onFieldChange: { status: 'MANDATE_REVOKED', operatingMode: 'OPERATING_MODE_CHANGED' },
        },
      });
      const handler = changeDataCapture();
      await handler({
        Records: [
          fakeDdbStreamRecord('MODIFY',
            { pk: 'InvestorProfile#t#u', sk: 'Mandate', __typename: 'Mandate', tenantId: 't', userId: 'u', region: 'r', status: 'ACTIVE', operatingMode: 'AGGRESSIVE', __version: 2 },
            { oldImage: { pk: 'InvestorProfile#t#u', sk: 'Mandate', __typename: 'Mandate', tenantId: 't', userId: 'u', region: 'r', status: 'ACTIVE', operatingMode: 'BALANCED', __version: 1 } },
          ),
        ],
      });
      const entries = mockPublish.mock.calls[0][0];
      const types = entries.map((e: { DetailType: string }) => e.DetailType);
      expect(types).toEqual(['OPERATING_MODE_CHANGED']);
      const detail = JSON.parse(entries[0].Detail);
      expect(detail.subject.operatingMode).toBe('AGGRESSIVE');
      expect(detail.subject.status).toBe('ACTIVE');
      expect(detail.subject.__version).toBe(2);
      expect(detail.previousSubject.operatingMode).toBe('BALANCED');
    });

    it('emits MANDATE_REVOKED (only) when status changes but operatingMode does not', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'Mandate:MODIFY': {
          onFieldChange: { status: 'MANDATE_REVOKED', operatingMode: 'OPERATING_MODE_CHANGED' },
        },
      });
      const handler = changeDataCapture();
      await handler({
        Records: [
          fakeDdbStreamRecord('MODIFY',
            { pk: 'InvestorProfile#t#u', sk: 'Mandate', __typename: 'Mandate', tenantId: 't', userId: 'u', region: 'r', status: 'REVOKED', operatingMode: 'BALANCED', __version: 3 },
            { oldImage: { pk: 'InvestorProfile#t#u', sk: 'Mandate', __typename: 'Mandate', tenantId: 't', userId: 'u', region: 'r', status: 'ACTIVE', operatingMode: 'BALANCED', __version: 2 } },
          ),
        ],
      });
      const entries = mockPublish.mock.calls[0][0];
      expect(entries.map((e: { DetailType: string }) => e.DetailType)).toEqual(['MANDATE_REVOKED']);
    });

    it('publishes nothing when no watched field changed (no carrier to fall back to)', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'Mandate:MODIFY': {
          onFieldChange: { status: 'MANDATE_REVOKED', operatingMode: 'OPERATING_MODE_CHANGED' },
        },
      });
      const handler = changeDataCapture();
      await handler({
        Records: [
          fakeDdbStreamRecord('MODIFY',
            { pk: 'InvestorProfile#t#u', sk: 'Mandate', __typename: 'Mandate', tenantId: 't', userId: 'u', region: 'r', status: 'ACTIVE', operatingMode: 'BALANCED', updatedAt: 'new', __version: 5 },
            { oldImage: { pk: 'InvestorProfile#t#u', sk: 'Mandate', __typename: 'Mandate', tenantId: 't', userId: 'u', region: 'r', status: 'ACTIVE', operatingMode: 'BALANCED', updatedAt: 'old', __version: 4 } },
          ),
        ],
      });
      const totalEntries = mockPublish.mock.calls.reduce((n: number, c: unknown[]) => n + (c[0] as unknown[]).length, 0);
      expect(totalEntries).toBe(0);
    });

    it('publishes nothing (does not throw) when OldImage is absent on an onFieldChange-only mapping', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'Mandate:MODIFY': {
          onFieldChange: { status: 'MANDATE_REVOKED', operatingMode: 'OPERATING_MODE_CHANGED' },
        },
      });
      const handler = changeDataCapture();
      await handler({
        Records: [
          fakeDdbStreamRecord('MODIFY',
            { pk: 'InvestorProfile#t#u', sk: 'Mandate', __typename: 'Mandate', tenantId: 't', userId: 'u', region: 'r', status: 'REVOKED', operatingMode: 'AGGRESSIVE', __version: 6 },
          ),
        ],
      });
      const totalEntries = mockPublish.mock.calls.reduce((n: number, c: unknown[]) => n + (c[0] as unknown[]).length, 0);
      expect(totalEntries).toBe(0);
    });
  });

  describe('advanced features', () => {
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

  describe('typed-subject mode (schemas / exemptTypenames)', () => {
    const BalanceSchema = z.object({
      cashBalanceCents: z.number(),
      snapshot: z.object({ lastEventSequence: z.number() }),
    });

    it('emits the DRY parsed subject (drops envelope + identity) for a covered __typename', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({ 'BalanceEvent:INSERT': 'BALANCE_UPDATED' });
      const handler = changeDataCapture({ schemas: { BalanceEvent: BalanceSchema }, exemptTypenames: [] });
      await handler({ Records: [ fakeDdbStreamRecord('INSERT', {
        pk: 'Account#t1', sk: 'BalanceEvent#1', __typename: 'BalanceEvent',
        tenantId: 't1', userId: 'u1', region: 'us-east-1', createdAt: 'x',
        cashBalanceCents: 1000, snapshot: { lastEventSequence: 5 },
      }) ] });
      const detail = JSON.parse(mockPublish.mock.calls[0][0][0].Detail);
      expect(detail.subject).toEqual({ cashBalanceCents: 1000, snapshot: { lastEventSequence: 5 } });
      expect(detail.subject.pk).toBeUndefined();
      expect(detail.subject.__typename).toBeUndefined();
      expect(detail.subject.tenantId).toBeUndefined();
      expect(detail.context.tenantId).toBe('t1');
    });

    it('emits the fat row unchanged for an exempt __typename', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({ 'AgentInvocation:INSERT': 'GOAL_INTERPRETATION_PRODUCED' });
      const handler = changeDataCapture({ schemas: {}, exemptTypenames: ['AgentInvocation'] });
      await handler({ Records: [ fakeDdbStreamRecord('INSERT', {
        pk: 'D#1', sk: 'AgentInvocation#x', __typename: 'AgentInvocation', tenantId: 't1', decisionId: 'd1',
      }) ] });
      const detail = JSON.parse(mockPublish.mock.calls[0][0][0].Detail);
      expect(detail.subject.__typename).toBe('AgentInvocation');
      expect(detail.subject.decisionId).toBe('d1');
    });

    it('routes a covered row that drifts from its schema to the error publisher (NotRetryable, not retried)', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({ 'BalanceEvent:INSERT': 'BALANCE_UPDATED' });
      const handler = changeDataCapture({ schemas: { BalanceEvent: BalanceSchema }, exemptTypenames: [] });
      await handler({ Records: [ fakeDdbStreamRecord('INSERT', {
        pk: 'Account#t1', sk: 'BalanceEvent#1', __typename: 'BalanceEvent', tenantId: 't1',
      }) ] });
      expect(mockPublish).not.toHaveBeenCalled();
      expect(mockPublishErrors).toHaveBeenCalled();
    });

    it('throws at init when a mapped __typename is neither covered nor exempt', () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'BalanceEvent:INSERT': 'BALANCE_UPDATED',
        'Forgot:INSERT': 'FORGOTTEN',
      });
      expect(() => changeDataCapture({ schemas: { BalanceEvent: BalanceSchema } })).toThrow(/Forgot/);
    });

    it('does NOT run the completeness guard in legacy mode (no schemas, no exempt)', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({ 'Anything:INSERT': 'X' });
      const handler = changeDataCapture();
      await handler({ Records: [ fakeDdbStreamRecord('INSERT', {
        pk: 'p', sk: 's', __typename: 'Anything', tenantId: 't1', foo: 'bar',
      }) ] });
      const detail = JSON.parse(mockPublish.mock.calls[0][0][0].Detail);
      expect(detail.subject.__typename).toBe('Anything');
      expect(detail.subject.foo).toBe('bar');
    });
  });
});
