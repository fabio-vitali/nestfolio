import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { IntentExecutor } from '@nestfolio/event-processor';
import { expectVersionedWrite, expectStaleDrop } from '@nestfolio/test-support';
import { balanceUpdated } from '../../src/transforms/balance-updated';

const ddbMock = mockClient(DynamoDBDocumentClient);
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const makeUow = (lastEventSequence: number) => ({
  event: {
    id: 'e1',
    type: 'BALANCE_UPDATED',
    timestamp: '2026-01-01T00:00:00.000Z',
    subject: {
      tenantId: 't1',
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
  serviceName: 'ledger-bff',
} as never;

// Pull the PortfolioLatest projectVersioned intent out of the transform output.
const portfolioLatestIntent = (lastEventSequence: number) => {
  const out = balanceUpdated(makeUow(lastEventSequence) as Parameters<typeof balanceUpdated>[0]);
  const intents = Array.isArray(out) ? out : [out];
  const intent = intents.find((i) => (i as { typename?: string }).typename === 'PortfolioLatest');
  if (!intent) throw new Error('expected a PortfolioLatest intent');
  return intent;
};

describe('ledger-bff PortfolioLatest version guard', () => {
  let executor: IntentExecutor;

  beforeEach(() => {
    ddbMock.reset();
    executor = new IntentExecutor({ docClient, tableName: 'TestTable' });
  });

  // NOTE: use onAnyCommand() rather than on(PutCommand). The executor instantiates
  // PutCommand from its OWN resolved @aws-sdk/lib-dynamodb copy; under pnpm's nested
  // resolution that can be a distinct class from the one this test imports, so a
  // command-class matcher (on(PutCommand)) silently fails to match and the send
  // falls through to the default resolve. onAnyCommand() intercepts every send on
  // the mocked docClient regardless of command-class identity.
  it('applies a fresh versioned write when the condition succeeds', async () => {
    ddbMock.onAnyCommand().resolves({});
    const result = await executor.execute(portfolioLatestIntent(10), fakeCtx);
    expectVersionedWrite(result);
  });

  it('drops a stale write when the version condition fails', async () => {
    const err = new Error('stale');
    err.name = 'ConditionalCheckFailedException';
    ddbMock.onAnyCommand().rejects(err);
    const result = await executor.execute(portfolioLatestIntent(3), fakeCtx);
    expectStaleDrop(result);
  });
});
