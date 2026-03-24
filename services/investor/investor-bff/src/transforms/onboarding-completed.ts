import { skip, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { getUUID, getTime, type TableEntry } from '@nestfolio/event-processor';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';
import { computeRiskProfile } from '../domain/risk-profile.service';

interface OnboardingCompletedSubject {
  tenantId: string;
  userId: string;
  goal: { objective: string };
  horizonYears: number;
  accountMode: 'simulation' | 'live';
  capitalAmount: number;
  currency: string;
  riskTolerance: number;
  riskExperience: number;
  operatingMode: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  mandateAccepted: true;
}

/**
 * Custom handler -- uses transactWrite for 6 entities atomically.
 * Returns skip() because it handles its own persistence.
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

  await repo.transactWrite({
    TransactItems: [
      // 1. Update InvestorProfile
      {
        Update: {
          TableName: tableName,
          Key: { pk, sk: 'InvestorProfile' },
          UpdateExpression: 'SET operatingMode = :mode, onboardingCompletedAt = :now, updatedAt = :now, #ts = :ts',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: { ':mode': s.operatingMode, ':now': now, ':ts': now },
          ConditionExpression: 'attribute_exists(pk)',
        },
      },
      // 2. Put Goal
      {
        Put: {
          TableName: tableName,
          Item: {
            pk, sk: `Goal#${goalId}`, __typename: 'Goal',
            tenantId: s.tenantId, timestamp: now, goalId,
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
            tenantId: s.tenantId, timestamp: now, profileId: getUUID(),
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
            tenantId: s.tenantId, timestamp: now,
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
            tenantId: s.tenantId, timestamp: now,
            mode: s.accountMode, capitalAmount: s.capitalAmount, currency: s.currency,
            createdAt: now, updatedAt: now,
          } satisfies TableEntry,
        },
      },
      // 6. Put Mandate
      {
        Put: {
          TableName: tableName,
          Item: {
            pk, sk: 'Mandate', __typename: 'Mandate',
            tenantId: s.tenantId, timestamp: now, mandateId,
            level: 'ADVISORY',
            monthlyTurnoverCapPercent: 10,
            maxSingleTradePercent: 5,
            coolDownDays: 1,
            rebalanceCadence: 'QUARTERLY',
            effectiveDate: now, revokedAt: null, version: 1,
          } satisfies TableEntry,
        },
      },
    ],
  });

  return skip();
}
