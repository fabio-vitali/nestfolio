import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { AdvisoryRepository } from '../repositories/advisory.repository';

type DecisionStatusPayload = {
  tenantId: string;
  decisionId: string;
  [key: string]: unknown;
};

const EVENT_TO_STATUS: Record<string, string> = {
  DECISION_PACKET_ENRICHED: 'COMPLIANCE_REVIEW',
  DECISION_APPROVED: 'APPROVED',
  DECISION_BLOCKED: 'BLOCKED',
  USER_CONFIRMATION_REQUESTED: 'AWAITING_CONFIRMATION',
};

export class DecisionStatusChangedPipe
  implements Pipe<UnitOfWork<BusEvent<DecisionStatusPayload>>>
{
  constructor(private readonly repository: AdvisoryRepository) {}

  async process(
    uow: UnitOfWork<BusEvent<DecisionStatusPayload>>,
  ): Promise<void> {
    const { event } = uow;
    const payload = event.subject;
    const newStatus = EVENT_TO_STATUS[event.type];

    if (!newStatus) {
      logger.warn('No status mapping for event type', { eventType: event.type });
      return;
    }

    await this.repository.updateDecisionStatus(
      payload.tenantId,
      payload.decisionId,
      newStatus,
    );

    logger.info('Updated decision status', {
      tenantId: payload.tenantId,
      decisionId: payload.decisionId,
      status: newStatus,
    });
  }
}
