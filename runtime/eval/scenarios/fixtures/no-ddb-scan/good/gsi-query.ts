import { QueryCommand } from '@aws-sdk/lib-dynamodb';
export const q = new QueryCommand({ TableName: 't', KeyConditionExpression: 'tenantId = :t', ExpressionAttributeValues: { ':t': 'x' } });
