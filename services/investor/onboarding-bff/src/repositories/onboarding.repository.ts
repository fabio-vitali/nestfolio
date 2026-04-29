import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getUUID, getTime, type TableEntry, type RequestContext } from '@nestfolio/event-processor';
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
    async (agentMemorySessionId: string, ctx: RequestContext): Promise<OnboardingSession & { sessionId: string }> => {
      const now = getTime();
      const sessionId = getUUID();

      const item: TableEntry = {
        pk: sessionPk(ctx.tenantId, ctx.userId),
        sk: `OnboardingSession#${sessionId}`,
        __typename: 'OnboardingSession',
        ...ctx,
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
    async (sessionId: string, phases: Phases, ctx: RequestContext): Promise<void> => {
      const pk = sessionPk(ctx.tenantId, ctx.userId);
      const now = getTime();

      // CDC record — raw onboarding data, onboarding vocabulary only.
      // Account-mode + risk-profile phases were dropped from the wizard; defaults
      // below keep the OnboardingCompleted CDC schema satisfied for downstream
      // services (investor-bff/advisory) until those flows surface their own UI.
      const cdcRecord: TableEntry = {
        pk: `OnboardingCompleted#${ctx.tenantId}#${ctx.userId}`,
        sk: `OnboardingCompleted#${sessionId}`,
        __typename: 'OnboardingCompleted',
        ...ctx,
        timestamp: now,
        goal: phases.goal!,
        horizonYears: phases.horizon!.years,
        accountMode: phases.mode?.accountMode ?? 'simulation',
        capitalAmount: phases.capital!.amount,
        currency: phases.capital?.currency ?? 'EUR',
        riskTolerance: phases.risk?.toleranceIdx ?? 1,
        riskExperience: phases.risk?.experienceIdx ?? 1,
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
    async (sessionId: string, ctx: RequestContext): Promise<void> => {
      const pk = sessionPk(ctx.tenantId, ctx.userId);
      const now = getTime();

      // CDC record — emitted as GO_LIVE_CONFIRMED via event-publisher
      const cdcRecord: TableEntry = {
        pk: `GoLiveConfirmed#${ctx.tenantId}`,
        sk: `GoLiveConfirmed#${now}`,
        __typename: 'GoLiveConfirmed',
        ...ctx,
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
