import type { DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../internal';
import type { StreamRecord, StreamContext } from '../types/stream-types';
import { EgestionEngine } from '../engine/egestion-engine';
import type { RequestContext } from '../domain/schemas';

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
  /** Query events since last checkpoint. Required — no default convention query. */
  queryEvents: (
    groupKey: string,
    lastSequence: number,
    clients: { docClient: DynamoDBDocumentClient; tableName: string },
  ) => Promise<Record<string, unknown>[]>;
  /** Extract RequestContext from the group key and stream records. */
  requestContext: (groupKey: string, records: StreamRecord[]) => RequestContext;
  /**
   * Custom save logic. When provided, replaces the default PutCommand.
   * Receives the reduced state, sequence info, and RequestContext.
   */
  saveSnapshot?: (params: {
    snapshotKey: { pk: string; sk: string };
    state: S;
    lastEventSequence: number;
    version: number;
    requestContext: RequestContext;
    clients: { docClient: DynamoDBDocumentClient; tableName: string };
  }) => Promise<void>;
  table?: string;
  bus?: string;
  concurrency?: number;
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
    const reqCtx = config.requestContext(groupKey, records);

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
    const events = await config.queryEvents(groupKey, lastSeq, clients);

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

    // 5. Save snapshot
    const maxSeq = events.reduce(
      (max, e) => Math.max(max, (e.sequenceNo as number) ?? 0),
      0,
    );
    const nextVersion = currentVersion + 1;

    if (config.saveSnapshot) {
      await config.saveSnapshot({
        snapshotKey,
        state: nextState,
        lastEventSequence: maxSeq,
        version: nextVersion,
        requestContext: reqCtx,
        clients,
      });
    } else {
      // Default: optimistic-lock PutCommand
      try {
        await docClient.send(new PutCommand({
          TableName: tableName,
          Item: {
            ...snapshotKey,
            ...(nextState as Record<string, unknown>),
            ...reqCtx,
            __typename: 'AccountSnapshot',
            version: nextVersion,
            lastEventSequence: maxSeq,
            updatedAt: new Date().toISOString(),
          },
          ConditionExpression: 'attribute_not_exists(pk) OR version = :v',
          ExpressionAttributeValues: { ':v': currentVersion },
        }));
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
          throw new Error(`Snapshot conflict for ${groupKey} — concurrent update detected`);
        }
        throw err;
      }
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
            ...reqCtx,
            __typename: 'AccountCheckpoint',
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

  const engine = new EgestionEngine({
    serviceName: config.serviceName,
    filter: config.filter,
    groupBy: { key: config.groupBy.key },
    processGroup,
    concurrency: config.concurrency,
    busName,
  });

  return (event: DynamoDBStreamEvent) => engine.process(event);
}
