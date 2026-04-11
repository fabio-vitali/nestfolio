import {
  EventBridgeClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import { InvestorBffEventTypes } from '../../../../services/investor/investor-bff/src/domain/events';
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
