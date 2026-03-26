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
    GetCommand: jest.fn().mockImplementation((input) => ({ _type: 'Get', input })),
    UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: 'Update', input })),
  };
});

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
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
    protected async update(pk: string, sk: string, attrs: Record<string, unknown>) {
      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      const entries = Object.entries(attrs);
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      const sets: string[] = [];
      entries.forEach(([k, v], i) => {
        names[`#a${i}`] = k;
        values[`:v${i}`] = v;
        sets.push(`#a${i} = :v${i}`);
      });
      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }));
    }
  },
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

import { CircuitBreakerRepository } from '../src/repositories/circuit-breaker.repository';

const TABLE_NAME = 'broker-ctrl-table';
const TENANT_ID = 'tenant-123';
const SYMBOL = 'AAPL';
const FIXED_TIME = '2025-01-01T00:00:00.000Z';

describe('CircuitBreakerRepository', () => {
  let repo: CircuitBreakerRepository;

  beforeEach(() => {
    mockSend.mockReset();
    repo = new CircuitBreakerRepository(TABLE_NAME);
  });

  it('getBreaker — reads by tenantId + symbol', async () => {
    const fakeItem = {
      pk: `CircuitBreaker#${TENANT_ID}#${SYMBOL}`,
      sk: 'CircuitBreaker',
      state: 'OPEN',
      reason: 'loss limit exceeded',
    };
    mockSend.mockResolvedValueOnce({ Item: fakeItem });

    const result = await repo.getBreaker(TENANT_ID, SYMBOL);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [cmd] = mockSend.mock.calls[0];
    expect(cmd._type).toBe('Get');
    expect(cmd.input.TableName).toBe(TABLE_NAME);
    expect(cmd.input.Key).toEqual({
      pk: `CircuitBreaker#${TENANT_ID}#${SYMBOL}`,
      sk: 'CircuitBreaker',
    });
    expect(result).toEqual(fakeItem);
  });

  it('getBreaker — returns null when not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await repo.getBreaker(TENANT_ID, SYMBOL);

    expect(result).toBeNull();
  });

  it('openBreaker — sets state=OPEN with reason', async () => {
    mockSend.mockResolvedValueOnce({});

    await repo.openBreaker(TENANT_ID, SYMBOL, 'loss limit exceeded');

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [cmd] = mockSend.mock.calls[0];
    expect(cmd._type).toBe('Put');
    expect(cmd.input.Item).toMatchObject({
      pk: `CircuitBreaker#${TENANT_ID}#${SYMBOL}`,
      sk: 'CircuitBreaker',
      __typename: 'CircuitBreaker',
      tenantId: TENANT_ID,
      symbol: SYMBOL,
      state: 'OPEN',
      openedAt: FIXED_TIME,
      reason: 'loss limit exceeded',
    });
  });

  it('closeBreaker — sets state=CLOSED', async () => {
    mockSend.mockResolvedValueOnce({});

    await repo.closeBreaker(TENANT_ID, SYMBOL);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [cmd] = mockSend.mock.calls[0];
    expect(cmd._type).toBe('Update');
    expect(cmd.input.Key).toEqual({
      pk: `CircuitBreaker#${TENANT_ID}#${SYMBOL}`,
      sk: 'CircuitBreaker',
    });
    const attrValues = Object.values(cmd.input.ExpressionAttributeValues as Record<string, unknown>);
    expect(attrValues).toContain('CLOSED');
    expect(attrValues).toContain(FIXED_TIME);
  });

  it('isOpen — returns true when OPEN', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        pk: `CircuitBreaker#${TENANT_ID}#${SYMBOL}`,
        sk: 'CircuitBreaker',
        state: 'OPEN',
      },
    });

    const result = await repo.isOpen(TENANT_ID, SYMBOL);

    expect(result).toBe(true);
  });

  it('isOpen — returns false when not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await repo.isOpen(TENANT_ID, SYMBOL);

    expect(result).toBe(false);
  });

  it('storeHealTaskToken — stores healTaskToken', async () => {
    mockSend.mockResolvedValueOnce({});

    await repo.storeHealTaskToken(TENANT_ID, SYMBOL, 'heal-token-xyz');

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [cmd] = mockSend.mock.calls[0];
    expect(cmd._type).toBe('Update');
    expect(cmd.input.Key).toEqual({
      pk: `CircuitBreaker#${TENANT_ID}#${SYMBOL}`,
      sk: 'CircuitBreaker',
    });
    const attrValues = Object.values(cmd.input.ExpressionAttributeValues as Record<string, unknown>);
    expect(attrValues).toContain('heal-token-xyz');
  });
});
