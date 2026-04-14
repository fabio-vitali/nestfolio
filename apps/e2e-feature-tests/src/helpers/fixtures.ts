import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';
import { InvestorCtrlEventTypes } from '@nestfolio/investor-ctrl/events';
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';
import { BrokerCtrlEventTypes } from '@nestfolio/broker-ctrl/events';
import type { FreshTenant } from './fresh-tenant';
import { bffClient, type BffClients } from './bff-client';
import { waitForGraphQL } from './wait-for-graphql';

/**
 * A Fixture is an async function that publishes whatever events are needed
 * to bring a fresh tenant to a specific observable precondition.
 * Fixtures receive BffClients so they can poll GraphQL to confirm
 * that prerequisite events have been materialized before proceeding.
 */
export type Fixture = (
  ctx: TestContext,
  tenant: FreshTenant,
  eb: EventBridgeClient,
  bff: BffClients,
) => Promise<FixtureResult>;

export interface FixtureResult {
  // Populated by fixtures that return identifiers (decisionId, depositId, etc.)
  [key: string]: unknown;
}

export async function applyFixtures(
  ctx: TestContext,
  tenant: FreshTenant,
  fixtures: Fixture[],
): Promise<FixtureResult> {
  const eb = new EventBridgeClient(ctx);
  const bff = bffClient(ctx, tenant);
  const merged: FixtureResult = {};
  for (const fixture of fixtures) {
    const result = await fixture(ctx, tenant, eb, bff);
    Object.assign(merged, result);
  }
  return merged;
}

/**
 * Seeds the minimum viable onboarded state:
 *   1. USER_REGISTERED  — materializes InvestorProfile (required by ONBOARDING_COMPLETED's ConditionExpression)
 *   2. ONBOARDING_COMPLETED — materializes Goal, RiskProfile, Mandate, OperatingMode, AccountMode, Deposit
 *
 * Matches the seeding chain used by services/investor/investor-bff/test/integration/.
 */
export function onboarded(overrides?: {
  operatingMode?: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  capitalAmount?: number;
  currency?: string;
}): Fixture {
  return async (_ctx, tenant, eb, bff) => {
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: InvestorBffEventTypes.USER_REGISTERED,
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        email: `${tenant.userId}@integ-e2e.example`,
      },
    });
    // ONBOARDING_COMPLETED's transactWrite has ConditionExpression: attribute_exists(pk)
    // on the InvestorProfile row created by USER_REGISTERED. Poll getProfile to confirm
    // the profile is materialized before publishing ONBOARDING_COMPLETED — avoids a
    // race where ONBOARDING_COMPLETED is processed first, fails, and retries after the
    // 180 s SQS visibility timeout.
    await waitForGraphQL<{ getProfile: { tenantId: string } }>(
      bff.investor,
      `query { getProfile { tenantId } }`,
      {},
      (r) => !!r.getProfile?.tenantId,
      { timeoutMs: 60_000 },
    );
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: InvestorBffEventTypes.ONBOARDING_COMPLETED,
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        goal: { objective: 'GROWTH' },
        horizonYears: 10,
        accountMode: 'simulation',
        capitalAmount: overrides?.capitalAmount ?? 100_000,
        currency: overrides?.currency ?? 'USD',
        riskTolerance: 7,
        riskExperience: 5,
        operatingMode: overrides?.operatingMode ?? 'BALANCED',
        mandateAccepted: true,
      },
    });
    return {};
  };
}

/**
 * Seeds cash balance by publishing BALANCE_UPDATED. That event materializes
 * the CashBalance row at pk=InvestorProfile#{tenantId}#{userId}, which
 * requestWithdrawal's ConditionExpression depends on.
 */
export function funded(opts: { cashBalanceCents: number }): Fixture {
  return async (ctx, tenant, eb, _bff) => {
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: LedgerCtrlEventTypes.BALANCE_UPDATED,
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        cashBalanceCents: opts.cashBalanceCents,
      },
    });

    // Poll for CashBalance materialization. The investor-bff event-listener
    // projects BALANCE_UPDATED into a CashBalance DDB row that downstream
    // mutations (e.g. requestWithdrawal) depend on via ConditionExpression.
    const tableName = await ctx.ssm.tableName('investor-bff');
    const ddbClient = new DynamoDBClient({ region: ctx.region });
    const ddbDoc = DynamoDBDocumentClient.from(ddbClient);
    try {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const result = await ddbDoc.send(new GetCommand({
          TableName: tableName,
          Key: {
            pk: `InvestorProfile#${tenant.tenantId}#${tenant.userId}`,
            sk: 'CashBalance',
          },
        }));
        if (result.Item) return {};
        await new Promise(r => setTimeout(r, 2_000));
      }
      throw new Error('funded(): CashBalance not materialized within 60s');
    } finally {
      ddbClient.destroy();
    }
  };
}

/**
 * Seeds a PENDING decision read-model on advisory-bff by publishing a
 * synthetic DECISION_PACKET_CREATED. Returns the generated decisionId so
 * scenarios can reference it in confirmDecision/rejectDecision mutations.
 */
export function withDecision(opts: {
  trigger: 'INITIAL_ALLOCATION' | 'REBALANCE' | 'ADJUSTMENT';
  proposedTrades?: Array<{ symbol: string; side: 'BUY' | 'SELL'; quantityOrAmountCents: number }>;
  explanation?: string;
}): Fixture {
  return async (_ctx, tenant, eb, _bff) => {
    const decisionId = `e2e-decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'advisory-bff',
      detailType: AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED,
      detail: {
        tenantId: tenant.tenantId,
        decisionId,
        trigger: opts.trigger,
        proposedTrades: opts.proposedTrades ?? [
          { symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 500_000 },
        ],
        explanation: opts.explanation ?? 'E2E test synthetic decision',
        confirmationRequired: true,
      },
    });
    return { decisionId };
  };
}

/**
 * Seeds a CREATED notification on investor-bff by publishing a synthetic
 * NOTIFICATION_CREATED. Returns the generated notificationId.
 */
export function withNotification(opts: {
  title: string;
  body: string;
  channel?: 'IN_APP' | 'EMAIL' | 'PUSH' | 'SMS';
  relatedEntityType?: string;
  relatedEntityId?: string;
}): Fixture {
  return async (_ctx, tenant, eb, _bff) => {
    const notificationId = `e2e-notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: InvestorCtrlEventTypes.NOTIFICATION_CREATED,
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        notificationId,
        channel: opts.channel ?? 'IN_APP',
        title: opts.title,
        body: opts.body,
        relatedEntityType: opts.relatedEntityType ?? 'System',
        relatedEntityId: opts.relatedEntityId ?? 'system',
      },
    });
    return { notificationId };
  };
}

/**
 * Seeds portfolio holdings by publishing one synthetic ORDER_FILLED per
 * holding on the execution bus. The ledger-ctrl reducer projects these
 * into the ledger-bff read model (Portfolio / Positions).
 */
export function withHoldings(
  holdings: Array<{ symbol: string; quantity: number; fillPrice: number }>,
): Fixture {
  return async (_ctx, tenant, eb, _bff) => {
    for (const h of holdings) {
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-ctrl',
        detailType: BrokerCtrlEventTypes.ORDER_FILLED,
        detail: {
          tenantId: tenant.tenantId,
          userId: tenant.userId,
          orderId: `e2e-order-${h.symbol}-${Date.now()}`,
          symbol: h.symbol,
          quantity: h.quantity,
          fillPrice: h.fillPrice,
          filledAt: new Date().toISOString(),
          side: 'BUY',
        },
      });
    }
    return {};
  };
}
