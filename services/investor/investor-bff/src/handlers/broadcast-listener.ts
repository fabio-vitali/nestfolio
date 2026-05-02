import { broadcastFromQueue, type EventPayload } from '@nestfolio/event-processor';
import { InvestorBffEventTypes } from '../domain/events';
import { InvestorIngestEventTypes } from '@nestfolio/investor-adpt/domain';

const UPDATE_FEATURE_FLAG = `
  mutation UpdateFeatureFlag($name: String!, $enabled: Boolean!, $reason: String) {
    updateFeatureFlag(name: $name, enabled: $enabled, reason: $reason) {
      name
      enabled
      reason
    }
  }
`;

const PUBLISH_DEPOSIT_EVENT = `
  mutation PublishDepositEvent($input: DepositEventInput!) {
    publishDepositEvent(input: $input) {
      depositId
      tenantId
      status
      amountCents
      currency
      occurredAt
      reason
    }
  }
`;

const GATED_FLAGS = ['confirmDecision', 'initiateDeposit', 'requestWithdrawal'] as const;

const APPSYNC_URL = process.env['APPSYNC_URL'];
if (!APPSYNC_URL) {
  throw new Error('broadcast-listener: APPSYNC_URL is required');
}

export const handler = broadcastFromQueue({
  serviceName: 'investor-bff',
  appsyncUrl: APPSYNC_URL,
  region: process.env['AWS_REGION'],
  broadcasts: {
    [InvestorBffEventTypes.BROKER_CIRCUIT_OPEN]: {
      mutation: UPDATE_FEATURE_FLAG,
      mapPayload: () =>
        GATED_FLAGS.map((name) => ({
          name,
          enabled: false,
          reason: 'Broker connectivity issue',
        })),
    },
    [InvestorBffEventTypes.BROKER_CIRCUIT_CLOSED]: {
      mutation: UPDATE_FEATURE_FLAG,
      mapPayload: () =>
        GATED_FLAGS.map((name) => ({
          name,
          enabled: true,
        })),
    },
    [InvestorIngestEventTypes.DEPOSIT_DETECTED]: {
      mutation: PUBLISH_DEPOSIT_EVENT,
      mapPayload: (payload: EventPayload) => {
        const subject = payload.subject as {
          tenantId: string;
          userId: string;
          depositId: string;
          amountCents: number;
          currency: string;
        };
        const occurredAt =
          (payload as { occurredAt?: string }).occurredAt ??
          payload.timestamp ??
          new Date().toISOString();
        return {
          input: {
            depositId: subject.depositId,
            tenantId: subject.tenantId,
            userId: subject.userId,
            status: 'DETECTED',
            amountCents: subject.amountCents,
            currency: subject.currency,
            occurredAt,
            reason: null,
          },
        };
      },
    },
  },
});
