// Handler for AgentCore Gateway tool: portfolio-lookup
// Retrieves current portfolio positions from DynamoDB
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { requireEnv } from '@nestfolio/lambda-utils';

const TABLE_NAME = requireEnv('TABLE_NAME');
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: { tenantId: string; portfolioId?: string }): Promise<unknown> => {
  logger.info('Portfolio lookup', { tenantId: event.tenantId });

  const result = await client.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'tenantId-index',
    KeyConditionExpression: 'tenantId = :tid AND __typename = :type',
    ExpressionAttributeValues: {
      ':tid': event.tenantId,
      ':type': 'PortfolioSnapshot',
    },
    Limit: 1,
    ScanIndexForward: false,
  }));

  return result.Items?.[0] ?? { positions: [], cashBalance: 0, totalValue: 0 };
};
