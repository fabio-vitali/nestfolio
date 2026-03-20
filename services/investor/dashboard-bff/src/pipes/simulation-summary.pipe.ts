import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/event-processor';
import { INITIAL_ACCOUNT_STATE } from '@nestfolio/ledger-core';
import { DashboardRepository } from '../repositories/dashboard.repository';

const INITIAL_CAPITAL_CENTS = INITIAL_ACCOUNT_STATE.cashBalanceCents;

export class SimulationSummaryPipe
  implements Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>>
{
  constructor(private readonly repository: DashboardRepository) {}

  async process(uow: UnitOfWork<BusEvent<Record<string, unknown>>>): Promise<void> {
    const { event } = uow;
    const tenantId = (event.context as Record<string, string>).tenantId;
    const payload = event.subject as Record<string, unknown>;
    const streamType = (payload.streamType as string) ?? 'actual';

    const totalValueCents = payload.totalValueCents as number | undefined;
    const cashBalanceCents = payload.cashBalanceCents as number | undefined;
    const positionCount = payload.positionCount as number | undefined;

    if (totalValueCents === undefined) {
      logger.info('No totalValueCents in snapshot, skipping simulation summary', { tenantId, streamType });
      return;
    }

    // Store per-stream snapshot
    await this.repository.upsertStreamSnapshot(tenantId, streamType, {
      totalValueCents,
      cashBalanceCents: cashBalanceCents ?? 0,
      positionCount: positionCount ?? 0,
    });

    // Read both streams to compute comparison
    const [actual, simulated] = await Promise.all([
      this.repository.getStreamSnapshot(tenantId, 'actual'),
      this.repository.getStreamSnapshot(tenantId, 'simulated'),
    ]);

    if (!actual || !simulated) {
      logger.info('Missing stream snapshot for comparison', {
        tenantId,
        hasActual: !!actual,
        hasSimulated: !!simulated,
      });
      return;
    }

    const actualTotal = actual['totalValueCents'] as number;
    const simulatedTotal = simulated['totalValueCents'] as number;
    const actualReturn = ((actualTotal - INITIAL_CAPITAL_CENTS) / INITIAL_CAPITAL_CENTS) * 100;
    const simulatedReturn = ((simulatedTotal - INITIAL_CAPITAL_CENTS) / INITIAL_CAPITAL_CENTS) * 100;

    await this.repository.upsertSimulationSummary(tenantId, {
      actualTotalValueCents: actualTotal,
      simulatedTotalValueCents: simulatedTotal,
      actualReturnPercent: Math.round(actualReturn * 100) / 100,
      simulatedReturnPercent: Math.round(simulatedReturn * 100) / 100,
      returnDifferencePercent: Math.round((simulatedReturn - actualReturn) * 100) / 100,
    });

    logger.info('Updated simulation summary projection', {
      tenantId,
      streamType,
      eventType: event.type,
    });
  }
}
