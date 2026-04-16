import { DynamoDBClient, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { StateResetFixture } from '../../src/fixtures/state-reset.fixture';

// Mock the DynamoDB client — no DDB Local dependency
jest.mock('@aws-sdk/client-dynamodb');
const mockSend = jest.fn();
(DynamoDBClient as jest.Mock).mockImplementation(() => ({ send: mockSend }));

const mockSsm = { tableName: jest.fn().mockResolvedValue('dev-broker-alpaca-adpt') };
const mockCtx = { region: 'us-east-1', ssm: mockSsm } as any;

describe('StateResetFixture', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSsm.tableName.mockClear();
  });

  it('should query by pk and delete all returned items', async () => {
    // Query returns two items
    mockSend.mockResolvedValueOnce({
      Items: [
        marshall({ pk: 'CircuitBreaker#alpaca', sk: 'CircuitBreaker', state: 'OPEN' }),
        marshall({ pk: 'CircuitBreaker#alpaca', sk: 'History#1', closedAt: '2026-01-01' }),
      ],
    });
    // Two DeleteItem calls
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});

    const fixture = new StateResetFixture(mockCtx);
    await fixture.reset([{ table: 'broker-alpaca-adpt', pk: 'CircuitBreaker#alpaca' }]);

    expect(mockSsm.tableName).toHaveBeenCalledWith('broker-alpaca-adpt');
    expect(mockSend).toHaveBeenCalledTimes(3); // 1 Query + 2 Delete
    expect(mockSend.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
    expect(mockSend.mock.calls[1][0]).toBeInstanceOf(DeleteItemCommand);
    expect(mockSend.mock.calls[2][0]).toBeInstanceOf(DeleteItemCommand);
  });

  it('should not throw when pk has no items', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const fixture = new StateResetFixture(mockCtx);
    await expect(fixture.reset([{ table: 'broker-alpaca-adpt', pk: 'DoesNotExist#123' }]))
      .resolves.not.toThrow();
    expect(mockSend).toHaveBeenCalledTimes(1); // Query only, no deletes
  });

  it('should log warning and continue on error', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    const fixture = new StateResetFixture(mockCtx);
    await expect(fixture.reset([{ table: 'broker-alpaca-adpt', pk: 'Fail#1' }]))
      .resolves.not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('StateResetFixture'), expect.any(Error));
    warnSpy.mockRestore();
  });
});
