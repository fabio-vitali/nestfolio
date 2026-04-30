import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import type { TestContext } from '@nestfolio/test-support';

const PUBLISH_DASHBOARD_UPDATE = `
  mutation PublishDashboardUpdate($tenantId: ID!, $advisoryStatus: AdvisoryStatusInput) {
    publishDashboardUpdate(tenantId: $tenantId, advisoryStatus: $advisoryStatus) {
      tenantId
      advisoryStatus { pendingDecisionsCount lastRecommendationAt lastDecisionStatus updatedAt }
    }
  }
`;

/**
 * Fire `publishDashboardUpdate` against dashboard-bff's AppSync API as an
 * IAM-signed mutation, exactly like `dashboard-publisher.ts` does in
 * production. Used by the journey to verify the WSS live-update path:
 * a value the pipeline never produces (current + sentinel offset) lets the
 * subscriber assert the broadcast was delivered without ambiguity.
 */
export async function injectAdvisoryUpdate(
  ctx: TestContext,
  tenantId: string,
  pendingDecisionsCount: number,
): Promise<void> {
  const appsyncUrl = await ctx.ssm.graphqlUrl('dashboard-bff');
  const url = new URL(appsyncUrl);
  const body = JSON.stringify({
    query: PUBLISH_DASHBOARD_UPDATE,
    variables: {
      tenantId,
      advisoryStatus: {
        pendingDecisionsCount,
        lastRecommendationAt: null,
        lastDecisionStatus: 'E2E_SENTINEL',
        updatedAt: new Date().toISOString(),
      },
    },
  });
  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region: ctx.region,
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
    throw new Error(`injectAdvisoryUpdate HTTP ${response.status}: ${await response.text()}`);
  }
  const json = (await response.json()) as { errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`injectAdvisoryUpdate GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
}
