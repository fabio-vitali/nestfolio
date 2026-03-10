import { DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '@nestfolio/platform-core';
import {
  requireEnv,
  createServiceMetrics,
  MetricUnit,
  applyMiddleware,
  withLambdaContext,
  withTiming,
} from '@nestfolio/lambda-utils';
import {
  replayEvents,
  INITIAL_PORTFOLIO_STATE,
  type LedgerEntry,
  type PortfolioState,
} from '@nestfolio/command-core';
import { LedgerRepository } from '../repositories/ledger.repository';
import { portfolioReducer } from '../reducers/portfolio.reducer';

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

        // 1. Get current portfolio snapshot
        const snapshot = await deps.repository.getLatestSnapshot(
          group.tenantId,
          group.streamType,
        );
        const currentState = snapshot
          ? ({
              positions: snapshot['positions'] as Record<string, unknown>,
              cashBalanceCents: snapshot['cashBalanceCents'] as number,
              lastEventSequence: snapshot['lastEventSequence'] as number,
            } as unknown as PortfolioState)
          : INITIAL_PORTFOLIO_STATE;

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

        const nextState = replayEvents(currentState, ledgerEntries, portfolioReducer);

        // 4. Save portfolio snapshot (versioned)
        const newVersion = (snapshot ? (snapshot['version'] as number) : 0) + 1;
        const maxSeq = ledgerEntries.reduce(
          (max, e) => Math.max(max, e.sequenceNo),
          0,
        );

        await deps.repository.savePortfolioSnapshot(group.tenantId, group.streamType, {
          state: nextState as unknown as Record<string, unknown>,
          lastEventSequence: maxSeq,
          version: newVersion,
        });

        // 5. Save individual position snapshots
        for (const [symbol, position] of Object.entries(nextState.positions)) {
          if (position.quantity > 0) {
            await deps.repository.upsertPositionSnapshot(
              group.tenantId,
              group.streamType,
              symbol,
              position as unknown as Record<string, unknown>,
            );
          }
        }

        // 6. Save daily checkpoint (if date changed)
        const today = new Date().toISOString().slice(0, 10);
        const lastCheckpointDate = snapshot
          ? (snapshot['snapshotAt'] as string)?.slice(0, 10)
          : undefined;
        if (today !== lastCheckpointDate) {
          await deps.repository.saveCheckpoint(
            group.tenantId,
            group.streamType,
            today,
            nextState as unknown as Record<string, unknown>,
          );
        }

        deps.metrics.addMetric('SnapshotUpdated', MetricUnit.Count, 1);
        logger.info('Stream group processed', {
          streamKey,
          newVersion,
          positionCount: Object.keys(nextState.positions).length,
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
const metrics = createServiceMetrics('order-ledger');

const deps: ReducerDeps = { repository, metrics };

export const handler = applyMiddleware(
  createReducer(deps) as (event: unknown) => Promise<void>,
  withLambdaContext(),
  withTiming('order-ledger-reducer'),
);
