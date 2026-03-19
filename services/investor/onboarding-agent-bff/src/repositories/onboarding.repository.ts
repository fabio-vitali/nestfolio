import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getUUID, getTime, type TableEntry } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import type { RiskProfileData, OnboardingSession } from '../service-domain/schemas';

function profilePk(tenantId: string, userId: string): string {
  return `InvestorProfile#${tenantId}#${userId}`;
}

function editEvent(
  pk: string,
  tenantId: string,
  userId: string,
  operation: string,
  path: string,
  value: unknown,
  action?: string,
): TableEntry {
  const now = getTime();
  return {
    pk,
    sk: `EditEvent#${now}#${getUUID()}`,
    __typename: 'EditEvent',
    tenantId,
    timestamp: now,
    operation,
    path,
    value,
    editedBy: userId,
    editedAt: now,
    ...(action ? { action } : {}),
  };
}

export class OnboardingRepository extends TableRepository {
  private readonly log = withMethodLogging('OnboardingRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly createSession = this.log('createSession',
    async (tenantId: string, userId: string, agentMemorySessionId: string): Promise<OnboardingSession & { sessionId: string }> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();
      const sessionId = getUUID();

      const sessionItem: TableEntry = {
        pk,
        sk: `OnboardingSession#${sessionId}`,
        __typename: 'OnboardingSession',
        tenantId,
        timestamp: now,
        sessionId,
        currentPhase: 'goal',
        phaseIndex: 0,
        startedAt: now,
        agentMemorySessionId,
        ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      };

      await this.transactWrite({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: sessionItem } },
          { Put: { TableName: this.tableName, Item: editEvent(pk, tenantId, userId, 'add', '/onboardingSession', { sessionId }, 'ONBOARDING_STARTED') } },
        ],
      });

      return { sessionId, currentPhase: 'goal' as const, phaseIndex: 0, startedAt: now, agentMemorySessionId };
    },
  );

  readonly commitGoal = this.log('commitGoal',
    async (tenantId: string, userId: string, objective: string): Promise<void> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();
      const goalId = getUUID();

      const goalItem: TableEntry = {
        pk,
        sk: `Goal#${goalId}`,
        __typename: 'Goal',
        tenantId,
        timestamp: now,
        goalId,
        objective,
        targetAmountCents: 0,
        currency: 'EUR',
        timeHorizonMonths: 0,
        targetReturn: 0,
        createdAt: now,
        updatedAt: now,
      };

      await this.transactWrite({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: goalItem } },
          { Put: { TableName: this.tableName, Item: editEvent(pk, tenantId, userId, 'add', `/goals/${goalId}`, { objective }) } },
        ],
      });
    },
  );

  readonly commitHorizon = this.log('commitHorizon',
    async (tenantId: string, userId: string, horizonYears: number): Promise<void> => {
      const pk = profilePk(tenantId, userId);
      const goals = await this.queryByPk(pk, 'Goal#');
      if (goals.length === 0) return;
      const latestGoal = goals[goals.length - 1];
      const now = getTime();

      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk: latestGoal.sk as string },
        UpdateExpression: 'SET timeHorizonMonths = :months, #ts = :ts, updatedAt = :now',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: { ':months': horizonYears * 12, ':ts': now, ':now': now },
        ConditionExpression: 'attribute_exists(pk)',
      }));

      await this.put(editEvent(pk, tenantId, userId, 'replace', '/goals/horizonYears', { horizonYears }));
    },
  );

  readonly commitAccountMode = this.log('commitAccountMode',
    async (tenantId: string, userId: string, mode: 'simulation' | 'live', capitalAmount: number): Promise<void> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();

      const item: TableEntry = {
        pk,
        sk: 'AccountMode',
        __typename: 'AccountMode',
        tenantId,
        timestamp: now,
        mode,
        capitalAmount,
        currency: 'EUR',
        createdAt: now,
        updatedAt: now,
      };

      await this.transactWrite({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: item } },
          { Put: { TableName: this.tableName, Item: editEvent(pk, tenantId, userId, 'add', '/accountMode', { mode, capitalAmount }) } },
        ],
      });
    },
  );

  readonly commitRiskProfile = this.log('commitRiskProfile',
    async (tenantId: string, userId: string, risk: RiskProfileData): Promise<void> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();
      const profileId = getUUID();

      const item: TableEntry = {
        pk,
        sk: 'RiskProfile',
        __typename: 'RiskProfile',
        tenantId,
        timestamp: now,
        profileId,
        score: risk.score,
        band: bandFromCategory(risk.category),
        toleranceResponse: risk.tolerance,
        experienceLevel: risk.experienceLevel,
        assessedAt: now,
        version: 1,
      };

      await this.transactWrite({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: item } },
          { Put: { TableName: this.tableName, Item: editEvent(pk, tenantId, userId, 'add', '/riskProfile', risk) } },
        ],
      });
    },
  );

  readonly commitOperatingMode = this.log('commitOperatingMode',
    async (tenantId: string, userId: string, mode: string): Promise<void> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();
      const modeUpper = mode.toUpperCase();

      const item: TableEntry = {
        pk,
        sk: 'OperatingMode',
        __typename: 'OperatingModeRecord',
        tenantId,
        timestamp: now,
        mode: modeUpper,
        selectedAt: now,
      };

      await this.transactWrite({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: item } },
          {
            Update: {
              TableName: this.tableName,
              Key: { pk, sk: 'InvestorProfile' },
              UpdateExpression: 'SET operatingMode = :mode, updatedAt = :now, #ts = :ts',
              ExpressionAttributeNames: { '#ts': 'timestamp' },
              ExpressionAttributeValues: { ':mode': modeUpper, ':now': now, ':ts': now },
            },
          },
          { Put: { TableName: this.tableName, Item: editEvent(pk, tenantId, userId, 'replace', '/operatingMode', modeUpper) } },
        ],
      });
    },
  );

  readonly commitMandate = this.log('commitMandate',
    async (tenantId: string, userId: string): Promise<void> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();
      const mandateId = getUUID();

      const item: TableEntry = {
        pk,
        sk: 'Mandate',
        __typename: 'Mandate',
        tenantId,
        timestamp: now,
        mandateId,
        level: 'ADVISORY',
        monthlyTurnoverCapPercent: 10,
        maxSingleTradePercent: 5,
        coolDownDays: 1,
        rebalanceCadence: 'QUARTERLY',
        effectiveDate: now,
        revokedAt: null,
        version: 1,
      };

      await this.transactWrite({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: item } },
          { Put: { TableName: this.tableName, Item: editEvent(pk, tenantId, userId, 'add', '/mandate', { mandateId }, 'GRANT_MANDATE') } },
        ],
      });
    },
  );

  readonly advanceSession = this.log('advanceSession',
    async (tenantId: string, userId: string, sessionId: string, nextPhase: string, phaseIndex: number): Promise<void> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();

      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk: `OnboardingSession#${sessionId}` },
        UpdateExpression: 'SET currentPhase = :phase, phaseIndex = :idx, #ts = :ts' +
          (nextPhase === 'completed' ? ', completedAt = :now' : ''),
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':phase': nextPhase,
          ':idx': phaseIndex,
          ':ts': now,
          ...(nextPhase === 'completed' ? { ':now': now } : {}),
        },
        ConditionExpression: 'attribute_exists(pk)',
      }));
    },
  );

  readonly getActiveSession = this.log('getActiveSession',
    async (tenantId: string, userId: string): Promise<Record<string, unknown> | null> => {
      const pk = profilePk(tenantId, userId);
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: 'currentPhase <> :completed',
        ExpressionAttributeValues: { ':pk': pk, ':sk': 'OnboardingSession#', ':completed': 'completed' },
        ScanIndexForward: false,
        Limit: 1,
      }));
      return result.Items?.[0] ?? null;
    },
  );
}

function bandFromCategory(category: string): { minEquity: number; maxEquity: number } {
  switch (category) {
    case 'conservative': return { minEquity: 0.1, maxEquity: 0.3 };
    case 'moderate': return { minEquity: 0.3, maxEquity: 0.6 };
    case 'aggressive': return { minEquity: 0.6, maxEquity: 0.9 };
    default: return { minEquity: 0.3, maxEquity: 0.6 };
  }
}
