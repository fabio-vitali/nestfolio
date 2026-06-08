import { z } from 'zod';
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

  // The shape the real ledger-ctrl producer emits (LedgerEntryEvent).
  const actualSubject = {
    tenantId: 't1',
    streamType: 'actual',
    lastEventSequence: 42,
    snapshotAt: '2026-01-01T00:00:00.000Z',
    snapshot: {
      positions: { AAPL: { symbol: 'AAPL', quantity: 5, averageCostBasis: 150, totalCostBasis: 750, lastFillPrice: 150 } },
      cashBalanceCents: 250_000,
      lastEventSequence: 42,
    },
  };

  it('writes a HistoryEntry (P2) for an actual entry, keyed on the padded sequence', () => {
    const result = ledgerEntryRecorded(
      makeUow(actualSubject) as Parameters<typeof ledgerEntryRecorded>[0],
    );
    const intents = result as Array<Record<string, unknown>>;
    const hist = intents.find((i) => i.typename === 'HistoryEntry');
    expect(hist).toMatchObject({
      _tag: 'record',
      typename: 'HistoryEntry',
      overrides: { pk: 'History#t1', sk: '00000042' },
    });
    const fields = hist!.fields as Record<string, unknown>;
    expect(fields.eventType).toBe('LEDGER_ENTRY_RECORDED'); // envelope detail-type
    expect(fields.sequenceNo).toBe(42);
    // eventId + createdAt are injected by the record() executor, not the transform.
    expect(fields.eventId).toBeUndefined();
    expect(fields.createdAt).toBeUndefined();
  });

  it('writes one per-date Checkpoint (P2) from the snapshot for an actual entry', () => {
    const result = ledgerEntryRecorded(
      makeUow(actualSubject) as Parameters<typeof ledgerEntryRecorded>[0],
    );
    const intents = result as Array<Record<string, unknown>>;
    const cp = intents.find((i) => i.typename === 'Checkpoint');
    expect(cp).toMatchObject({
      _tag: 'record',
      typename: 'Checkpoint',
      overrides: { pk: 'Checkpoint#t1', sk: '2026-01-01' },
    });
    const fields = cp!.fields as Record<string, unknown>;
    expect(fields.cashBalanceCents).toBe(250_000);
    expect(fields.date).toBe('2026-01-01');
  });

  it('writes versioned Simulation + SimulationPosition and NO history/checkpoint for a simulated entry', () => {
    const result = ledgerEntryRecorded(makeUow({
      tenantId: 't1',
      streamType: 'simulated',
      lastEventSequence: 9,
      snapshotAt: '2026-01-01T00:00:00.000Z',
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

    expect(intents.find((i) => i.typename === 'HistoryEntry')).toBeUndefined();
    expect(intents.find((i) => i.typename === 'Checkpoint')).toBeUndefined();
  });

  it('throws ZodError when the subject violates the ledger contract (missing snapshot)', () => {
    expect(() =>
      ledgerEntryRecorded(
        makeUow({ tenantId: 't1', streamType: 'actual', lastEventSequence: 42 }) as Parameters<typeof ledgerEntryRecorded>[0],
      ),
    ).toThrow(z.ZodError);
  });
});
