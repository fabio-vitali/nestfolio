import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

interface PortfolioLookupDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
}

export const createPortfolioLookup = (deps: PortfolioLookupDeps) =>
  async (event: { tenantId?: string }): Promise<Record<string, unknown>> => {
    if (!event.tenantId) {
      return { error: 'tenantId is required' };
    }

    const result = await deps.docClient.send(new QueryCommand({
      TableName: deps.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${event.tenantId}`,
        ':prefix': 'SNAPSHOT#',
      },
      ScanIndexForward: false,
      Limit: 1,
    }));

    const snapshot = result.Items?.[0];
    return snapshot
      ? { tenantId: event.tenantId, snapshot }
      : { tenantId: event.tenantId, snapshot: null, holdings: [] };
  };
