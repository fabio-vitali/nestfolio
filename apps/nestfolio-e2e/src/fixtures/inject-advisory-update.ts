import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';
import type { TestContext } from '@nestfolio/test-support';
import type { FreshTenant } from '@nestfolio/e2e-feature-tests';

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
 *
 * @deprecated This function mutates dashboard-bff state directly without
 * firing any real event — which means advisory-bff falls out of sync.
 * Use `injectAdvisoryTriggerEvent` for new tests that need to start the
 * decision pipeline end-to-end.
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
  const json = (await response.json()) as {
    data?: { publishDashboardUpdate?: unknown };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(`injectAdvisoryUpdate GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
}

/**
 * Emit a real DEPOSIT_DETECTED event on the investor EventBridge bus so that
 * the full advisory pipeline fires: advisory-adpt forwards the event to the
 * advisory bus, decision-workflow-ctrl starts the SF orchestration, the agent
 * pipeline runs, and both advisory-bff and dashboard-bff project the in-flight
 * and completed states via CDC.
 *
 * This replaces the legacy backdoor (`injectAdvisoryUpdate`) that mutated
 * dashboard-bff state directly without firing any event — causing advisory-bff
 * to fall out of sync and making the "generating" banner untestable.
 *
 * Source is `integration-test:nestfolio-e2e` so advisory-adpt's `$or` Ingress
 * filter (non-integration-test OR integration-test:<consumer>) passes it
 * through. The `detailType` DEPOSIT_DETECTED is the production trigger that
 * starts the decision workflow via investor-adpt → advisory bus.
 */
export async function injectAdvisoryTriggerEvent(
  ctx: TestContext,
  tenant: FreshTenant,
): Promise<void> {
  const busArn = await ctx.ssm.busArn('investor');
  const eb = new EventBridgeClient({ region: ctx.region });
  const eventId = `e2e-${randomUUID()}`;
  const now = new Date().toISOString();

  const result = await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: busArn,
          Source: `integration-test:nestfolio-e2e`,
          DetailType: 'DEPOSIT_DETECTED',
          Detail: JSON.stringify({
            id: eventId,
            type: 'DEPOSIT_DETECTED',
            timestamp: now,
            subject: {
              tenantId: tenant.tenantId,
              amountCents: 100_000,
            },
            context: {
              tenantId: tenant.tenantId,
              userId: tenant.userId,
              region: ctx.region,
            },
          }),
        },
      ],
    }),
  );

  if ((result.FailedEntryCount ?? 0) > 0) {
    throw new Error(
      `injectAdvisoryTriggerEvent: PutEvents failed — ${result.Entries?.[0]?.ErrorMessage ?? 'unknown'}`,
    );
  }
}
