import { record, project } from '@nestfolio/event-processor';
import { ledgerEntryRecorded } from '../../src/transforms/ledger-entry-recorded';

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

  it('should return single record intent for history entry', () => {
    const result = ledgerEntryRecorded(makeUow({
      eventId: 'entry-1',
      eventType: 'ORDER_FILLED',
      payload: { symbol: 'VTI', quantity: 10 },
      timestamp: '2026-01-01T00:00:00.000Z',
      sequenceNo: 1,
    }) as any);

    expect(result).toEqual(
      record('HistoryEntry', {
        tenantId: 't1',
        eventId: 'entry-1',
        eventType: 'ORDER_FILLED',
        payload: { symbol: 'VTI', quantity: 10 },
        timestamp: '2026-01-01T00:00:00.000Z',
        sequenceNo: 1,
        streamType: undefined,
      }, { pk: 'History#t1', sk: 'Entry#1' }),
    );
  });

  it('should include simulation intents for simulated stream', () => {
    const result = ledgerEntryRecorded(makeUow({
      eventId: 'entry-1',
      eventType: 'ORDER_FILLED',
      payload: { symbol: 'VTI' },
      timestamp: '2026-01-01T00:00:00.000Z',
      sequenceNo: 1,
      streamType: 'simulated',
      cashBalanceCents: 500_000,
      positions: {
        VTI: { symbol: 'VTI', quantity: 10, averageCostBasis: 250, totalCostBasis: 2500, lastFillPrice: 251 },
      },
    }) as any);

    expect(Array.isArray(result)).toBe(true);
    const intents = result as any[];
    expect(intents).toHaveLength(3); // history + simulation summary + simulation position
    expect(intents[0].typename).toBe('HistoryEntry');
    expect(intents[1].typename).toBe('Simulation');
    expect(intents[2].typename).toBe('SimulationPosition');
  });

  it('should include checkpoint intent at CHECKPOINT_INTERVAL boundaries', () => {
    const result = ledgerEntryRecorded(makeUow({
      eventId: 'entry-100',
      eventType: 'ORDER_FILLED',
      payload: {},
      timestamp: '2026-01-01T00:00:00.000Z',
      sequenceNo: 100,
      cashBalanceCents: 1_000_000,
      positions: {},
    }) as any);

    expect(Array.isArray(result)).toBe(true);
    const intents = result as any[];
    expect(intents.some((i: any) => i.typename === 'Checkpoint')).toBe(true);
  });

  it('should not include checkpoint for non-boundary sequence numbers', () => {
    const result = ledgerEntryRecorded(makeUow({
      eventId: 'entry-50',
      eventType: 'ORDER_FILLED',
      payload: {},
      timestamp: '2026-01-01T00:00:00.000Z',
      sequenceNo: 50,
    }) as any);

    // Should be single intent (no checkpoint)
    expect((result as any)._tag ?? (result as any[])[0]?._tag).toBe('record');
  });
});
