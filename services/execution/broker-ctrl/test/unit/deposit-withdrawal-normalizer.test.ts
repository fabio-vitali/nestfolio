// Set env vars BEFORE any imports (production export constructs a repo at module load)
process.env.TABLE_NAME = 'test-table';

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  TableRepository: class {
    protected readonly docClient = { send: jest.fn() };
    protected readonly tableName: string;
    constructor(tableName: string) {
      this.tableName = tableName;
    }
  },
  requireEnv: (name: string) => process.env[name] ?? name,
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
import { createNormalizerHandlers } from '../../src/handlers/deposit-withdrawal-normalizer';
import { BrokerCtrlInboundEventTypes } from '../../src/domain/events';

const requested = {
  transferId: 'dep-1',
  amountCents: 100000,
  currency: 'USD',
  initiatedAt: '2026-01-01T00:00:00.000Z',
  userId: 'u-1',
};

const ctx = (over = {}) =>
  ({
    eventId: 'evt-1',
    eventType: 'SIM_DEPOSIT_COMPLETED',
    tenantId: 't-1',
    userId: 'u-1',
    region: 'us-east-1',
    timestamp: '2026-01-03T00:00:00.000Z',
    ...over,
  }) as any;

describe('deposit-withdrawal-normalizer', () => {
  let repo: { getRequested: jest.Mock };
  let handlers: ReturnType<typeof createNormalizerHandlers>;

  beforeEach(() => {
    repo = { getRequested: jest.fn().mockResolvedValue(requested) };
    handlers = createNormalizerHandlers(repo as any);
  });

  it('SIM_DEPOSIT_COMPLETED → [DEPOSIT_DETECTED v2, DEPOSIT_SETTLED v3] carriers', async () => {
    const out = await handlers[BrokerCtrlInboundEventTypes.SIM_DEPOSIT_COMPLETED](
      { subject: { depositId: 'dep-1', amountCents: 100000, currency: 'USD' } } as any,
      ctx(),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect(intents.map((i: any) => i.overrides.sk)).toEqual(['DEPOSIT_DETECTED', 'DEPOSIT_SETTLED']);
    expect((intents[0] as any).fields).toMatchObject({
      status: 'detected',
      __version: 2,
      detectedAt: '2026-01-03T00:00:00.000Z',
      initiatedAt: requested.initiatedAt,
    });
    expect((intents[1] as any).fields).toMatchObject({
      status: 'settled',
      __version: 3,
      settledAt: '2026-01-03T00:00:00.000Z',
      initiatedAt: requested.initiatedAt,
      detectedAt: '2026-01-03T00:00:00.000Z',
    });
  });

  it('SIM_DEPOSIT_COMPLETED → falls back to subject + eventId when no requested carrier', async () => {
    repo.getRequested.mockResolvedValueOnce(undefined);
    const out = await handlers[BrokerCtrlInboundEventTypes.SIM_DEPOSIT_COMPLETED](
      { subject: { amountCents: 5000, currency: 'USD' } } as any,
      ctx({ eventId: 'evt-fallback' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect((intents[0] as any).overrides.pk).toBe('Funding#t-1#evt-fallback');
    expect((intents[0] as any).fields).toMatchObject({
      amountCents: 5000,
      initiatedAt: '2026-01-03T00:00:00.000Z',
    });
  });

  it('SIM_WITHDRAWAL_COMPLETED → [WITHDRAWAL_SETTLED v3] carrier; carry-forward amount wins, settledAt set', async () => {
    // requested carrier carries amountCents=100000; the inbound subject's 50000 is
    // the fallback only and must NOT override the carried-forward value.
    repo.getRequested.mockResolvedValueOnce({ ...requested, transferId: 'wd-1' });
    const out = await handlers[BrokerCtrlInboundEventTypes.SIM_WITHDRAWAL_COMPLETED](
      { subject: { withdrawalId: 'wd-1', amountCents: 50000, currency: 'USD' } } as any,
      ctx({ eventType: 'SIM_WITHDRAWAL_COMPLETED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect(intents).toHaveLength(1);
    expect((intents[0] as any).overrides.sk).toBe('WITHDRAWAL_SETTLED');
    expect((intents[0] as any).fields).toMatchObject({
      direction: 'WITHDRAWAL',
      status: 'settled',
      __version: 3,
      amountCents: 100000,
      settledAt: '2026-01-03T00:00:00.000Z',
    });
  });

  it('SIM_WITHDRAWAL_COMPLETED → falls back to subject amount when no requested carrier', async () => {
    repo.getRequested.mockResolvedValueOnce(undefined);
    const out = await handlers[BrokerCtrlInboundEventTypes.SIM_WITHDRAWAL_COMPLETED](
      { subject: { withdrawalId: 'wd-2', amountCents: 50000, currency: 'USD' } } as any,
      ctx({ eventType: 'SIM_WITHDRAWAL_COMPLETED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect((intents[0] as any).fields).toMatchObject({ amountCents: 50000 });
  });

  it('ALPACA_TRANSFER_COMPLETED INCOMING → [DEPOSIT_DETECTED, DEPOSIT_SETTLED] live carriers', async () => {
    repo.getRequested.mockResolvedValueOnce({ ...requested, transferId: 'xfr-1' });
    const out = await handlers[BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_COMPLETED](
      { subject: { transferId: 'xfr-1', amountCents: 50000, direction: 'INCOMING' } } as any,
      ctx({ eventType: 'ALPACA_TRANSFER_COMPLETED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect(intents.map((i: any) => i.overrides.sk)).toEqual(['DEPOSIT_DETECTED', 'DEPOSIT_SETTLED']);
    expect((intents[0] as any).fields).toMatchObject({ direction: 'DEPOSIT', executionMode: 'live' });
  });

  it('ALPACA_TRANSFER_COMPLETED OUTGOING → [WITHDRAWAL_SETTLED] live carrier', async () => {
    repo.getRequested.mockResolvedValueOnce({ ...requested, transferId: 'xfr-2' });
    const out = await handlers[BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_COMPLETED](
      { subject: { transferId: 'xfr-2', amountCents: 30000, direction: 'OUTGOING' } } as any,
      ctx({ eventType: 'ALPACA_TRANSFER_COMPLETED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect(intents).toHaveLength(1);
    expect((intents[0] as any).overrides.sk).toBe('WITHDRAWAL_SETTLED');
    expect((intents[0] as any).fields).toMatchObject({ direction: 'WITHDRAWAL', executionMode: 'live' });
  });

  it('ALPACA_TRANSFER_FAILED INCOMING → [DEPOSIT_FAILED v3] carrier with reason', async () => {
    repo.getRequested.mockResolvedValueOnce({ ...requested, transferId: 'xfr-1' });
    const out = await handlers[BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_FAILED](
      { subject: { transferId: 'xfr-1', amountCents: 25000, direction: 'INCOMING', failureReason: 'bank declined' } } as any,
      ctx({ eventType: 'ALPACA_TRANSFER_FAILED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect((intents[0] as any).overrides.sk).toBe('DEPOSIT_FAILED');
    expect((intents[0] as any).fields).toMatchObject({
      status: 'failed',
      __version: 3,
      reason: 'bank declined',
      failedAt: '2026-01-03T00:00:00.000Z',
    });
  });

  it('ALPACA_TRANSFER_FAILED OUTGOING → [WITHDRAWAL_FAILED v3] carrier; defaults reason', async () => {
    repo.getRequested.mockResolvedValueOnce({ ...requested, transferId: 'xfr-2' });
    const out = await handlers[BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_FAILED](
      { subject: { transferId: 'xfr-2', amountCents: 10000, direction: 'OUTGOING' } } as any,
      ctx({ eventType: 'ALPACA_TRANSFER_FAILED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect((intents[0] as any).overrides.sk).toBe('WITHDRAWAL_FAILED');
    expect((intents[0] as any).fields).toMatchObject({
      direction: 'WITHDRAWAL',
      status: 'failed',
      reason: 'Transfer failed',
    });
  });
});
