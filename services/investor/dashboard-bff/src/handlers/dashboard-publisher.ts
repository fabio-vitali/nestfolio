import type { DynamoDBStreamHandler } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/event-processor';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

// `tenantId` MUST be in the selection set: AppSync's @aws_subscribe filter
// matches the subscription's `tenantId` argument against fields in the mutation
// RESPONSE (not input args). Without selecting tenantId, the filter never
// matches and the broadcast silently drops on the server side.
const PUBLISH_DASHBOARD_UPDATE = `
  mutation PublishDashboardUpdate($tenantId: ID!, $advisoryStatus: AdvisoryStatusInput) {
    publishDashboardUpdate(tenantId: $tenantId, advisoryStatus: $advisoryStatus) {
      tenantId
      advisoryStatus {
        pendingDecisionsCount
        lastRecommendationAt
        lastDecisionStatus
        updatedAt
      }
    }
  }
`;

async function callAppSyncMutation(mutation: string, variables: Record<string, unknown>): Promise<void> {
  const appsyncUrl = process.env.APPSYNC_URL;
  const region = process.env.AWS_REGION ?? 'us-east-1';
  if (!appsyncUrl) {
    logger.warn('APPSYNC_URL not set — skipping publishDashboardUpdate');
    return;
  }
  const url = new URL(appsyncUrl);
  const body = JSON.stringify({ query: mutation, variables });
  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region,
    service: 'appsync',
    sha256: Sha256,
  });
  const signed = await signer.sign({
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname,
    protocol: url.protocol,
    headers: { 'Content-Type': 'application/json', host: url.hostname },
    body,
  });
  const response = await fetch(appsyncUrl, {
    method: 'POST',
    headers: signed.headers as Record<string, string>,
    body,
  });
  if (!response.ok) {
    logger.error('publishDashboardUpdate HTTP failure', { status: response.status });
    return;
  }
  const json = await response.json() as { errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    logger.error('publishDashboardUpdate GraphQL errors', { errors: json.errors });
  }
}

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const record of event.Records) {
    if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') continue;
    const image = record.dynamodb?.NewImage as Record<string, AttributeValue> | undefined;
    if (!image) continue;
    const item = unmarshall(image);
    if (item.sk !== 'AdvisoryStatus') continue;
    const pk = String(item.pk ?? '');
    if (!pk.startsWith('T#')) continue;
    const tenantId = pk.slice(2);

    await callAppSyncMutation(PUBLISH_DASHBOARD_UPDATE, {
      tenantId,
      advisoryStatus: {
        pendingDecisionsCount: Number(item.pendingDecisionsCount ?? 0),
        lastRecommendationAt: item.lastRecommendationAt ?? null,
        lastDecisionStatus: item.lastDecisionStatus ?? null,
        updatedAt: String(item.updatedAt ?? new Date().toISOString()),
      },
    });
  }
};
