import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/event-processor';
import { AdvisoryRepository } from '../repositories/advisory.repository';

type DecisionPacketCreatedPayload = {
  tenantId: string;
  decisionId: string;
  trigger: string;
  proposedTrades: unknown[];
  explanation: string;
  confirmationRequired: boolean;
};

export class DecisionPacketCreatedPipe
  implements Pipe<UnitOfWork<BusEvent<DecisionPacketCreatedPayload>>>
{
  constructor(private readonly repository: AdvisoryRepository) {}

  async process(
    uow: UnitOfWork<BusEvent<DecisionPacketCreatedPayload>>,
  ): Promise<void> {
    const { event } = uow;
    const payload = event.subject;

    const created = await this.repository.storeDecision(payload.tenantId, payload.decisionId, {
      trigger: payload.trigger,
      proposedTrades: payload.proposedTrades,
      explanation: payload.explanation,
      confirmationRequired: payload.confirmationRequired,
      complianceChecks: [],
      agentInvocations: [],
      sourceEventId: event.id,
    });

    if (!created) {
      logger.info('Decision already stored, skipping', { eventId: event.id, decisionId: payload.decisionId });
      return;
    }

    logger.info('Stored decision read model', {
      tenantId: payload.tenantId,
      decisionId: payload.decisionId,
    });
  }
}
