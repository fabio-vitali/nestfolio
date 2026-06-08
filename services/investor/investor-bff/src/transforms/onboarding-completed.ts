import { skip, parseSubject, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { getUUID, getTime, type TableEntry } from '@nestfolio/event-processor';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';
import { computeRiskProfile } from '../domain/risk-profile.service';
import type { InvestorProfileUpdated } from '../domain/contracts';
import { OnboardingCompletedRecordSchema } from '@nestfolio/onboarding-bff/contracts';

export async function onboardingCompleted(
  payload: EventPayload,
  ctx: EventContext,
): Promise<WriteIntent> {
  const s = parseSubject(payload, OnboardingCompletedRecordSchema);
  const tableName = process.env['TABLE_NAME']!;
  const repo = new InvestorProfileRepository(tableName);
  const now = getTime();
  const pk = `InvestorProfile#${s.tenantId}#${s.userId}`;
  const risk = computeRiskProfile(s.riskTolerance, s.riskExperience);
  const mandateId = getUUID();
  const depositId = getUUID();
  // mandateLevel is not carried in the ONBOARDING_COMPLETED subject (onboarding-bff does not emit it);
  // derive it from the tenant prefix at materialization time.
  const mandateLevel: 'ADVISORY' | 'DISCRETIONARY' =
    s.tenantId.startsWith('e2e-') ? 'ADVISORY' : 'DISCRETIONARY';

  await repo.transactWrite({
    TransactItems: [
      {
        Put: {
          TableName: tableName,
          Item: {
            pk,
            sk: 'InvestorProfile',
            __typename: 'InvestorProfile',
            tenantId: s.tenantId,
            userId: s.userId,
            region: ctx.region,
            email: s.email,
            operatingMode: s.operatingMode,
            executionMode: 'simulation',
            accountMode: { mode: s.accountMode, capitalAmount: s.capitalAmount, currency: s.currency },
            goal: {
              objective: s.goal.objective,
              timeHorizonMonths: s.horizonYears * 12,
              targetAmountCents: 0,
              currency: s.currency,
              targetReturn: 0,
            },
            riskProfile: {
              score: risk.score,
              band: risk.band,
              toleranceResponse: risk.tolerance,
              experienceLevel: risk.experienceLevel,
            },
            mandateId,
            mandateLevel,
            onboardingCompletedAt: now,
            __version: 1,
            createdAt: now,
            updatedAt: now,
            timestamp: now,
          } satisfies TableEntry & Pick<InvestorProfileUpdated, 'tenantId' | 'userId' | 'operatingMode' | 'goal' | 'riskProfile'>,
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: {
            pk,
            sk: 'Mandate',
            __typename: 'Mandate',
            tenantId: s.tenantId,
            userId: s.userId,
            region: ctx.region,
            mandateId,
            level: mandateLevel,
            status: 'ACTIVE',
            operatingMode: s.operatingMode,
            effectiveDate: now,
            revokedAt: null,
            __version: 1,
            createdAt: now,
            updatedAt: now,
            timestamp: now,
          } satisfies TableEntry,
        },
      },
      ...(s.capitalAmount > 0
        ? [
            {
              Put: {
                TableName: tableName,
                Item: {
                  pk,
                  sk: `DepositIntent#${depositId}`,
                  __typename: 'DepositIntent',
                  tenantId: s.tenantId,
                  userId: s.userId,
                  region: ctx.region,
                  createdAt: now,
                  depositId,
                  amountCents: s.capitalAmount,
                  currency: s.currency,
                  status: 'INITIATED',
                  initiatedAt: now,
                  timestamp: now,
                } satisfies TableEntry,
              },
            },
          ]
        : []),
    ],
  });

  return skip();
}
