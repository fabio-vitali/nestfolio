import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { IntentExecutor, projectVersioned } from '@nestfolio/event-processor';
import { expectVersionedWrite, expectStaleDrop } from '@nestfolio/test-support';
import { balanceUpdated } from '../../../src/transforms/balance-updated';

const ddbMock = mockClient(DynamoDBDocumentClient);
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const makeUow = (lastEventSequence: number) => ({
  event: {
    id: 'e1',
    type: 'BALANCE_UPDATED',
    timestamp: '2026-01-01T00:00:00.000Z',
    subject: {
      tenantId: 't1',
      userId: 'u1',
      cashBalanceCents: 500_000,
      snapshot: { positions: {}, cashBalanceCents: 500_000, lastEventSequence },
    },
    context: { tenantId: 't1' },
  },
  payload: {},
  record: {},
});

const fakeCtx = {
  eventId: 'evt-1',
  eventType: 'BALANCE_UPDATED',
  tenantId: 't1',
  timestamp: '2026-01-01T00:00:00.000Z',
  receiveCount: 1,
  serviceName: 'investor-bff',
} as never;

describe('balanceUpdated transform', () => {
  it('returns a projectVersioned CashBalance intent keyed on snapshot.lastEventSequence', () => {
    expect(
      balanceUpdated(makeUow(42) as Parameters<typeof balanceUpdated>[0]),
    ).toEqual(
      projectVersioned('CashBalance', {
        tenantId: 't1',
        userId: 'u1',
        cashBalanceCents: 500_000,
      }, {
        version: 42,
        overrides: { pk: 'InvestorProfile#t1#u1', sk: 'CashBalance' },
      }),
    );
  });

  it('defaults version to 0 when the event carries no snapshot sequence', () => {
    const intent = balanceUpdated({
      event: {
        id: 'e1', type: 'BALANCE_UPDATED', timestamp: '2026-01-01T00:00:00.000Z',
        subject: { tenantId: 't1', userId: 'u1', cashBalanceCents: 1 },
        context: { tenantId: 't1' },
      },
      payload: {}, record: {},
    } as Parameters<typeof balanceUpdated>[0]) as { version: number };
    expect(intent.version).toBe(0);
  });

  describe('version guard (executor)', () => {
    let executor: IntentExecutor;
    beforeEach(() => {
      ddbMock.reset();
      executor = new IntentExecutor({ docClient, tableName: 'TestTable' });
    });

    // onAnyCommand(): the executor builds PutCommand from its OWN @aws-sdk/lib-dynamodb
    // copy; under pnpm nesting that can be a distinct class, so on(PutCommand) misses.
    it('applies a fresh versioned write when the condition succeeds', async () => {
      ddbMock.onAnyCommand().resolves({});
      const result = await executor.execute(
        balanceUpdated(makeUow(10) as Parameters<typeof balanceUpdated>[0]),
        fakeCtx,
      );
      expectVersionedWrite(result);
    });

    it('drops a stale write when the version condition fails', async () => {
      const err = new Error('stale');
      err.name = 'ConditionalCheckFailedException';
      ddbMock.onAnyCommand().rejects(err);
      const result = await executor.execute(
        balanceUpdated(makeUow(3) as Parameters<typeof balanceUpdated>[0]),
        fakeCtx,
      );
      expectStaleDrop(result);
    });
  });
});
