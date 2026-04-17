import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);

import { createPortfolioLookup } from '../../src/agents/tools/portfolio-lookup';

describe('portfolio-lookup tool', () => {
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const deps = {
    docClient,
    tableName: 'test-table',
  };
  const lookup = createPortfolioLookup(deps);

  beforeEach(() => ddbMock.reset());

  it('should return latest snapshot for valid tenantId', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{
        tenantId: 't1',
        snapshotDate: '2026-03-17',
        holdings: [{ instrument: 'VTI', weight: 0.6, value: 30000 }],
        totalValue: 50000,
      }],
    });

    const result = await lookup({ tenantId: 't1' });
    expect(result).toMatchObject({
      tenantId: 't1',
      snapshot: expect.objectContaining({ totalValue: 50000 }),
    });
  });

  it('should return empty holdings when no snapshot found', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const result = await lookup({ tenantId: 't2' });
    expect(result).toMatchObject({ tenantId: 't2', snapshot: null, holdings: [] });
  });

  it('should return error when tenantId is missing', async () => {
    const result = await lookup({});
    expect(result).toMatchObject({ error: 'tenantId is required' });
  });
});
