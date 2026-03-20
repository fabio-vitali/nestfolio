import { replayEvents, type LedgerEntry } from '@nestfolio/command-core';
import { type AccountState, INITIAL_ACCOUNT_STATE, accountReducer } from '@nestfolio/ledger-core';
import { PortfolioRepository } from '../repositories/portfolio.repository';

export class TimeTravelService {
  constructor(private readonly repository: PortfolioRepository) {}

  async getPortfolioAt(
    tenantId: string,
    targetTimestamp: string,
  ): Promise<AccountState> {
    // 1. Find the most recent checkpoint BEFORE targetTimestamp
    const targetDate = targetTimestamp.slice(0, 10);
    const checkpoint = await this.repository.getCheckpointBefore(
      tenantId,
      targetDate,
    );

    const baseState: AccountState = checkpoint
      ? {
          positions: (checkpoint['positions'] as AccountState['positions']) ?? {},
          cashBalanceCents: (checkpoint['cashBalanceCents'] as number) ?? INITIAL_ACCOUNT_STATE.cashBalanceCents,
          lastEventSequence: 0,
        }
      : INITIAL_ACCOUNT_STATE;

    // Determine sequence to start from
    const sinceSeq = checkpoint
      ? ((checkpoint['lastSequence'] as number) ?? 0)
      : 0;

    // 2. Query history entries after checkpoint
    const entries = await this.repository.getEntriesSince(tenantId, sinceSeq);

    // Filter entries up to target timestamp
    const filteredEntries = entries.filter(
      (e) => (e['timestamp'] as string) <= targetTimestamp,
    );

    if (filteredEntries.length === 0) return baseState;

    // 3. Map to LedgerEntry shape and replay
    const ledgerEntries: LedgerEntry[] = filteredEntries.map((e) => ({
      eventId: e['eventId'] as string,
      eventType: e['eventType'] as string,
      payload: e['payload'] as Record<string, unknown>,
      timestamp: e['timestamp'] as string,
      sequenceNo: e['sequenceNo'] as number,
    }));

    return replayEvents(baseState, ledgerEntries, accountReducer);
  }
}
