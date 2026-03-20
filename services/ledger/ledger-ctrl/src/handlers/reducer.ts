import { DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '@nestfolio/event-processor';
import {
  requireEnv,
  createServiceMetrics,
  MetricUnit,
  applyMiddleware,
  withLambdaContext,
  withTiming,
} from '@nestfolio/event-processor';
import { replayEvents, type LedgerEntry } from '@nestfolio/command-core';
import { INITIAL_ACCOUNT_STATE, type AccountState, accountReducer } from '@nestfolio/ledger-core';
import { LedgerRepository } from '../repositories/ledger.repository';

interface ReducerDeps {
  readonly repository: LedgerRepository;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
}

interface StreamGroup {
  tenantId: string;
  streamType: string;
  entries: LedgerEntry[];
}

function groupByStream(records: DynamoDBStreamEvent['Records']): Map<string, StreamGroup> {
  const groups = new Map<string, StreamGroup>();

  for (const record of records) {
    if (record.eventName !== 'INSERT' || !record.dynamodb?.NewImage) continue;

    const image = unmarshall(record.dynamodb.NewImage as Record<string, any>);
    if (image['__typename'] !== 'LedgerEntry') continue;

    const tenantId = image['tenantId'] as string;
    const streamType = image['streamType'] as string;
    const key = `${tenantId}#${streamType}`;

    if (!groups.has(key)) {
      groups.set(key, { tenantId, streamType, entries: [] });
    }

    groups.get(key)!.entries.push({
      eventId: image['eventId'] as string,
      eventType: image['eventType'] as string,
      payload: image['payload'] as Record<string, unknown>,
      timestamp: image['timestamp'] as string,
      sequenceNo: image['sequenceNo'] as number,
    });
  }

  return groups;
}

export const createReducer = (deps: ReducerDeps) =>
  async (event: DynamoDBStreamEvent): Promise<void> => {
    const groups = groupByStream(event.Records);

    for (const [streamKey, group] of groups) {
      try {
        logger.info('Processing stream group', {
          streamKey,
          entryCount: group.entries.length,
        });

        // 1. Get current account snapshot
        const snapshot = await deps.repository.getLatestSnapshot(
          group.tenantId,
          group.streamType,
        );
        const currentState = snapshot
          ? ({
              positions: snapshot['positions'] as Record<string, unknown>,
              cashBalanceCents: snapshot['cashBalanceCents'] as number,
              lastEventSequence: snapshot['lastEventSequence'] as number,
            } as unknown as AccountState)
          : INITIAL_ACCOUNT_STATE;

        // 2. Query all LedgerEntries since last snapshot sequence
        const lastSeq = snapshot ? (snapshot['lastEventSequence'] as number) : 0;
        const newEntries = await deps.repository.queryEntriesSince(
          group.tenantId,
          group.streamType,
          lastSeq,
        );

        if (newEntries.length === 0) {
          logger.info('No new entries to process', { streamKey });
          continue;
        }

        // 3. Convert to LedgerEntry format and replay
        const ledgerEntries: LedgerEntry[] = newEntries.map((e) => ({
          eventId: e['eventId'] as string,
          eventType: e['eventType'] as string,
          payload: e['payload'] as Record<string, unknown>,
          timestamp: e['timestamp'] as string,
          sequenceNo: e['sequenceNo'] as number,
        }));

        const nextState = replayEvents(currentState, ledgerEntries, accountReducer);

        // 4. Detect what changed
        const balanceChanged = nextState.cashBalanceCents !== currentState.cashBalanceCents;
        const positionsChanged = JSON.stringify(nextState.positions) !== JSON.stringify(currentState.positions);

        // 5. Save snapshot with events in a transaction
        const newVersion = (snapshot ? (snapshot['version'] as number) : 0) + 1;
        const maxSeq = ledgerEntries.reduce(
          (max, e) => Math.max(max, e.sequenceNo),
          0,
        );

        const userId = ledgerEntries[0]?.payload?.['userId'] as string | undefined;

        await deps.repository.saveSnapshotWithEvents({
          tenantId: group.tenantId,
          streamType: group.streamType,
          state: nextState as unknown as Record<string, unknown>,
          lastEventSequence: maxSeq,
          version: newVersion,
          balanceChanged,
          positionsChanged,
          userId,
        });

        // 6. Save daily checkpoint (if date changed)
        const today = new Date().toISOString().slice(0, 10);
        const lastCheckpointDate = snapshot
          ? (snapshot['snapshotAt'] as string)?.slice(0, 10)
          : undefined;
        if (today !== lastCheckpointDate) {
          try {
            await deps.repository.saveCheckpoint(
              group.tenantId,
              group.streamType,
              today,
              nextState as unknown as Record<string, unknown>,
            );
          } catch {
            // Conditional write failure is expected if checkpoint already exists for today
            logger.info('Checkpoint already exists for today', { streamKey, today });
          }
        }

        deps.metrics.addMetric('SnapshotUpdated', MetricUnit.Count, 1);
        logger.info('Stream group processed', {
          streamKey,
          newVersion,
          positionCount: Object.keys(nextState.positions).length,
          balanceChanged,
          positionsChanged,
        });
      } catch (error) {
        logger.error('Failed to process stream group', {
          streamKey,
          error: error instanceof Error ? error.message : String(error),
        });
        deps.metrics.addMetric('ReducerFailed', MetricUnit.Count, 1);
        throw error;
      }
    }

    deps.metrics.publishStoredMetrics();
  };

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const repository = new LedgerRepository(TABLE_NAME, new DynamoDBClient({}));
const metrics = createServiceMetrics('ledger-ctrl');

const deps: ReducerDeps = { repository, metrics };

export const handler = applyMiddleware(
  createReducer(deps) as (event: unknown) => Promise<void>,
  withLambdaContext(),
  withTiming('ledger-ctrl-reducer'),
);
