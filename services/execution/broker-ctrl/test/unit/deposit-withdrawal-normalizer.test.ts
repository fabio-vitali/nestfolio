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
      { subject: { depositId: 'dep-1', amountCents: 100000, currency: 'USD', sourceEventId: 'e', timestamp: 't' } } as any,
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

  it('SIM_DEPOSIT_COMPLETED → falls back to subject + depositId when no requested carrier', async () => {
    repo.getRequested.mockResolvedValueOnce(undefined);
    const out = await handlers[BrokerCtrlInboundEventTypes.SIM_DEPOSIT_COMPLETED](
      { subject: { depositId: 'dep-fb', amountCents: 5000, currency: 'USD', sourceEventId: 'e', timestamp: 't' } } as any,
      ctx({ eventId: 'evt-fallback' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect((intents[0] as any).overrides.pk).toBe('Funding#t-1#dep-fb');
    expect((intents[0] as any).fields).toMatchObject({
      amountCents: 5000,
      initiatedAt: '2026-01-03T00:00:00.000Z',
    });
  });

  it('SIM_WITHDRAWAL_COMPLETED → [WITHDRAWAL_SETTLED v3]; carry-forward amountCents wins', async () => {
    repo.getRequested.mockResolvedValueOnce({ ...requested, transferId: 'wd-1' });
    const out = await handlers[BrokerCtrlInboundEventTypes.SIM_WITHDRAWAL_COMPLETED](
      { subject: { withdrawalId: 'wd-1', amount: 500, sourceEventId: 'e', timestamp: 't' } } as any,
      ctx({ eventType: 'SIM_WITHDRAWAL_COMPLETED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect((intents[0] as any).overrides.sk).toBe('WITHDRAWAL_SETTLED');
    expect((intents[0] as any).fields).toMatchObject({ direction: 'WITHDRAWAL', status: 'settled', __version: 3, amountCents: 100000, settledAt: '2026-01-03T00:00:00.000Z' });
  });

  it('SIM_WITHDRAWAL_COMPLETED → falls back to subject amount*100 when no requested carrier', async () => {
    repo.getRequested.mockResolvedValueOnce(undefined);
    const out = await handlers[BrokerCtrlInboundEventTypes.SIM_WITHDRAWAL_COMPLETED](
      { subject: { withdrawalId: 'wd-2', amount: 500, sourceEventId: 'e', timestamp: 't' } } as any,
      ctx({ eventType: 'SIM_WITHDRAWAL_COMPLETED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect((intents[0] as any).overrides.pk).toBe('Funding#t-1#wd-2');
    expect((intents[0] as any).fields).toMatchObject({ amountCents: 50000 });
  });

  it('ALPACA_TRANSFER_COMPLETED INCOMING → keys carryForward on nestfolioTransferId → live deposit carriers', async () => {
    repo.getRequested.mockResolvedValueOnce({ ...requested, transferId: 'dep-9' });
    const out = await handlers[BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_COMPLETED](
      { subject: { nestfolioTransferId: 'dep-9', alpacaTransferId: 'a1', amount: 500, direction: 'INCOMING', status: 'COMPLETED' } } as any,
      ctx({ eventType: 'ALPACA_TRANSFER_COMPLETED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect(repo.getRequested).toHaveBeenCalledWith('t-1', 'dep-9', 'DEPOSIT_REQUESTED');
    expect(intents.map((i: any) => i.overrides.sk)).toEqual(['DEPOSIT_DETECTED', 'DEPOSIT_SETTLED']);
    expect((intents[0] as any).fields).toMatchObject({ direction: 'DEPOSIT', executionMode: 'live', amountCents: 100000 });
    expect((intents[0] as any).overrides.pk).toBe('Funding#t-1#dep-9');
  });

  it('ALPACA_TRANSFER_COMPLETED OUTGOING → live withdrawal settled carrier', async () => {
    repo.getRequested.mockResolvedValueOnce({ ...requested, transferId: 'wd-9' });
    const out = await handlers[BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_COMPLETED](
      { subject: { nestfolioTransferId: 'wd-9', alpacaTransferId: 'a2', amount: 300, direction: 'OUTGOING', status: 'COMPLETED' } } as any,
      ctx({ eventType: 'ALPACA_TRANSFER_COMPLETED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect(intents).toHaveLength(1);
    expect((intents[0] as any).overrides.sk).toBe('WITHDRAWAL_SETTLED');
    expect((intents[0] as any).fields).toMatchObject({ direction: 'WITHDRAWAL', executionMode: 'live' });
  });

  it('ALPACA_TRANSFER_FAILED INCOMING → DEPOSIT_FAILED with reason, keyed on nestfolioTransferId', async () => {
    repo.getRequested.mockResolvedValueOnce({ ...requested, transferId: 'dep-9' });
    const out = await handlers[BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_FAILED](
      { subject: { nestfolioTransferId: 'dep-9', alpacaTransferId: '', amount: 250, direction: 'INCOMING', status: 'FAILED', failureReason: 'bank declined' } } as any,
      ctx({ eventType: 'ALPACA_TRANSFER_FAILED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect((intents[0] as any).overrides.sk).toBe('DEPOSIT_FAILED');
    expect((intents[0] as any).fields).toMatchObject({ status: 'failed', __version: 3, reason: 'bank declined' });
  });

  it('ALPACA_TRANSFER_FAILED OUTGOING → WITHDRAWAL_FAILED, defaults reason', async () => {
    repo.getRequested.mockResolvedValueOnce({ ...requested, transferId: 'wd-9' });
    const out = await handlers[BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_FAILED](
      { subject: { nestfolioTransferId: 'wd-9', alpacaTransferId: '', amount: 100, direction: 'OUTGOING', status: 'FAILED' } } as any,
      ctx({ eventType: 'ALPACA_TRANSFER_FAILED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect((intents[0] as any).overrides.sk).toBe('WITHDRAWAL_FAILED');
    expect((intents[0] as any).fields).toMatchObject({ direction: 'WITHDRAWAL', status: 'failed', reason: 'Transfer failed' });
  });
});
