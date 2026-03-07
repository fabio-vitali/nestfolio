import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getUUID, getTime, log, type TableEntry } from '@nestfolio/platform-core';

function decisionPk(tenantId: string, decisionId: string): string {
  return `Decision#${tenantId}#${decisionId}`;
}

export class AdvisoryRepository extends TableRepository {
  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  @log()
  async storeDecision(
    tenantId: string,
    decisionId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
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
  }

  @log()
  async getDecision(tenantId: string, decisionId: string): Promise<Record<string, unknown> | null> {
    const pk = decisionPk(tenantId, decisionId);
    const items = await this.queryByPk(pk, 'DecisionReadModel');
    return items.length > 0 ? items[0] : null;
  }

  @log()
  async updateDecisionStatus(
    tenantId: string,
    decisionId: string,
    status: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    const pk = decisionPk(tenantId, decisionId);
    const now = getTime();

    const updatedItem: TableEntry = {
      pk,
      sk: 'DecisionReadModel',
      __typename: 'DecisionReadModel',
      tenantId,
      timestamp: now,
      decisionId,
      status,
      updatedAt: now,
      ...details,
    };

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
        { Put: { TableName: this.tableName, Item: updatedItem } },
        { Put: { TableName: this.tableName, Item: editEvent } },
      ],
    });
  }

  @log()
  async getDecisionsByStatus(
    tenantId: string,
    statuses: string[],
    limit: number = 20,
    cursor?: string,
  ): Promise<{ items: Record<string, unknown>[]; nextCursor: string | null }> {
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
  }

  @log()
  async getDecisionHistory(
    tenantId: string,
    limit: number = 20,
    cursor?: string,
  ): Promise<{ items: Record<string, unknown>[]; nextCursor: string | null }> {
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
  }

  @log()
  async storeAgentInvocation(
    tenantId: string,
    decisionId: string,
    invocation: Record<string, unknown>,
  ): Promise<void> {
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
  }

  @log()
  async getAgentInvocations(tenantId: string, decisionId: string): Promise<Record<string, unknown>[]> {
    const pk = decisionPk(tenantId, decisionId);
    return this.queryByPk(pk, 'AgentInvocation#');
  }

  @log()
  async storeComplianceCheck(
    tenantId: string,
    decisionId: string,
    check: Record<string, unknown>,
  ): Promise<void> {
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
  }

  @log()
  async getComplianceChecks(tenantId: string, decisionId: string): Promise<Record<string, unknown>[]> {
    const pk = decisionPk(tenantId, decisionId);
    return this.queryByPk(pk, 'ComplianceCheck#');
  }

  @log()
  async recordUserInteraction(
    tenantId: string,
    userId: string,
    decisionId: string,
    interactionType: string,
  ): Promise<void> {
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
  }
}
