// Set env BEFORE module import (top-level const in handler captures it)
process.env.TABLE_NAME = 'test-table';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => ({ send: mockSend })),
    },
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
  };
});

jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
}));

import { handler } from '../handlers/tools/portfolio-lookup';

describe('portfolio-lookup tool handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return portfolio snapshot when found', async () => {
    const snapshot = {
      tenantId: 't1',
      __typename: 'PortfolioSnapshot',
      positions: [{ ticker: 'VTI', shares: 100 }],
      cashBalance: 5000,
      totalValue: 50000,
    };
    mockSend.mockResolvedValueOnce({ Items: [snapshot] });

    const result = await handler({ tenantId: 't1' });

    expect(result).toEqual(snapshot);
  });

  it('should return empty portfolio when no data', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler({ tenantId: 't-empty' });

    expect(result).toEqual({ positions: [], cashBalance: 0, totalValue: 0 });
  });

  it('should query correct DynamoDB index', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const { QueryCommand } = require('@aws-sdk/lib-dynamodb');

    await handler({ tenantId: 't1' });

    expect(QueryCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'test-table',
        IndexName: 'tenantId-index',
        KeyConditionExpression: 'tenantId = :tid AND __typename = :type',
        ExpressionAttributeValues: {
          ':tid': 't1',
          ':type': 'PortfolioSnapshot',
        },
      }),
    );
  });
});
