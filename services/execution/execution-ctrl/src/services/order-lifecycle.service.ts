import { logger, type BusEvent } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import type { ProposedTrade } from '@nestfolio/domain-core';
import { OrderRepository } from '../repositories/order.repository';
import { SafetyChecksService } from './safety-checks.service';
import { MarketHoursService } from './market-hours.service';

export class OrderLifecycleService {
  private readonly log = withMethodLogging('OrderLifecycleService');

  constructor(
    private readonly repository: OrderRepository,
    private readonly safetyChecks: SafetyChecksService,
    private readonly marketHours: MarketHoursService,
  ) {}

  readonly processApprovedDecision = this.log('processApprovedDecision',
    async (event: BusEvent): Promise<void> => {
      const { tenantId, decisionPacketId, proposedTrades } = this.extractFromEvent(event);
      const orderId = event.id;

      logger.info('Processing approved decision', { tenantId, decisionPacketId, orderId, tradeCount: proposedTrades.length });

      // 1. Create order record (conditional write — returns false if duplicate)
      const created = await this.repository.createOrder(tenantId, orderId, decisionPacketId, proposedTrades, event.id);
      if (!created) {
        logger.info('Duplicate event, order already exists', { orderId, eventId: event.id });
        return;
      }

      // 2. Run safety checks
      const safetyResult = await this.safetyChecks.runAllChecks(tenantId, proposedTrades);
      if (!safetyResult.passed) {
        logger.info('Safety checks failed, rejecting order', { orderId, reason: safetyResult.reason });
        await this.repository.updateOrderStatus(tenantId, orderId, 'REJECTED', { reason: safetyResult.reason });
        return;
      }

      // 3. Check market hours
      if (await this.marketHours.isMarketOpen()) {
        // Submit immediately
        logger.info('Market open, submitting order', { orderId });
        await this.repository.updateOrderStatus(tenantId, orderId, 'SUBMITTED');
      } else {
        // Stage for later
        logger.info('Market closed, staging order', { orderId });
        await this.repository.createStagedOrder(tenantId, orderId, { proposedTrades });
        await this.repository.updateOrderStatus(tenantId, orderId, 'STAGED');
      }
    },
  );

  private extractFromEvent(event: BusEvent): {
    tenantId: string;
    decisionPacketId: string;
    proposedTrades: ProposedTrade[];
  } {
    const context = (event.context ?? {}) as Record<string, unknown>;
    const subject = (event.subject ?? {}) as Record<string, unknown>;

    const tenantId =
      (context['tenantId'] as string) ??
      (subject['tenantId'] as string) ??
      'unknown';

    const decisionPacketId =
      (subject['decisionPacketId'] as string) ??
      (subject['decisionId'] as string) ??
      (context['decisionPacketId'] as string) ??
      'unknown';

    const proposedTrades =
      (subject['proposedTrades'] as ProposedTrade[]) ??
      [];

    return { tenantId, decisionPacketId, proposedTrades };
  }
}
