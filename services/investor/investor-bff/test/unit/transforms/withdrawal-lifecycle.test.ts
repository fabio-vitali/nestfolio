import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { IntentExecutor, projectVersioned } from '@nestfolio/event-processor';
import { expectVersionedWrite, expectStaleDrop } from '@nestfolio/test-support';
import { withdrawalLifecycle } from '../../../src/transforms/withdrawal-lifecycle';

const ddbMock = mockClient(DynamoDBDocumentClient);
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const makeUow = (
  subject: Record<string, unknown>,
  version: number,
) => ({
  event: {
    id: 'e1',
    type: 'WITHDRAWAL_SETTLED',
    timestamp: '2026-01-03T00:00:00.000Z',
    subject: { ...subject, __version: version },
    context: {},
  },
  payload: {},
  record: {},
});

const settledSubject = {
  tenantId: 't1',
  userId: 'u1',
  region: 'us-east-1',
  status: 'settled',
  transferId: 'wd-1',
  amountCents: 50_000,
  currency: 'USD',
  initiatedAt: '2026-01-01T00:00:00.000Z',
  settledAt: '2026-01-03T00:00:00.000Z',
};

const fakeCtx = {
  eventId: 'evt-1',
  eventType: 'WITHDRAWAL_SETTLED',
  tenantId: 't1',
  timestamp: '2026-01-03T00:00:00.000Z',
  receiveCount: 1,
  serviceName: 'investor-bff',
} as never;

describe('withdrawalLifecycle transform', () => {
  it('returns a projectVersioned WithdrawalRequest intent (settled) keyed on __version', () => {
    expect(
      withdrawalLifecycle(
        makeUow(settledSubject, 3) as Parameters<typeof withdrawalLifecycle>[0],
      ),
    ).toEqual(
      projectVersioned(
        'WithdrawalRequest',
        {
          withdrawalId: 'wd-1',
          amountCents: 50_000,
          currency: 'USD',
          status: 'SETTLED',
          requestedAt: '2026-01-01T00:00:00.000Z',
          settledAt: '2026-01-03T00:00:00.000Z',
          failedAt: null,
          reason: null,
          tenantId: 't1',
          userId: 'u1',
          region: 'us-east-1',
        },
        {
          version: 3,
          overrides: { pk: 'InvestorProfile#t1#u1', sk: 'Withdrawal#wd-1' },
        },
      ),
    );
  });

  it('takes version from __version', () => {
    const intent = withdrawalLifecycle(
      makeUow(settledSubject, 1) as Parameters<typeof withdrawalLifecycle>[0],
    ) as { version: number };
    expect(intent.version).toBe(1);
  });

  describe('version guard (executor)', () => {
    let executor: IntentExecutor;
    beforeEach(() => {
      ddbMock.reset();
      executor = new IntentExecutor({ docClient, tableName: 'TestTable' });
    });

    it('applies a fresh versioned write when the condition succeeds', async () => {
      ddbMock.onAnyCommand().resolves({});
      const result = await executor.execute(
        withdrawalLifecycle(
          makeUow(settledSubject, 3) as Parameters<typeof withdrawalLifecycle>[0],
        ),
        fakeCtx,
      );
      expectVersionedWrite(result);
    });

    it('drops a stale write when the version condition fails', async () => {
      const err = new Error('stale');
      err.name = 'ConditionalCheckFailedException';
      ddbMock.onAnyCommand().rejects(err);
      const result = await executor.execute(
        withdrawalLifecycle(
          makeUow(settledSubject, 1) as Parameters<typeof withdrawalLifecycle>[0],
        ),
        fakeCtx,
      );
      expectStaleDrop(result);
    });
  });
});
