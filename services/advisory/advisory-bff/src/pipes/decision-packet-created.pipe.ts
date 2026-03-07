import Highland from 'highland';
import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { IdempotencyGuard } from '@nestfolio/lambda-utils';
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
  implements Pipe<UnitOfWork<BusEvent<DecisionPacketCreatedPayload>>, void>
{
  constructor(
    private readonly repository: AdvisoryRepository,
    private readonly idempotencyGuard: IdempotencyGuard,
  ) {}

  feed(
    source: Highland.Stream<UnitOfWork<BusEvent<DecisionPacketCreatedPayload>>>,
  ): Highland.Stream<void> {
    return source.flatMap((uow) =>
      Highland(
        (async () => {
          const { event } = uow;
          const payload = event.subject;

          const isNew = await this.idempotencyGuard.ensureOnce(event.type, event.id);
          if (!isNew) {
            logger.info('Skipping duplicate DECISION_PACKET_CREATED event', {
              eventId: event.id,
            });
            return;
          }

          await this.repository.storeDecision(payload.tenantId, payload.decisionId, {
            trigger: payload.trigger,
            proposedTrades: payload.proposedTrades,
            explanation: payload.explanation,
            confirmationRequired: payload.confirmationRequired,
            complianceChecks: [],
            agentInvocations: [],
          });

          logger.info('Stored decision read model', {
            tenantId: payload.tenantId,
            decisionId: payload.decisionId,
          });
        })(),
      ),
    );
  }
}
