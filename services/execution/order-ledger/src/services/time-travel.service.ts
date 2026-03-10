import { type PortfolioState, INITIAL_PORTFOLIO_STATE, replayEvents, type LedgerEntry } from '@nestfolio/command-core';
import { LedgerRepository } from '../repositories/ledger.repository';
import { portfolioReducer } from '../reducers/portfolio.reducer';

export class TimeTravelService {
  constructor(private readonly repository: LedgerRepository) {}

  async getPortfolioAt(
    tenantId: string,
    streamType: 'actual' | 'simulated',
    targetTimestamp: string,
  ): Promise<PortfolioState> {
    // 1. Find the most recent checkpoint BEFORE targetTimestamp
    const targetDate = targetTimestamp.slice(0, 10);
    const checkpoint = await this.repository.getCheckpointBefore(
      tenantId,
      streamType,
      targetDate,
    );

    const baseState: PortfolioState = checkpoint
      ? {
          positions: (checkpoint['positions'] as PortfolioState['positions']) ?? {},
          cashBalanceCents: (checkpoint['cashBalanceCents'] as number) ?? INITIAL_PORTFOLIO_STATE.cashBalanceCents,
          lastEventSequence: 0,
        }
      : INITIAL_PORTFOLIO_STATE;

    const sinceTimestamp = checkpoint?.['snapshotAt'] as string ?? '1970-01-01T00:00:00.000Z';

    // 2. Query LedgerEntries between checkpoint and target timestamp
    const entries = await this.repository.queryEntriesBetween(
      tenantId,
      streamType,
      sinceTimestamp,
      targetTimestamp,
    );

    if (entries.length === 0) return baseState;

    // 3. Map to LedgerEntry shape and replay
    const ledgerEntries: LedgerEntry[] = entries.map((e) => ({
      eventId: e['eventId'] as string,
      eventType: e['eventType'] as string,
      payload: e['payload'] as Record<string, unknown>,
      timestamp: e['timestamp'] as string,
      sequenceNo: e['sequenceNo'] as number,
    }));

    return replayEvents(baseState, ledgerEntries, portfolioReducer);
  }
}
