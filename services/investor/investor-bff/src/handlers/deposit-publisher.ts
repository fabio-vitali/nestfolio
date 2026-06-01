import { broadcastFromStream } from '@nestfolio/event-processor';

// depositId / withdrawalId MUST be in the mutation selection set: AppSync's
// @aws_subscribe filter matches the subscription's id argument against fields in
// the mutation RESPONSE (not the input args). Without selecting the pivot id, the
// filter never matches and the broadcast silently drops (feedback_appsync_subscribe_filter_args).
const PUBLISH_DEPOSIT_UPDATE = `
  mutation PublishDepositUpdate(
    $depositId: ID!, $status: String!, $amountCents: Int!, $currency: String!,
    $detectedAt: String, $settledAt: String, $failedAt: String, $reason: String
  ) {
    publishDepositUpdate(
      depositId: $depositId, status: $status, amountCents: $amountCents, currency: $currency,
      detectedAt: $detectedAt, settledAt: $settledAt, failedAt: $failedAt, reason: $reason
    ) {
      depositId
      status
      amountCents
      currency
      detectedAt
      settledAt
      failedAt
      reason
    }
  }
`;

const PUBLISH_WITHDRAWAL_UPDATE = `
  mutation PublishWithdrawalUpdate(
    $withdrawalId: ID!, $status: String!, $amountCents: Int!, $currency: String!,
    $settledAt: String, $failedAt: String, $reason: String
  ) {
    publishWithdrawalUpdate(
      withdrawalId: $withdrawalId, status: $status, amountCents: $amountCents, currency: $currency,
      settledAt: $settledAt, failedAt: $failedAt, reason: $reason
    ) {
      withdrawalId
      status
      amountCents
      currency
      settledAt
      failedAt
      reason
    }
  }
`;

const APPSYNC_URL = process.env['APPSYNC_URL'];
if (!APPSYNC_URL) {
  throw new Error('deposit-publisher: APPSYNC_URL is required');
}

export const handler = broadcastFromStream({
  serviceName: 'investor-bff',
  appsyncUrl: APPSYNC_URL,
  region: process.env['AWS_REGION'],
  broadcasts: {
    // Keyed by __typename: the projected P1 rows ('Deposit'/'WithdrawalRequest'),
    // NOT the intent-outbox rows ('DepositIntent'/'WithdrawalIntent') that live in
    // the same table and also stream — those have no entry, so they never fire.
    Deposit: {
      mutation: PUBLISH_DEPOSIT_UPDATE,
      // Only status transitions matter to the pending UI; an idempotent same-status
      // re-projection must not re-broadcast.
      whenChanged: ['status'],
      mapImage: (item) => ({
        depositId: String(item['depositId']),
        status: String(item['status']),
        amountCents: Number(item['amountCents'] ?? 0),
        currency: String(item['currency'] ?? 'USD'),
        detectedAt: item['detectedAt'] != null ? String(item['detectedAt']) : null,
        settledAt: item['settledAt'] != null ? String(item['settledAt']) : null,
        failedAt: item['failedAt'] != null ? String(item['failedAt']) : null,
        reason: item['reason'] != null ? String(item['reason']) : null,
      }),
    },
    WithdrawalRequest: {
      mutation: PUBLISH_WITHDRAWAL_UPDATE,
      whenChanged: ['status'],
      mapImage: (item) => ({
        withdrawalId: String(item['withdrawalId']),
        status: String(item['status']),
        amountCents: Number(item['amountCents'] ?? 0),
        currency: String(item['currency'] ?? 'USD'),
        settledAt: item['settledAt'] != null ? String(item['settledAt']) : null,
        failedAt: item['failedAt'] != null ? String(item['failedAt']) : null,
        reason: item['reason'] != null ? String(item['reason']) : null,
      }),
    },
  },
});
