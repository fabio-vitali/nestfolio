import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EgestionEngine, logger, requireEnv, type RequestContext, asTenantId, asUserId } from '@nestfolio/event-processor';
import { type LedgerEntry } from '@nestfolio/event-processor/sourcing';
import { accountReducer, INITIAL_ACCOUNT_STATE, type AccountState } from '../domain';
import { LedgerRepository } from '../repositories/ledger.repository';

const TABLE_NAME = requireEnv('TABLE_NAME');
const SERVICE_NAME = 'ledger-ctrl';
const SNAPSHOT_TTL_DAYS = parseInt(process.env['SNAPSHOT_HISTORY_TTL_DAYS'] ?? '365', 10);

const dynamoClient = new DynamoDBClient({});
const repository = new LedgerRepository(TABLE_NAME, dynamoClient);

function parseAccountState(item: Record<string, unknown>): AccountState {
  return {
    positions: (item['positions'] as AccountState['positions']) ?? {},
    cashBalanceCents: (item['cashBalanceCents'] as number) ?? 0,
    lastEventSequence: (item['lastEventSequence'] as number) ?? 0,
  };
}

const engine = new EgestionEngine({
  serviceName: SERVICE_NAME,
  filter: (record) => record.__typename === 'LedgerEntry',
  groupBy: {
    key: (record) => `${record.tenantId as string}#${record.streamType as string}`,
  },
  processGroup: async (groupKey, records) => {
    const [tenantId, streamType] = groupKey.split('#');

    // Reconstruct RequestContext from the first stream record (fields written by event-listener)
    const firstRecord = records[0];
    const reqCtx: RequestContext = {
      tenantId: asTenantId(tenantId),
      userId: asUserId((firstRecord.userId as string) ?? 'system'),
      region: (firstRecord.region as string) ?? process.env['AWS_REGION'] ?? 'us-east-1',
    };

    // 1. Load current snapshot
    const existing = await repository.getLatestSnapshot(tenantId, streamType);
    const currentState: AccountState = existing
      ? parseAccountState(existing)
      : INITIAL_ACCOUNT_STATE;
    const lastSeq = currentState.lastEventSequence;
    const currentVersion = (existing?.['version'] as number) ?? 0;

    // 2. Query events since last snapshot sequence
    const events = await repository.queryEntriesSince(tenantId, streamType, lastSeq);
    if (events.length === 0) {
      logger.info('No new events to reduce', { groupKey });
      return;
    }

    // 3. Reduce events
    const nextState = events.reduce(
      (state, event) => accountReducer(state, event as unknown as LedgerEntry),
      currentState,
    );

    const maxSeq = events.reduce(
      (max, e) => Math.max(max, (e['sequenceNo'] as number) ?? 0),
      0,
    );

    // 4. Determine what changed
    const balanceChanged = nextState.cashBalanceCents !== currentState.cashBalanceCents;
    const positionsChanged = JSON.stringify(nextState.positions) !== JSON.stringify(currentState.positions);

    // 5. Save snapshot + derived events (BalanceEvent, PortfolioEvent, LedgerEntryEvent)
    await repository.saveSnapshotWithEvents({
      streamType: streamType as 'actual' | 'simulated',
      state: nextState,
      lastEventSequence: maxSeq,
      version: currentVersion + 1,
      balanceChanged,
      positionsChanged,
      ttlDays: SNAPSHOT_TTL_DAYS,
    }, reqCtx);

    logger.info('Snapshot updated with derived events', {
      groupKey,
      version: currentVersion + 1,
      eventCount: events.length,
      balanceChanged,
      positionsChanged,
    });
  },
  busName: process.env['BUS_NAME'],
});

export const handler = (event: import('aws-lambda').DynamoDBStreamEvent) => engine.process(event);
