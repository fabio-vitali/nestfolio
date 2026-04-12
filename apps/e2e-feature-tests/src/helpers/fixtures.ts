import {
  EventBridgeClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import { InvestorBffEventTypes } from '../../../../services/investor/investor-bff/src/domain/events';
import { AdvisoryCtrlEventTypes } from '../../../../services/advisory/advisory-ctrl/src/domain/events';
import { InvestorCtrlEventTypes } from '../../../../services/investor/investor-ctrl/src/domain/events';
import type { FreshTenant } from './fresh-tenant';

/**
 * A Fixture is an async function that publishes whatever events are needed
 * to bring a fresh tenant to a specific observable precondition.
 */
export type Fixture = (
  ctx: IntegrationContext,
  tenant: FreshTenant,
  eb: EventBridgeClient,
) => Promise<FixtureResult>;

export interface FixtureResult {
  // Populated by fixtures that return identifiers (decisionId, depositId, etc.)
  [key: string]: unknown;
}

export async function applyFixtures(
  ctx: IntegrationContext,
  tenant: FreshTenant,
  fixtures: Fixture[],
): Promise<FixtureResult> {
  const eb = new EventBridgeClient(ctx);
  const merged: FixtureResult = {};
  for (const fixture of fixtures) {
    const result = await fixture(ctx, tenant, eb);
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
  return async (_ctx, tenant, eb) => {
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
  return async (_ctx, tenant, eb) => {
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: 'BALANCE_UPDATED',
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        cashBalanceCents: opts.cashBalanceCents,
      },
    });
    return {};
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
  return async (_ctx, tenant, eb) => {
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
  return async (_ctx, tenant, eb) => {
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
  holdings: Array<{ symbol: string; quantity: number; fillPriceCents: number }>,
): Fixture {
  return async (_ctx, tenant, eb) => {
    for (const h of holdings) {
      await eb.putEvent({
        bus: 'execution',
        targetService: 'ledger-ctrl',
        detailType: 'ORDER_FILLED',
        detail: {
          tenantId: tenant.tenantId,
          userId: tenant.userId,
          orderId: `e2e-order-${h.symbol}-${Date.now()}`,
          symbol: h.symbol,
          quantity: h.quantity,
          fillPriceCents: h.fillPriceCents,
          side: 'BUY',
        },
      });
    }
    return {};
  };
}
