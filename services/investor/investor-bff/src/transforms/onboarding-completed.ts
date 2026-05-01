import { skip, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { getUUID, getTime, type TableEntry } from '@nestfolio/event-processor';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';
import { computeRiskProfile } from '../domain/risk-profile.service';
import { resolveGuardrailParams } from '../domain/guardrail-params';

interface OnboardingCompletedSubject {
  tenantId: string;
  userId: string;
  email: string;
  goal: { objective: string };
  horizonYears: number;
  accountMode: 'simulation' | 'live';
  capitalAmount: number;
  currency: string;
  riskTolerance: number;
  riskExperience: number;
  operatingMode: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  mandateLevel?: 'ADVISORY' | 'DISCRETIONARY';
  mandateAccepted: true;
}

/**
 * Custom handler -- uses transactWrite for 7 entities atomically.
 * Returns skip() because it handles its own persistence.
 *
 * Item 1 is a `Put` (not `Update + attribute_exists(pk)`): folding `email`
 * into the ONBOARDING_COMPLETED subject lets us materialize a complete
 * InvestorProfile here regardless of whether USER_REGISTERED's projection
 * has already landed. The previous Update + precondition raced against
 * USER_REGISTERED — when ONBOARDING_COMPLETED arrived first, the entire
 * 7-row transaction reverted atomically (ConditionalCheckFailed is
 * non-retryable in event-processor), losing Mandate and stranding the
 * tenant in compliance-ctrl's MANDATE_MISSING fallback. See
 * memory/project_decision_workflow_stuck.md.
 */
export async function onboardingCompleted(
  payload: EventPayload,
  ctx: EventContext,
): Promise<WriteIntent> {
  const s = payload.subject as unknown as OnboardingCompletedSubject;
  const tableName = process.env['TABLE_NAME']!;
  const repo = new InvestorProfileRepository(tableName);
  const now = getTime();
  const pk = `InvestorProfile#${s.tenantId}#${s.userId}`;
  const risk = computeRiskProfile(s.riskTolerance, s.riskExperience);
  const goalId = getUUID();
  const mandateId = getUUID();
  const depositId = getUUID();

  await repo.transactWrite({
    TransactItems: [
      // 1. Put InvestorProfile (atomic upsert — no precondition on USER_REGISTERED)
      {
        Put: {
          TableName: tableName,
          Item: {
            pk, sk: 'InvestorProfile', __typename: 'InvestorProfile',
            tenantId: s.tenantId, userId: s.userId, region: ctx.region,
            email: s.email,
            operatingMode: s.operatingMode,
            onboardingCompletedAt: now,
            createdAt: now, updatedAt: now,
          } satisfies TableEntry,
        },
      },
      // 2. Put Goal
      {
        Put: {
          TableName: tableName,
          Item: {
            pk, sk: `Goal#${goalId}`, __typename: 'Goal',
            tenantId: s.tenantId, userId: s.userId, region: ctx.region, goalId,
            objective: s.goal.objective,
            timeHorizonMonths: s.horizonYears * 12,
            targetAmountCents: 0, currency: s.currency, targetReturn: 0,
            createdAt: now, updatedAt: now,
          } satisfies TableEntry,
        },
      },
      // 3. Put RiskProfile
      {
        Put: {
          TableName: tableName,
          Item: {
            pk, sk: 'RiskProfile', __typename: 'RiskProfile',
            tenantId: s.tenantId, userId: s.userId, region: ctx.region, createdAt: now, profileId: getUUID(),
            score: risk.score, band: risk.band,
            toleranceResponse: risk.tolerance, experienceLevel: risk.experienceLevel,
            assessedAt: now, version: 1,
          } satisfies TableEntry,
        },
      },
      // 4. Put OperatingModeRecord
      {
        Put: {
          TableName: tableName,
          Item: {
            pk, sk: 'OperatingMode', __typename: 'OperatingModeRecord',
            tenantId: s.tenantId, userId: s.userId, region: ctx.region, createdAt: now,
            mode: s.operatingMode, selectedAt: now,
          } satisfies TableEntry,
        },
      },
      // 5. Put AccountMode
      {
        Put: {
          TableName: tableName,
          Item: {
            pk, sk: 'AccountMode', __typename: 'AccountMode',
            tenantId: s.tenantId, userId: s.userId, region: ctx.region,
            mode: s.accountMode, capitalAmount: s.capitalAmount, currency: s.currency,
            createdAt: now, updatedAt: now,
          } satisfies TableEntry,
        },
      },
      // 6. Put Mandate — derive parameters from operating mode.
      //
      // E2E tenants (prefix `e2e-`) get an ADVISORY mandate by default so the
      // decision-workflow's compliance check always escalates to L2 →
      // USER_CONFIRMATION_REQUESTED → AdvisoryStatus.pendingDecisionsCount++,
      // which is what apps/nestfolio-e2e step 8 asserts. Production tenants
      // keep DISCRETIONARY (autonomous L1 path) until the agents start
      // emitting non-trivial proposed trades that organically escalate to L2.
      // The mandateLevel override on the event payload lets specific e2e tests
      // (e.g. operating-mode-authority.e2e) opt into DISCRETIONARY when they
      // need to assert mode → authority differentiation.
      {
        Put: {
          TableName: tableName,
          Item: {
            pk, sk: 'Mandate', __typename: 'Mandate',
            tenantId: s.tenantId, userId: s.userId, region: ctx.region, createdAt: now, mandateId,
            level: s.mandateLevel ?? (s.tenantId.startsWith('e2e-') ? 'ADVISORY' : 'DISCRETIONARY'),
            ...resolveGuardrailParams(s.operatingMode),
            effectiveDate: now, revokedAt: null, version: 1,
          } satisfies TableEntry,
        },
      },
      // 7. Put initial Deposit (CDC emits DEPOSIT_INITIATED automatically)
      ...(s.capitalAmount > 0 ? [{
        Put: {
          TableName: tableName,
          Item: {
            pk, sk: `Deposit#${depositId}`, __typename: 'Deposit',
            tenantId: s.tenantId, userId: s.userId, region: ctx.region, createdAt: now,
            depositId,
            amountCents: s.capitalAmount, currency: s.currency,
            status: 'INITIATED', initiatedAt: now,
          } satisfies TableEntry,
        },
      }] : []),
    ],
  });

  return skip();
}
