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
    PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
    UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: 'Update', input })),
  };
});

jest.mock('@nestfolio/platform-core', () => ({
  TableRepository: class {
    protected readonly docClient: { send: jest.Mock };
    protected readonly tableName: string;
    constructor(tableName: string) {
      this.tableName = tableName;
      this.docClient = { send: mockSend };
    }
    protected async put(item: Record<string, unknown>) {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
    }
    protected async queryByPk(pk: string, skPrefix?: string) {
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
      }));
      return result.Items ?? [];
    }
    protected async queryAll(input: unknown) {
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(new QueryCommand(input));
      return result.Items ?? [];
    }
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

jest.mock('@nestfolio/command-core', () => ({
  INITIAL_PORTFOLIO_STATE: {
    positions: {},
    cashBalanceCents: 10_000_000,
    lastEventSequence: 0,
  },
  replayEvents: jest.fn((initialState, events, reducer) => {
    return events.reduce((state: unknown, entry: unknown) => reducer(state, entry), initialState);
  }),
  applyCommand: jest.fn((_cmd, payload, state) => {
    const s = state as { positions: Record<string, unknown>; cashBalanceCents: number };
    const p = payload as { symbol: string; side: string; quantity: number; fillPrice: number };
    const existing = (s.positions[p.symbol] as Record<string, number>) ?? { quantity: 0, totalCostBasis: 0 };
    if (p.side === 'BUY') {
      const newQty = existing.quantity + p.quantity;
      const newCost = existing.totalCostBasis + p.quantity * p.fillPrice;
      return {
        ok: true,
        value: {
          nextState: {
            ...s,
            positions: {
              ...s.positions,
              [p.symbol]: {
                symbol: p.symbol,
                quantity: newQty,
                averageCostBasis: newCost / newQty,
                totalCostBasis: newCost,
                lastFillPrice: p.fillPrice,
              },
            },
            cashBalanceCents: s.cashBalanceCents - Math.round(p.quantity * p.fillPrice * 100),
          },
        },
      };
    }
    return { ok: true, value: { nextState: s } };
  }),
  RecordFill: { type: 'RecordFill' },
}));

import { LedgerRepository } from '../src/repositories/ledger.repository';
import { TimeTravelService } from '../src/services/time-travel.service';

describe('TimeTravelService', () => {
  const repository = new LedgerRepository('test-table');
  const service = new TimeTravelService(repository);

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ Items: [] });
  });

  it('should return initial state when no checkpoints and no entries exist', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] }) // getCheckpointBefore
      .mockResolvedValueOnce({ Items: [] }); // queryEntriesBetween

    const state = await service.getPortfolioAt('tenant-1', 'actual', '2025-06-15T00:00:00.000Z');

    expect(state.positions).toEqual({});
    expect(state.cashBalanceCents).toBe(10_000_000);
  });

  it('should restore from checkpoint when no entries exist after it', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{
          positions: { VTI: { symbol: 'VTI', quantity: 10, averageCostBasis: 250, totalCostBasis: 2500, lastFillPrice: 250 } },
          cashBalanceCents: 7_500_000,
          snapshotAt: '2025-06-10T23:59:59.000Z',
        }],
      }) // getCheckpointBefore
      .mockResolvedValueOnce({ Items: [] }); // queryEntriesBetween

    const state = await service.getPortfolioAt('tenant-1', 'actual', '2025-06-15T00:00:00.000Z');

    expect(state.positions['VTI']).toBeDefined();
    expect((state.positions['VTI'] as Record<string, unknown>).quantity).toBe(10);
    expect(state.cashBalanceCents).toBe(7_500_000);
  });

  it('should replay entries on top of checkpoint state', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{
          positions: {},
          cashBalanceCents: 10_000_000,
          snapshotAt: '2025-06-10T00:00:00.000Z',
        }],
      }) // getCheckpointBefore
      .mockResolvedValueOnce({
        Items: [{
          eventId: 'e1',
          eventType: 'ORDER_FILLED',
          payload: { orderId: 'o1', symbol: 'SPY', side: 'BUY', quantity: 5, fillPrice: 512.30, filledAt: '2025-06-12T10:00:00.000Z' },
          timestamp: '2025-06-12T10:00:00.000Z',
          sequenceNo: 1,
        }],
      }); // queryEntriesBetween

    const state = await service.getPortfolioAt('tenant-1', 'actual', '2025-06-15T00:00:00.000Z');

    expect(state.positions['SPY']).toBeDefined();
    expect((state.positions['SPY'] as Record<string, unknown>).quantity).toBe(5);
  });

  it('should replay from epoch when no checkpoint exists', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] }) // getCheckpointBefore → none
      .mockResolvedValueOnce({
        Items: [{
          eventId: 'e1',
          eventType: 'ORDER_FILLED',
          payload: { orderId: 'o1', symbol: 'VTI', side: 'BUY', quantity: 3, fillPrice: 245.50, filledAt: '2025-06-01T10:00:00.000Z' },
          timestamp: '2025-06-01T10:00:00.000Z',
          sequenceNo: 1,
        }],
      }); // queryEntriesBetween

    const state = await service.getPortfolioAt('tenant-1', 'actual', '2025-06-15T00:00:00.000Z');

    expect(state.positions['VTI']).toBeDefined();
  });

  it('should work with simulated stream type', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    const state = await service.getPortfolioAt('tenant-1', 'simulated', '2025-06-15T00:00:00.000Z');

    expect(state.cashBalanceCents).toBe(10_000_000);

    // Verify the query used 'simulated' streamType
    const queryCall = mockSend.mock.calls[0][0];
    expect(queryCall.input.ExpressionAttributeValues[':pk']).toContain('simulated');
  });
});
