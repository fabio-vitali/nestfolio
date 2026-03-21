import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

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

// --- Production wiring ---

const TABLE_NAME = process.env.TABLE_NAME ?? 'portfolio-engine-table';
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const lookup = createPortfolioLookup({ docClient, tableName: TABLE_NAME });

export const handler = async (event: Record<string, unknown>): Promise<Record<string, unknown>> => {
  return lookup(event as { tenantId?: string });
};
