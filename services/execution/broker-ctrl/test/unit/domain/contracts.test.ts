import { FundingSnapshotSchema } from '@nestfolio/execution-adpt/domain';

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
