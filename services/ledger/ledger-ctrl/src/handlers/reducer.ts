import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { replayAndReduce, requireEnv, asTenantId, asUserId, type RequestContext } from '@nestfolio/event-processor';
import { type LedgerEntry } from '@nestfolio/event-processor/sourcing';
import { accountReducer, INITIAL_ACCOUNT_STATE, type AccountState } from '../domain';
import { LedgerRepository } from '../repositories/ledger.repository';

const TABLE_NAME = requireEnv('TABLE_NAME');

const dynamoClient = new DynamoDBClient({});
const repository = new LedgerRepository(TABLE_NAME, dynamoClient);

export const handler = replayAndReduce<AccountState>({
  serviceName: 'ledger-ctrl',
  filter: (record) => record.__typename === 'LedgerEntry',
  groupBy: {
    key: (record) => `${record.tenantId as string}#${record.streamType as string}`,
  },
  reducer: (state, event) => accountReducer(state, event as unknown as LedgerEntry),
  initialState: INITIAL_ACCOUNT_STATE,
  snapshot: {
    key: (gk) => {
      const [tenantId, streamType] = gk.split('#');
      return { pk: `Account#${tenantId}#${streamType}`, sk: 'Snapshot#latest' };
    },
  },
  queryEvents: async (groupKey, lastSequence) => {
    const [tenantId, streamType] = groupKey.split('#');
    return repository.queryEntriesSince(tenantId, streamType, lastSequence);
  },
  requestContext: (groupKey, records) => {
    const [tenantId] = groupKey.split('#');
    const firstRecord = records[0];
    return {
      tenantId: asTenantId(tenantId),
      userId: asUserId((firstRecord?.userId as string) ?? 'system'),
      region: (firstRecord?.region as string) ?? process.env['AWS_REGION'] ?? 'us-east-1',
    } satisfies RequestContext;
  },
  saveSnapshot: async ({ snapshotKey, state, lastEventSequence, version, requestContext }) => {
    const [, streamType] = snapshotKey.pk.replace('Account#', '').split('#');
    await repository.saveSnapshot(
      streamType as 'actual' | 'simulated',
      state,
      lastEventSequence,
      version,
      requestContext,
    );
  },
  table: TABLE_NAME,
});
