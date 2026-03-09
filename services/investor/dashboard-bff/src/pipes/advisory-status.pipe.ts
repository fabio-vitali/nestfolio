import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { DashboardRepository } from '../repositories/dashboard.repository';

export class AdvisoryStatusPipe implements Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>> {
  constructor(private readonly repository: DashboardRepository) {}

  async process(uow: UnitOfWork<BusEvent<Record<string, unknown>>>): Promise<void> {
    const { event } = uow;
    const tenantId = (event.context as Record<string, string>).tenantId;

    switch (event.type) {
      case 'DECISION_PACKET_CREATED':
      case 'USER_CONFIRMATION_REQUESTED':
        await this.repository.upsertAdvisoryStatus(tenantId, {
          pendingDecisionsDelta: 1,
          lastRecommendationAt: event.timestamp,
        });
        break;

      case 'DECISION_APPROVED':
        await this.repository.upsertAdvisoryStatus(tenantId, {
          pendingDecisionsDelta: -1,
          lastDecisionStatus: 'APPROVED',
        });
        break;

      case 'DECISION_BLOCKED':
        await this.repository.upsertAdvisoryStatus(tenantId, {
          pendingDecisionsDelta: -1,
          lastDecisionStatus: 'BLOCKED',
        });
        break;

      default:
        break;
    }

    logger.info('Updated advisory status projection', {
      tenantId,
      eventType: event.type,
    });
  }
}
