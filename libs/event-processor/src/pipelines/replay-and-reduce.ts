import type { DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '@nestfolio/lambda-utils';
import type { StreamRecord, StreamContext } from '../types/stream-types';
import { StreamEngine } from '../engine/stream-engine';

export interface ReplayAndReduceConfig<S> {
  serviceName: string;
  filter?: (record: StreamRecord) => boolean;
  groupBy: {
    key: (record: StreamRecord) => string;
  };
  reducer: (state: S, event: Record<string, unknown>) => S;
  initialState: S | (() => S);
  snapshot: {
    key: (groupKey: string) => { pk: string; sk: string };
    daily?: boolean;
  };
  queryEvents?: (
    groupKey: string,
    lastSequence: number,
    clients: { docClient: DynamoDBDocumentClient; tableName: string },
  ) => Promise<Record<string, unknown>[]>;
  table?: string;
  bus?: string;
  concurrency?: number;
}

async function conventionQuery(
  lastSequence: number,
  typename: string,
  pk: string,
  clients: { docClient: DynamoDBDocumentClient; tableName: string },
): Promise<Record<string, unknown>[]> {
  const result = await clients.docClient.send(new QueryCommand({
    TableName: clients.tableName,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
    FilterExpression: 'sequenceNo > :seq',
    ExpressionAttributeValues: {
      ':pk': pk,
      ':prefix': `${typename}#`,
      ':seq': lastSequence,
    },
    ScanIndexForward: true,
  }));
  return (result.Items ?? []) as Record<string, unknown>[];
}

export function replayAndReduce<S>(
  config: ReplayAndReduceConfig<S>,
): (event: DynamoDBStreamEvent) => Promise<void> {
  const tableName = config.table ?? process.env.TABLE_NAME!;
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const clients = { docClient, tableName };

  const processGroup = async (
    groupKey: string,
    records: StreamRecord[],
    _ctx: StreamContext,
  ): Promise<void> => {
    const snapshotKey = config.snapshot.key(groupKey);

    // 1. Load current snapshot
    const snapshotResult = await docClient.send(new GetCommand({
      TableName: tableName,
      Key: snapshotKey,
    }));

    const existing = snapshotResult.Item;
    const currentState: S = existing
      ? (existing as unknown as S)
      : (typeof config.initialState === 'function'
        ? (config.initialState as () => S)()
        : config.initialState);
    const lastSeq = (existing?.lastEventSequence as number) ?? 0;
    const currentVersion = (existing?.version as number) ?? 0;

    // 2. Query events since checkpoint
    let events: Record<string, unknown>[];
    if (config.queryEvents) {
      events = await config.queryEvents(groupKey, lastSeq, clients);
    } else {
      const firstRecord = records[0];
      events = await conventionQuery(lastSeq, firstRecord.__typename, firstRecord.pk, clients);
    }

    if (events.length === 0) {
      logger.info('No new events to reduce', { groupKey });
      return;
    }

    // 3. Sort by sequenceNo (defensive)
    events.sort((a, b) => ((a.sequenceNo as number) ?? 0) - ((b.sequenceNo as number) ?? 0));

    // 4. Reduce
    const nextState = events.reduce(
      (state, event) => config.reducer(state, event),
      currentState,
    );

    // 5. Save snapshot with optimistic concurrency
    const maxSeq = events.reduce(
      (max, e) => Math.max(max, (e.sequenceNo as number) ?? 0),
      0,
    );
    const nextVersion = currentVersion + 1;

    try {
      await docClient.send(new PutCommand({
        TableName: tableName,
        Item: {
          ...snapshotKey,
          ...(nextState as Record<string, unknown>),
          version: nextVersion,
          lastEventSequence: maxSeq,
          updatedAt: new Date().toISOString(),
        },
        ConditionExpression: 'attribute_not_exists(pk) OR version = :v',
        ExpressionAttributeValues: { ':v': currentVersion },
      }));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
        // Rethrow as plain Error so isRetryable() treats it as retryable
        // (ConditionalCheckFailedException is classified as non-retryable client fault)
        throw new Error(`Snapshot conflict for ${groupKey} — concurrent update detected`);
      }
      throw err;
    }

    // 6. Daily checkpoint
    if (config.snapshot.daily) {
      const today = new Date().toISOString().slice(0, 10);
      try {
        await docClient.send(new PutCommand({
          TableName: tableName,
          Item: {
            pk: snapshotKey.pk,
            sk: `Snapshot#${today}`,
            ...(nextState as Record<string, unknown>),
            version: nextVersion,
            lastEventSequence: maxSeq,
            createdAt: new Date().toISOString(),
          },
          ConditionExpression: 'attribute_not_exists(pk)',
        }));
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
          logger.info('Daily checkpoint already exists', { groupKey, today });
        } else {
          throw err;
        }
      }
    }

    logger.info('Snapshot updated', { groupKey, version: nextVersion, eventCount: events.length });
  };

  const busName = config.bus ?? process.env.BUS_NAME;

  const engine = new StreamEngine({
    serviceName: config.serviceName,
    filter: config.filter,
    groupBy: { key: config.groupBy.key },
    processGroup,
    concurrency: config.concurrency,
    busName,
  });

  return (event: DynamoDBStreamEvent) => engine.process(event);
}
