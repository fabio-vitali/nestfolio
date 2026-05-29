import { ledgerEntryRecorded } from '../../../src/transforms/ledger-entry-recorded';

describe('ledgerEntryRecorded transform', () => {
  const makeUow = (subject: Record<string, unknown>) => ({
    event: {
      id: 'e1',
      type: 'LEDGER_ENTRY_RECORDED',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject,
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  });

  it('writes a HistoryEntry record (P2) for an actual-stream entry', () => {
    const result = ledgerEntryRecorded(makeUow({
      eventId: 'evt-1',
      eventType: 'ORDER_FILLED',
      payload: { orderId: 'o1' },
      timestamp: '2026-01-01T00:00:00.000Z',
      sequenceNo: 42,
    }) as Parameters<typeof ledgerEntryRecorded>[0]);

    const intent = result as Record<string, unknown>;
    expect(intent).toMatchObject({
      _tag: 'record',
      typename: 'HistoryEntry',
      overrides: { pk: 'History#t1', sk: 'Entry#42' },
    });
  });

  it('writes versioned Simulation + SimulationPosition from snapshot for a simulated entry', () => {
    const result = ledgerEntryRecorded(makeUow({
      eventId: 'evt-sim',
      eventType: 'SIMULATED_TRADE',
      payload: {},
      timestamp: '2026-01-01T00:00:00.000Z',
      sequenceNo: 5,
      streamType: 'simulated',
      snapshot: {
        positions: { AAPL: { symbol: 'AAPL', quantity: 12, averageCostBasis: 148, totalCostBasis: 1776, lastFillPrice: 155 } },
        cashBalanceCents: 950_000,
        lastEventSequence: 9,
      },
    }) as Parameters<typeof ledgerEntryRecorded>[0]);

    const intents = result as Array<Record<string, unknown>>;

    const sim = intents.find((i) => i.typename === 'Simulation');
    expect(sim).toMatchObject({
      _tag: 'projectVersioned',
      typename: 'Simulation',
      version: 9,
      overrides: { pk: 'Simulation#t1', sk: 'Latest' },
    });
    expect((sim!.fields as Record<string, unknown>).cashBalanceCents).toBe(950_000);

    const simPos = intents.find((i) => i.typename === 'SimulationPosition');
    expect(simPos).toMatchObject({
      _tag: 'projectVersioned',
      typename: 'SimulationPosition',
      version: 9,
      overrides: { pk: 'Simulation#t1', sk: 'Position#AAPL' },
    });
    expect((simPos!.fields as Record<string, unknown>).quantity).toBe(12);
  });

  it('writes a Checkpoint record (P2) when sequenceNo is a multiple of 100', () => {
    const result = ledgerEntryRecorded(makeUow({
      eventId: 'evt-cp',
      eventType: 'CHECKPOINT',
      payload: {},
      timestamp: '2026-01-15T00:00:00.000Z',
      sequenceNo: 200,
    }) as Parameters<typeof ledgerEntryRecorded>[0]);

    const intents = result as Array<Record<string, unknown>>;
    const cp = intents.find((i) => i.typename === 'Checkpoint');
    expect(cp).toMatchObject({
      _tag: 'record',
      typename: 'Checkpoint',
      overrides: { pk: 'Checkpoint#t1', sk: '2026-01-15' },
    });
  });
});
