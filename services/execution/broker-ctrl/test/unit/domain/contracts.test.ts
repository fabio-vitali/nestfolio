import { FundingSnapshotSchema } from '@nestfolio/execution-adpt/domain';
import {
  NormalizedOrderEventSchema,
  BrokerOrderSchema,
  ExecutionModeSchema,
} from '../../../src/domain/contracts';

describe('broker-ctrl contracts', () => {
  it('NormalizedOrderEventSchema parses a FILLED order subject (dry — identity stripped)', () => {
    const row = {
      pk: 'NormalizedEvent#t#o1', sk: 'ORDER_FILLED#2026', __typename: 'NormalizedEvent',
      tenantId: 't', userId: 'u', region: 'us-east-1',
      orderId: 'o1', executionMode: 'simulation', filledQty: 10, averageFillPrice: 200,
      timestamp: '2026-06-10T00:00:00.000Z',
    };
    const parsed = NormalizedOrderEventSchema.parse(row);
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.orderId).toBe('o1');
    expect(parsed.filledQty).toBe(10);
  });

  it('NormalizedOrderEventSchema parses a REJECTED order subject (failureReason, no fill)', () => {
    expect(NormalizedOrderEventSchema.parse({
      orderId: 'o1', executionMode: 'live', failureReason: 'insufficient buying power',
      timestamp: '2026-06-10T00:00:00.000Z',
    }).failureReason).toBe('insufficient buying power');
  });

  it('NormalizedOrderEventSchema rejects an unknown executionMode', () => {
    expect(() => NormalizedOrderEventSchema.parse({
      orderId: 'o1', executionMode: 'paper', timestamp: '2026-06-10T00:00:00.000Z',
    })).toThrow();
  });

  it('BrokerOrderSchema parses the internal state row (dry)', () => {
    const parsed = BrokerOrderSchema.parse({
      tenantId: 't', pk: 'BrokerOrder#t#o1', sk: 'BrokerOrder', __typename: 'BrokerOrder',
      orderId: 'o1', executionMode: 'live', state: 'AWAITING_FILL', routedTo: 'alpaca',
      requestedQty: 10, filledQty: 0, remainingQty: 10, retryCount: 0,
      instrumentId: 'VTI', routedAt: '2026-06-10T00:00:00.000Z',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.state).toBe('AWAITING_FILL');
  });

  it('BrokerOrderSchema rejects an invalid state', () => {
    expect(() => BrokerOrderSchema.parse({
      orderId: 'o1', executionMode: 'live', state: 'PAUSED', routedTo: 'alpaca',
      requestedQty: 10, filledQty: 0, remainingQty: 10, retryCount: 0,
      instrumentId: 'VTI', routedAt: '2026-06-10T00:00:00.000Z',
    })).toThrow();
  });

  it('BrokerOrderSchema parses when all optional fields are omitted', () => {
    const parsed = BrokerOrderSchema.parse({
      orderId: 'o1', executionMode: 'simulation', state: 'ROUTING', routedTo: 'sim',
      requestedQty: 5, filledQty: 0, remainingQty: 5, retryCount: 0,
      instrumentId: 'VTI', routedAt: '2026-06-10T00:00:00.000Z',
    });
    expect(parsed.fillTaskToken).toBeUndefined();
    expect(parsed.averageFillPrice).toBeUndefined();
    expect(parsed.filledAt).toBeUndefined();
    expect(parsed.failureReason).toBeUndefined();
  });

  it('ExecutionModeSchema parses the cache row (dry)', () => {
    expect(ExecutionModeSchema.parse({ mode: 'live', updatedAt: '2026-06-10T00:00:00.000Z' }).mode).toBe('live');
  });

  it('ExecutionModeSchema rejects an invalid mode', () => {
    expect(() => ExecutionModeSchema.parse({ mode: 'paper', updatedAt: '2026-06-10T00:00:00.000Z' })).toThrow();
  });
});

const depositSettled = {
  sk: 'DEPOSIT_SETTLED',
  direction: 'DEPOSIT' as const,
  status: 'settled' as const,
  transferId: 'dep-1',
  tenantId: 't-1',
  userId: 'u-1',
  region: 'us-east-1',
  amountCents: 100_000,
  currency: 'USD',
  executionMode: 'simulation' as const,
  initiatedAt: '2026-01-01T00:00:00.000Z',
  detectedAt: '2026-01-02T00:00:00.000Z',
  settledAt: '2026-01-03T00:00:00.000Z',
  timestamp: '2026-01-03T00:00:00.000Z',
  __version: 3,
};

const depositFailed = {
  sk: 'DEPOSIT_FAILED',
  direction: 'DEPOSIT' as const,
  status: 'failed' as const,
  transferId: 'dep-2',
  tenantId: 't-1',
  userId: 'u-1',
  region: 'us-east-1',
  amountCents: 50_000,
  currency: 'USD',
  executionMode: 'live' as const,
  initiatedAt: '2026-01-01T00:00:00.000Z',
  failedAt: '2026-01-04T00:00:00.000Z',
  reason: 'Insufficient funds',
  timestamp: '2026-01-04T00:00:00.000Z',
  __version: 3,
};

const withdrawalSettled = {
  sk: 'WITHDRAWAL_SETTLED',
  direction: 'WITHDRAWAL' as const,
  status: 'settled' as const,
  transferId: 'wd-1',
  tenantId: 't-1',
  userId: 'u-1',
  region: 'us-east-1',
  amountCents: 75_000,
  currency: 'USD',
  executionMode: 'simulation' as const,
  initiatedAt: '2026-01-01T00:00:00.000Z',
  settledAt: '2026-01-03T00:00:00.000Z',
  timestamp: '2026-01-03T00:00:00.000Z',
  __version: 3,
};

const withdrawalFailed = {
  sk: 'WITHDRAWAL_FAILED',
  direction: 'WITHDRAWAL' as const,
  status: 'failed' as const,
  transferId: 'wd-2',
  tenantId: 't-1',
  userId: 'u-1',
  region: 'us-east-1',
  amountCents: 25_000,
  currency: 'USD',
  executionMode: 'live' as const,
  initiatedAt: '2026-01-01T00:00:00.000Z',
  failedAt: '2026-01-05T00:00:00.000Z',
  reason: 'Broker rejected',
  timestamp: '2026-01-05T00:00:00.000Z',
  __version: 3,
};

describe('FundingSnapshotSchema', () => {
  it('parses a DEPOSIT_SETTLED carrier result', () => {
    expect(() => FundingSnapshotSchema.parse(depositSettled)).not.toThrow();
    expect(FundingSnapshotSchema.parse(depositSettled).direction).toBe('DEPOSIT');
  });

  it('parses a DEPOSIT_FAILED carrier result', () => {
    expect(() => FundingSnapshotSchema.parse(depositFailed)).not.toThrow();
    expect(FundingSnapshotSchema.parse(depositFailed).reason).toBe('Insufficient funds');
  });

  it('parses a WITHDRAWAL_SETTLED carrier result', () => {
    expect(() => FundingSnapshotSchema.parse(withdrawalSettled)).not.toThrow();
    expect(FundingSnapshotSchema.parse(withdrawalSettled).direction).toBe('WITHDRAWAL');
  });

  it('parses a WITHDRAWAL_FAILED carrier result', () => {
    expect(() => FundingSnapshotSchema.parse(withdrawalFailed)).not.toThrow();
    expect(FundingSnapshotSchema.parse(withdrawalFailed).reason).toBe('Broker rejected');
  });

  it('throws when transferId is omitted', () => {
    const { transferId: _omit, ...withoutTransferId } = depositSettled;
    expect(() => FundingSnapshotSchema.parse(withoutTransferId)).toThrow();
  });
});
