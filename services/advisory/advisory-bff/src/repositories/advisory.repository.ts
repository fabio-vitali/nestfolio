import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getUUID, getTime, type TableEntry } from '@nestfolio/platform-core';
import { withMethodLogging } from '@nestfolio/lambda-utils';

function decisionPk(tenantId: string, decisionId: string): string {
  return `Decision#${tenantId}#${decisionId}`;
}

export class AdvisoryRepository extends TableRepository {
  private readonly log = withMethodLogging('AdvisoryRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly storeDecision = this.log('storeDecision', async (
    tenantId: string,
    decisionId: string,
    data: Record<string, unknown>,
  ): Promise<void> => {
    const now = getTime();
    const item: TableEntry = {
      pk: decisionPk(tenantId, decisionId),
      sk: 'DecisionReadModel',
      __typename: 'DecisionReadModel',
      tenantId,
      timestamp: now,
      decisionId,
      status: 'PROPOSED',
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    await this.put(item);
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

    const editEvent: TableEntry = {
      pk,
      sk: `EditEvent#${now}#${getUUID()}`,
      __typename: 'EditEvent',
      tenantId,
      timestamp: now,
      operation: 'replace',
      path: `/decisions/${decisionId}/status`,
      value: status,
      editedAt: now,
    };

    await this.transactWrite({
      TransactItems: [
        this.buildTransactUpdate(pk, 'DecisionReadModel', {
          status,
          updatedAt: now,
          timestamp: now,
          ...(details ?? {}),
        }) as any,
        { Put: { TableName: this.tableName, Item: editEvent } },
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
        FilterExpression: `#status IN (${statuses.map((_, i) => `:s${i}`).join(', ')}) AND __typename = :typename`,
        ExpressionAttributeNames: { '#status': 'status' },
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
        FilterExpression: '__typename = :typename',
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
    tenantId: string,
    decisionId: string,
    invocation: Record<string, unknown>,
  ): Promise<void> => {
    const now = getTime();
    const invocationId = (invocation.invocationId as string) ?? getUUID();
    const item: TableEntry = {
      pk: decisionPk(tenantId, decisionId),
      sk: `AgentInvocation#${invocationId}`,
      __typename: 'AgentInvocation',
      tenantId,
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
    tenantId: string,
    decisionId: string,
    check: Record<string, unknown>,
  ): Promise<void> => {
    const now = getTime();
    const checkId = (check.checkId as string) ?? getUUID();
    const item: TableEntry = {
      pk: decisionPk(tenantId, decisionId),
      sk: `ComplianceCheck#${checkId}`,
      __typename: 'ComplianceCheck',
      tenantId,
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
    tenantId: string,
    userId: string,
    decisionId: string,
    interactionType: string,
  ): Promise<void> => {
    const now = getTime();
    const interactionId = getUUID();
    const item: TableEntry = {
      pk: decisionPk(tenantId, decisionId),
      sk: `UserInteraction#${interactionId}`,
      __typename: 'UserInteraction',
      tenantId,
      timestamp: now,
      decisionId,
      userId,
      interactionType,
      interactedAt: now,
    };
    await this.put(item);
  });

  readonly putUserConfirmation = this.log('putUserConfirmation', async (
    tenantId: string,
    decisionId: string,
    userId: string,
    confirmedAt: string,
  ): Promise<void> => {
    const item: TableEntry = {
      pk: decisionPk(tenantId, decisionId),
      sk: `UserConfirmation#${getUUID()}`,
      __typename: 'UserConfirmation',
      tenantId,
      timestamp: confirmedAt,
      decisionId,
      userId,
      confirmedAt,
    };
    await this.put(item);
  });

  readonly putUserRejection = this.log('putUserRejection', async (
    tenantId: string,
    decisionId: string,
    userId: string,
    rejectedAt: string,
    rejectionReason: string,
  ): Promise<void> => {
    const item: TableEntry = {
      pk: decisionPk(tenantId, decisionId),
      sk: `UserRejection#${getUUID()}`,
      __typename: 'UserRejection',
      tenantId,
      timestamp: rejectedAt,
      decisionId,
      userId,
      rejectedAt,
      rejectionReason,
    };
    await this.put(item);
  });
}
