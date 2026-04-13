import { deriveFromStream, type DeriveFromStreamConfig } from '../../src/pipelines/derive-from-stream';
import { fakeDdbStreamRecord } from '../../src/testing/fake-records';
import { record } from '../../src/intents/record';

jest.mock('../../src/internal', () => {
  const original = jest.requireActual('../../src/internal');
  return {
    ...original,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    getUUID: jest.fn(() => 'test-uuid'),
  };
});

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockImplementation(() => ({ send: mockSend })),
  },
  PutCommand: jest.fn().mockImplementation((input) => ({ ...input, _cmd: 'Put' })),
  UpdateCommand: jest.fn().mockImplementation((input) => ({ ...input, _cmd: 'Update' })),
}));
jest.mock('../../src/engine/error-event-publisher', () => ({
  ErrorEventPublisher: jest.fn().mockImplementation(() => ({
    publishErrors: jest.fn().mockResolvedValue(undefined),
  })),
}));

const testConfig: DeriveFromStreamConfig = {
  serviceName: 'test-service',
  filter: (r) => r.__typename === 'Snapshot',
  transform: (current, previous) => {
    const intents = [];
    if (!previous || current.value !== previous.value) {
      intents.push(record('DerivedEvent', {
        tenantId: current.tenantId,
        value: current.value,
      }, { pk: current.pk as string, sk: `Derived#${current.timestamp}` }));
    }
    return intents;
  },
};

describe('deriveFromStream', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';
    mockSend.mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.TABLE_NAME;
  });

  it('returns a handler function', () => {
    const handler = deriveFromStream(testConfig);
    expect(typeof handler).toBe('function');
  });

  it('transforms INSERT records and executes intents', async () => {
    const handler = deriveFromStream(testConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Snapshot#latest', __typename: 'Snapshot',
          tenantId: 't1', value: 100, timestamp: '2025-01-01T00:00:00.000Z',
        }),
      ],
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const putCall = mockSend.mock.calls[0][0];
    expect(putCall.Item.__typename).toBe('DerivedEvent');
    expect(putCall.Item.value).toBe(100);
  });

  it('skips when transform returns empty array', async () => {
    const noOpConfig: DeriveFromStreamConfig = {
      ...testConfig,
      transform: () => [],
    };

    const handler = deriveFromStream(noOpConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Snapshot#latest', __typename: 'Snapshot',
          tenantId: 't1', value: 100,
        }),
      ],
    });

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('filters non-matching records', async () => {
    const handler = deriveFromStream(testConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Other#1', __typename: 'Other', tenantId: 't1',
        }),
      ],
    });

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('supports async transforms', async () => {
    const asyncConfig: DeriveFromStreamConfig = {
      ...testConfig,
      transform: async (current) => [
        record('AsyncDerived', { value: current.value }, { pk: current.pk as string, sk: 'Async#1' }),
      ],
    };

    const handler = deriveFromStream(asyncConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Snapshot#latest', __typename: 'Snapshot',
          tenantId: 't1', value: 42,
        }),
      ],
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
