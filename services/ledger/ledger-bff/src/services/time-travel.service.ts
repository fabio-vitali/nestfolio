import { PortfolioRepository } from '../repositories/portfolio.repository';

const DEFAULT_CASH_BALANCE_CENTS = 10_000_000;

export class TimeTravelService {
  constructor(private readonly repository: PortfolioRepository) {}

  async getPortfolioAt(
    tenantId: string,
    targetTimestamp: string,
  ): Promise<{ positions: Record<string, unknown>; cashBalanceCents: number; lastEventSequence: number }> {
    const snapshot = await this.repository.getSnapshotAt(tenantId, targetTimestamp);
    if (!snapshot) {
      return { positions: {}, cashBalanceCents: DEFAULT_CASH_BALANCE_CENTS, lastEventSequence: 0 };
    }
    return {
      positions: (snapshot['positions'] as Record<string, unknown>) ?? {},
      cashBalanceCents: (snapshot['cashBalanceCents'] as number) ?? DEFAULT_CASH_BALANCE_CENTS,
      lastEventSequence: (snapshot['lastEventSequence'] as number) ?? 0,
    };
  }
}
