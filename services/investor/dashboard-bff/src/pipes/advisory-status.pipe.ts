import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/event-processor';
import { DashboardRepository } from '../repositories/dashboard.repository';

export class AdvisoryStatusPipe implements Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>> {
  constructor(private readonly repository: DashboardRepository) {}

  async process(uow: UnitOfWork<BusEvent<Record<string, unknown>>>): Promise<void> {
    const { event } = uow;
    const tenantId = (event.context as Record<string, string>).tenantId;
    let processed = true;

    switch (event.type) {
      case 'DECISION_PACKET_CREATED':
      case 'USER_CONFIRMATION_REQUESTED':
        processed = await this.repository.guardedUpsertAdvisoryStatus(
          tenantId, event.id, 'advisoryStatus',
          { pendingDecisionsDelta: 1, lastRecommendationAt: event.timestamp },
        );
        break;

      case 'DECISION_APPROVED':
        processed = await this.repository.guardedUpsertAdvisoryStatus(
          tenantId, event.id, 'advisoryStatus',
          { pendingDecisionsDelta: -1, lastDecisionStatus: 'APPROVED' },
        );
        break;

      case 'DECISION_BLOCKED':
        processed = await this.repository.guardedUpsertAdvisoryStatus(
          tenantId, event.id, 'advisoryStatus',
          { pendingDecisionsDelta: -1, lastDecisionStatus: 'BLOCKED' },
        );
        break;

      default:
        break;
    }

    if (!processed) {
      logger.info('Advisory status already updated for this event, skipping', { eventId: event.id });
      return;
    }

    logger.info('Updated advisory status projection', {
      tenantId,
      eventType: event.type,
    });
  }
}
