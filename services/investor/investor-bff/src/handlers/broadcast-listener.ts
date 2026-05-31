import { broadcastFromQueue } from '@nestfolio/event-processor';
import { InvestorBffEventTypes } from '../domain/events';

const UPDATE_FEATURE_FLAG = `
  mutation UpdateFeatureFlag($name: String!, $enabled: Boolean!, $reason: String) {
    updateFeatureFlag(name: $name, enabled: $enabled, reason: $reason) {
      name
      enabled
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
  },
});
