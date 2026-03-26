import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getUUID, getTime, type TableEntry } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import type { Phases, OnboardingSession } from '../domain/schemas';

function sessionPk(tenantId: string, userId: string): string {
  return `OnboardingSession#${tenantId}#${userId}`;
}

const TOTAL_PHASES = 7;

export class OnboardingRepository extends TableRepository {
  private readonly log = withMethodLogging('OnboardingRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly createSession = this.log('createSession',
    async (tenantId: string, userId: string, agentMemorySessionId: string): Promise<OnboardingSession & { sessionId: string }> => {
      const now = getTime();
      const sessionId = getUUID();

      const item: TableEntry = {
        pk: sessionPk(tenantId, userId),
        sk: `OnboardingSession#${sessionId}`,
        __typename: 'OnboardingSession',
        tenantId,
        userId,
        timestamp: now,
        sessionId,
        status: 'in_progress',
        currentPhase: 'goal',
        phaseIndex: 0,
        phases: {},
        startedAt: now,
        agentMemorySessionId,
        ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      };

      await this.put(item);

      return {
        sessionId,
        status: 'in_progress',
        currentPhase: 'goal',
        phaseIndex: 0,
        phases: {},
        startedAt: now,
        agentMemorySessionId,
        ttl: item.ttl as number,
      };
    },
  );

  readonly updatePhase = this.log('updatePhase',
    async (tenantId: string, userId: string, sessionId: string, phase: string, data: Record<string, unknown>, nextPhase: string, nextIdx: number): Promise<void> => {
      const pk = sessionPk(tenantId, userId);
      const now = getTime();

      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk: `OnboardingSession#${sessionId}` },
        UpdateExpression: 'SET phases.#phase = :data, currentPhase = :next, phaseIndex = :idx, #ts = :ts',
        ExpressionAttributeNames: { '#phase': phase, '#ts': 'timestamp' },
        ExpressionAttributeValues: { ':data': data, ':next': nextPhase, ':idx': nextIdx, ':ts': now },
        ConditionExpression: 'attribute_exists(pk)',
      }));
    },
  );

  readonly completeSession = this.log('completeSession',
    async (tenantId: string, userId: string, sessionId: string, phases: Phases): Promise<void> => {
      const pk = sessionPk(tenantId, userId);
      const now = getTime();

      // CDC record — raw onboarding data, onboarding vocabulary only
      const cdcRecord: TableEntry = {
        pk: `OnboardingCompleted#${tenantId}#${userId}`,
        sk: `OnboardingCompleted#${sessionId}`,
        __typename: 'OnboardingCompleted',
        tenantId,
        userId,
        timestamp: now,
        goal: phases.goal!,
        horizonYears: phases.horizon!.years,
        accountMode: phases.mode!.accountMode,
        capitalAmount: phases.capital!.amount,
        currency: phases.capital!.currency,
        riskTolerance: phases.risk!.toleranceIdx,
        riskExperience: phases.risk!.experienceIdx,
        operatingMode: phases.operatingMode!.mode.toUpperCase(),
        mandateAccepted: true,
        ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30-day cleanup
      };

      await this.transactWrite({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { pk, sk: `OnboardingSession#${sessionId}` },
              UpdateExpression: 'SET #status = :status, completedAt = :now, currentPhase = :phase, phaseIndex = :idx, #ts = :ts',
              ExpressionAttributeNames: { '#status': 'status', '#ts': 'timestamp' },
              ExpressionAttributeValues: { ':status': 'completed', ':now': now, ':phase': 'completed', ':idx': TOTAL_PHASES, ':ts': now },
            },
          },
          { Put: { TableName: this.tableName, Item: cdcRecord } },
        ],
      });
    },
  );

  readonly confirmGoLive = this.log('confirmGoLive',
    async (tenantId: string, userId: string, sessionId: string): Promise<void> => {
      const pk = sessionPk(tenantId, userId);
      const now = getTime();

      // CDC record — emitted as GO_LIVE_CONFIRMED via event-publisher
      const cdcRecord: TableEntry = {
        pk: `GoLiveConfirmed#${tenantId}`,
        sk: `GoLiveConfirmed#${now}`,
        __typename: 'GoLiveConfirmed',
        tenantId,
        userId,
        timestamp: now,
        ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      };

      await this.transactWrite({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { pk, sk: `OnboardingSession#${sessionId}` },
              UpdateExpression: 'SET #status = :status, completedAt = :now, currentPhase = :phase, #ts = :ts',
              ExpressionAttributeNames: { '#status': 'status', '#ts': 'timestamp' },
              ExpressionAttributeValues: { ':status': 'completed', ':now': now, ':phase': 'go_live_confirmation', ':ts': now },
            },
          },
          { Put: { TableName: this.tableName, Item: cdcRecord } },
        ],
      });
    },
  );

  readonly getActiveSession = this.log('getActiveSession',
    async (tenantId: string, userId: string): Promise<Record<string, unknown> | null> => {
      const pk = sessionPk(tenantId, userId);
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: '#status <> :completed',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':pk': pk, ':sk': 'OnboardingSession#', ':completed': 'completed' },
        ScanIndexForward: false,
        Limit: 1,
      }));
      return result.Items?.[0] ?? null;
    },
  );
}
