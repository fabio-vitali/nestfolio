const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/lib-dynamodb'),
  DynamoDBDocumentClient: { from: jest.fn().mockImplementation(() => ({ send: mockSend })) },
  QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
}));

import { createPortfolioLookup } from '../src/handlers/tools/portfolio-lookup';

describe('portfolio-lookup tool', () => {
  const deps = {
    docClient: { send: mockSend } as any,
    tableName: 'test-table',
  };
  const lookup = createPortfolioLookup(deps);

  beforeEach(() => jest.clearAllMocks());

  it('should return latest snapshot for valid tenantId', async () => {
    mockSend.mockResolvedValue({
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
    mockSend.mockResolvedValue({ Items: [] });
    const result = await lookup({ tenantId: 't2' });
    expect(result).toMatchObject({ tenantId: 't2', snapshot: null, holdings: [] });
  });

  it('should return error when tenantId is missing', async () => {
    const result = await lookup({});
    expect(result).toMatchObject({ error: 'tenantId is required' });
  });
});
