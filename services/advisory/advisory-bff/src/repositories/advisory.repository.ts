import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  TableRepository, getUUID, getTime, type TableEntry, type RequestContext,
} from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';

function decisionPk(tenantId: string, decisionId: string): string {
  return `Decision#${tenantId}#${decisionId}`;
}

export class AdvisoryRepository extends TableRepository {
  private readonly log = withMethodLogging('AdvisoryRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly storeDecision = this.log('storeDecision', async (
    ctx: RequestContext,
    decisionId: string,
    data: Record<string, unknown>,
  ): Promise<boolean> => {
    const now = getTime();
    const item: TableEntry = {
      pk: decisionPk(ctx.tenantId, decisionId),
      sk: 'DecisionReadModel',
      __typename: 'DecisionReadModel',
      ...ctx,
      timestamp: now,
      decisionId,
      status: 'PROPOSED',
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    return this.putIfNotExists(item);
  });

  readonly getDecision = this.log('getDecision', async (tenantId: string, decisionId: string): Promise<Record<string, unknown> | null> => {
    const pk = decisionPk(tenantId, decisionId);
    const items = await this.queryByPk(pk, 'DecisionReadModel');
    return items.length > 0 ? items[0] : null;
  });

  readonly updateDecisionStatus = this.log('updateDecisionStatus', async (
    tenantId: string,
    decisionId: string,
    status: string,
    details?: Record<string, unknown>,
  ): Promise<void> => {
    const pk = decisionPk(tenantId, decisionId);
    const now = getTime();

    await this.transactWrite({
      TransactItems: [
        this.buildTransactUpdate(pk, 'DecisionReadModel', {
          status,
          updatedAt: now,
          timestamp: now,
          ...(details ?? {}),
        }) as any,
      ],
    });
  });

  readonly getDecisionsByStatus = this.log('getDecisionsByStatus', async (
    tenantId: string,
    statuses: string[],
    limit: number = 20,
    cursor?: string,
  ): Promise<{ items: Record<string, unknown>[]; nextCursor: string | null }> => {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'tenantId-index',
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: `#status IN (${statuses.map((_, i) => `:s${i}`).join(', ')}) AND #typ = :typename`,
        ExpressionAttributeNames: { '#status': 'status', '#typ': '__typename' },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':typename': 'DecisionReadModel',
          ...Object.fromEntries(statuses.map((s, i) => [`:s${i}`, s])),
        },
        Limit: limit,
        ScanIndexForward: false,
        ...(cursor
          ? { ExclusiveStartKey: JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) }
          : {}),
      }),
    );

    const nextCursor = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : null;

    return {
      items: (result.Items ?? []) as Record<string, unknown>[],
      nextCursor,
    };
  });

  readonly getDecisionHistory = this.log('getDecisionHistory', async (
    tenantId: string,
    limit: number = 20,
    cursor?: string,
  ): Promise<{ items: Record<string, unknown>[]; nextCursor: string | null }> => {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'tenantId-index',
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: '#typ = :typename',
        ExpressionAttributeNames: { '#typ': '__typename' },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':typename': 'DecisionReadModel',
        },
        Limit: limit,
        ScanIndexForward: false,
        ...(cursor
          ? { ExclusiveStartKey: JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) }
          : {}),
      }),
    );

    const nextCursor = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : null;

    return {
      items: (result.Items ?? []) as Record<string, unknown>[],
      nextCursor,
    };
  });

  readonly storeAgentInvocation = this.log('storeAgentInvocation', async (
    ctx: RequestContext,
    decisionId: string,
    invocation: Record<string, unknown>,
  ): Promise<void> => {
    const now = getTime();
    const invocationId = (invocation.invocationId as string) ?? getUUID();
    const item: TableEntry = {
      pk: decisionPk(ctx.tenantId, decisionId),
      sk: `AgentInvocation#${invocationId}`,
      __typename: 'AgentInvocation',
      ...ctx,
      timestamp: now,
      decisionId,
      invocationId,
      ...invocation,
    };
    await this.put(item);
  });

  readonly getAgentInvocations = this.log('getAgentInvocations', async (tenantId: string, decisionId: string): Promise<Record<string, unknown>[]> => {
    const pk = decisionPk(tenantId, decisionId);
    return this.queryByPk(pk, 'AgentInvocation#');
  });

  readonly storeComplianceCheck = this.log('storeComplianceCheck', async (
    ctx: RequestContext,
    decisionId: string,
    check: Record<string, unknown>,
  ): Promise<void> => {
    const now = getTime();
    const checkId = (check.checkId as string) ?? getUUID();
    const item: TableEntry = {
      pk: decisionPk(ctx.tenantId, decisionId),
      sk: `ComplianceCheck#${checkId}`,
      __typename: 'ComplianceCheck',
      ...ctx,
      timestamp: now,
      decisionId,
      checkId,
      ...check,
    };
    await this.put(item);
  });

  readonly getComplianceChecks = this.log('getComplianceChecks', async (tenantId: string, decisionId: string): Promise<Record<string, unknown>[]> => {
    const pk = decisionPk(tenantId, decisionId);
    return this.queryByPk(pk, 'ComplianceCheck#');
  });

  readonly recordUserInteraction = this.log('recordUserInteraction', async (
    ctx: RequestContext,
    decisionId: string,
    interactionType: string,
  ): Promise<void> => {
    const now = getTime();
    const interactionId = getUUID();
    const item: TableEntry = {
      pk: decisionPk(ctx.tenantId, decisionId),
      sk: `UserInteraction#${interactionId}`,
      __typename: 'UserInteraction',
      ...ctx,
      timestamp: now,
      decisionId,
      interactionType,
      interactedAt: now,
    };
    await this.put(item);
  });

  readonly putUserConfirmation = this.log('putUserConfirmation', async (
    ctx: RequestContext,
    decisionId: string,
    confirmedAt: string,
  ): Promise<void> => {
    const item: TableEntry = {
      pk: decisionPk(ctx.tenantId, decisionId),
      sk: `UserConfirmation#${getUUID()}`,
      __typename: 'UserConfirmation',
      ...ctx,
      timestamp: confirmedAt,
      decisionId,
      confirmedAt,
    };
    await this.put(item);
  });

  readonly putUserRejection = this.log('putUserRejection', async (
    ctx: RequestContext,
    decisionId: string,
    rejectedAt: string,
    rejectionReason: string,
  ): Promise<void> => {
    const item: TableEntry = {
      pk: decisionPk(ctx.tenantId, decisionId),
      sk: `UserRejection#${getUUID()}`,
      __typename: 'UserRejection',
      ...ctx,
      timestamp: rejectedAt,
      decisionId,
      rejectedAt,
      rejectionReason,
    };
    await this.put(item);
  });
}
