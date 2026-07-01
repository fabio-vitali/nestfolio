import { ScanCommand } from '@aws-sdk/lib-dynamodb';
export const s = new ScanCommand({ TableName: 't' });
